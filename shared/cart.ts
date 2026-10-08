/**
 * CART (Classification and Regression Trees, Breiman et al., 1984) —
 * classification variant, dependency-free so it runs in the browser and in Node.
 *
 * - Binary splits chosen by the largest decrease in Gini impurity.
 * - Numeric features split on midpoints between sorted distinct values.
 * - Categorical features split into two groups using Breiman's ordering
 *   (sort categories by the share of the first class), which finds the
 *   optimal binary partition for two-class problems.
 * - Missing values follow the child that received more training samples.
 * - Minimal cost-complexity pruning; the pruning strength (alpha) is chosen
 *   by k-fold cross-validation with the one-standard-error rule.
 */

export type FeatureValue = number | string | null | undefined;

export interface FeatureSpec {
  key: string;
  label: string;
  kind: "numeric" | "categorical";
  /** Display formatter for numeric thresholds and categorical values. */
  format?: (value: number | string) => string;
}

export interface Sample {
  features: Record<string, FeatureValue>;
  label: string;
}

export type SplitTest =
  | { type: "lte"; threshold: number }
  | { type: "in"; values: string[] };

interface NodeBase {
  counts: Record<string, number>;
  n: number;
  prediction: string;
}
export interface LeafNode extends NodeBase {
  kind: "leaf";
}
export interface SplitNode extends NodeBase {
  kind: "split";
  feature: string;
  test: SplitTest;
  missingGoesLeft: boolean;
  gain: number;
  left: TreeNode;
  right: TreeNode;
}
export type TreeNode = LeafNode | SplitNode;

export interface CartOptions {
  maxDepth: number;
  minSamplesSplit: number;
  minSamplesLeaf: number;
  /** Folds used to choose the pruning strength. */
  folds: number;
  /** Skip cost-complexity pruning (mainly for tests and inspection). */
  prune: boolean;
}

export const DEFAULT_CART_OPTIONS: CartOptions = {
  maxDepth: 4,
  minSamplesSplit: 4,
  minSamplesLeaf: 2,
  folds: 5,
  prune: true,
};

export interface CartModel {
  root: TreeNode;
  classes: string[];
  specs: FeatureSpec[];
  n: number;
  alpha: number;
  /** Share of the total Gini decrease attributable to each feature (sums to 1). */
  importance: { key: string; label: string; value: number }[];
  validation: {
    /** Cross-validated accuracy of the selected (1-SE) pruning level. */
    accuracy: number;
    /** Accuracy of always predicting the most common class. */
    baseline: number;
    folds: number;
  } | null;
}

export interface Condition {
  feature: string;
  label: string;
  text: string;
}

export interface Prediction {
  label: string;
  /** Share of training samples in the reached leaf that had this label. */
  support: number;
  leafSize: number;
  counts: Record<string, number>;
  path: Condition[];
}

export interface Rule {
  conditions: Condition[];
  prediction: string;
  support: number;
  n: number;
  counts: Record<string, number>;
}

const EPS = 1e-12;

function isMissing(value: FeatureValue): value is null | undefined {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && !Number.isFinite(value))
  );
}

function countLabels(samples: Sample[], classes: string[]) {
  const counts: Record<string, number> = {};
  for (const c of classes) counts[c] = 0;
  for (const s of samples) counts[s.label] = (counts[s.label] ?? 0) + 1;
  return counts;
}

function gini(counts: Record<string, number>, n: number) {
  if (!n) return 0;
  let sum = 0;
  for (const c of Object.values(counts)) sum += (c / n) ** 2;
  return 1 - sum;
}

/** Majority class; ties resolve to the earlier class in `classes` for determinism. */
function majority(counts: Record<string, number>, classes: string[]) {
  let best = classes[0];
  for (const c of classes) if ((counts[c] ?? 0) > (counts[best] ?? 0)) best = c;
  return best;
}

function goesLeft(node: SplitNode, value: FeatureValue): boolean {
  if (isMissing(value)) return node.missingGoesLeft;
  if (node.test.type === "lte")
    return typeof value === "number" && value <= node.test.threshold;
  return node.test.values.includes(String(value));
}

interface Candidate {
  feature: string;
  test: SplitTest;
  gain: number;
}

function bestSplit(
  samples: Sample[],
  specs: FeatureSpec[],
  classes: string[],
  minLeaf: number,
): Candidate | null {
  const n = samples.length;
  const parent = gini(countLabels(samples, classes), n);
  let best: Candidate | null = null;

  const consider = (
    feature: string,
    test: SplitTest,
    left: Sample[],
    right: Sample[],
  ) => {
    if (left.length < minLeaf || right.length < minLeaf) return;
    const g =
      parent -
      (left.length / n) * gini(countLabels(left, classes), left.length) -
      (right.length / n) * gini(countLabels(right, classes), right.length);
    if (g > EPS && (!best || g > best.gain + EPS)) best = { feature, test, gain: g };
  };

  for (const spec of specs) {
    const present = samples.filter((s) => !isMissing(s.features[spec.key]));
    if (present.length < 2 * minLeaf) continue;
    const missing = samples.filter((s) => isMissing(s.features[spec.key]));
    // Missing values join the larger side, mirroring prediction-time routing.
    const route = (left: Sample[], right: Sample[]) =>
      left.length >= right.length
        ? [left.concat(missing), right]
        : [left, right.concat(missing)];

    if (spec.kind === "numeric") {
      const values = [
        ...new Set(present.map((s) => Number(s.features[spec.key]))),
      ].sort((a, b) => a - b);
      for (let i = 0; i < values.length - 1; i++) {
        const threshold = (values[i] + values[i + 1]) / 2;
        const l = present.filter((s) => Number(s.features[spec.key]) <= threshold);
        const r = present.filter((s) => Number(s.features[spec.key]) > threshold);
        const [left, right] = route(l, r);
        consider(spec.key, { type: "lte", threshold }, left, right);
      }
    } else {
      const firstClass = classes[0];
      const byCategory = new Map<string, { total: number; first: number }>();
      for (const s of present) {
        const key = String(s.features[spec.key]);
        const entry = byCategory.get(key) ?? { total: 0, first: 0 };
        entry.total += 1;
        if (s.label === firstClass) entry.first += 1;
        byCategory.set(key, entry);
      }
      const ordered = [...byCategory.entries()]
        .sort(
          (a, b) =>
            a[1].first / a[1].total - b[1].first / b[1].total ||
            a[0].localeCompare(b[0]),
        )
        .map(([k]) => k);
      for (let i = 0; i < ordered.length - 1; i++) {
        const values = ordered.slice(0, i + 1).sort();
        const l = present.filter((s) => values.includes(String(s.features[spec.key])));
        const r = present.filter((s) => !values.includes(String(s.features[spec.key])));
        const [left, right] = route(l, r);
        consider(spec.key, { type: "in", values }, left, right);
      }
    }
  }
  return best;
}

function grow(
  samples: Sample[],
  specs: FeatureSpec[],
  classes: string[],
  options: CartOptions,
  depth: number,
): TreeNode {
  const counts = countLabels(samples, classes);
  const base = { counts, n: samples.length, prediction: majority(counts, classes) };
  const pure = Object.values(counts).filter((c) => c > 0).length <= 1;
  if (pure || depth >= options.maxDepth || samples.length < options.minSamplesSplit)
    return { kind: "leaf", ...base };
  const split = bestSplit(samples, specs, classes, options.minSamplesLeaf);
  if (!split) return { kind: "leaf", ...base };

  const probe = { kind: "split", test: split.test, missingGoesLeft: false } as SplitNode;
  const presentLeft = samples.filter(
    (s) => !isMissing(s.features[split.feature]) && goesLeft(probe, s.features[split.feature]),
  ).length;
  const presentRight = samples.filter(
    (s) => !isMissing(s.features[split.feature]) && !goesLeft(probe, s.features[split.feature]),
  ).length;
  const missingGoesLeft = presentLeft >= presentRight;
  const node: SplitNode = {
    kind: "split",
    ...base,
    feature: split.feature,
    test: split.test,
    missingGoesLeft,
    gain: split.gain,
    left: { kind: "leaf", ...base },
    right: { kind: "leaf", ...base },
  };
  const left = samples.filter((s) => goesLeft(node, s.features[split.feature]));
  const right = samples.filter((s) => !goesLeft(node, s.features[split.feature]));
  node.left = grow(left, specs, classes, options, depth + 1);
  node.right = grow(right, specs, classes, options, depth + 1);
  return node;
}

function toLeaf(node: TreeNode): LeafNode {
  return { kind: "leaf", counts: node.counts, n: node.n, prediction: node.prediction };
}

function errors(node: NodeBase) {
  return node.n - (node.counts[node.prediction] ?? 0);
}

function subtreeStats(node: TreeNode): { errors: number; leaves: number } {
  if (node.kind === "leaf") return { errors: errors(node), leaves: 1 };
  const l = subtreeStats(node.left);
  const r = subtreeStats(node.right);
  return { errors: l.errors + r.errors, leaves: l.leaves + r.leaves };
}

/** Smallest "weakest link" value g(t) in the tree; Infinity for a single leaf. */
function weakestLink(node: TreeNode, total: number): number {
  if (node.kind === "leaf") return Infinity;
  const { errors: subtreeErrors, leaves } = subtreeStats(node);
  const g = (errors(node) - subtreeErrors) / total / (leaves - 1);
  return Math.min(g, weakestLink(node.left, total), weakestLink(node.right, total));
}

function collapseAt(node: TreeNode, total: number, alpha: number): TreeNode {
  if (node.kind === "leaf") return node;
  const { errors: subtreeErrors, leaves } = subtreeStats(node);
  const g = (errors(node) - subtreeErrors) / total / (leaves - 1);
  if (g <= alpha + EPS) return toLeaf(node);
  return {
    ...node,
    left: collapseAt(node.left, total, alpha),
    right: collapseAt(node.right, total, alpha),
  };
}

/** Minimal cost-complexity pruning: collapse every weakest link with g(t) ≤ alpha. */
export function pruneTree(root: TreeNode, alpha: number, total = root.n): TreeNode {
  let tree = root;
  while (tree.kind === "split" && weakestLink(tree, total) <= alpha + EPS)
    tree = collapseAt(tree, total, weakestLink(tree, total));
  return tree;
}

/** The increasing alpha values at which the pruned subtree changes, starting at 0. */
export function pruningPath(root: TreeNode, total = root.n): number[] {
  const alphas = [0];
  let tree = root;
  while (tree.kind === "split") {
    const g = weakestLink(tree, total);
    alphas.push(g);
    tree = collapseAt(tree, total, g);
  }
  return alphas;
}

function predictNode(root: TreeNode, features: Record<string, FeatureValue>): LeafNode {
  let node = root;
  while (node.kind === "split")
    node = goesLeft(node, features[node.feature]) ? node.left : node.right;
  return node;
}

function computeImportance(root: TreeNode, specs: FeatureSpec[]) {
  const totals: Record<string, number> = {};
  const walk = (node: TreeNode) => {
    if (node.kind === "leaf") return;
    const decrease =
      node.n * gini(node.counts, node.n) -
      node.left.n * gini(node.left.counts, node.left.n) -
      node.right.n * gini(node.right.counts, node.right.n);
    totals[node.feature] = (totals[node.feature] ?? 0) + Math.max(0, decrease);
    walk(node.left);
    walk(node.right);
  };
  walk(root);
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  return specs
    .map((s) => ({ key: s.key, label: s.label, value: sum ? (totals[s.key] ?? 0) / sum : 0 }))
    .filter((f) => f.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Deterministic fold assignment that keeps each class spread across folds. */
function foldsFor(samples: Sample[], classes: string[], k: number) {
  const fold = new Array<number>(samples.length);
  for (const c of classes) {
    let i = 0;
    samples.forEach((s, index) => {
      if (s.label === c) fold[index] = i++ % k;
    });
  }
  return fold;
}

function majorityAccuracy(samples: Sample[], classes: string[]) {
  const counts = countLabels(samples, classes);
  return (counts[majority(counts, classes)] ?? 0) / samples.length;
}

export function trainCart(
  samples: Sample[],
  specs: FeatureSpec[],
  options: Partial<CartOptions> = {},
): CartModel {
  if (!samples.length) throw new Error("CART needs at least one training sample.");
  const opts = { ...DEFAULT_CART_OPTIONS, ...options };
  const classes = [...new Set(samples.map((s) => s.label))].sort();
  const full = grow(samples, specs, classes, opts, 0);

  let alpha = 0;
  let validation: CartModel["validation"] = null;
  const k = Math.min(opts.folds, samples.length);
  if (opts.prune && k >= 2 && classes.length > 1) {
    const path = pruningPath(full);
    // Representative alpha for each interval of the pruning path (geometric mean).
    const candidates = path.map((a, i) =>
      i + 1 < path.length ? Math.sqrt(Math.max(a, EPS) * path[i + 1]) : a,
    );
    candidates[0] = 0;
    const fold = foldsFor(samples, classes, k);
    const trees = Array.from({ length: k }, (_, f) => {
      const train = samples.filter((_, i) => fold[i] !== f);
      return train.length
        ? grow(train, specs, [...new Set(train.map((s) => s.label))].sort(), opts, 0)
        : null;
    });
    const correctByCandidate = candidates.map((candidate) => {
      let correct = 0;
      for (let f = 0; f < k; f++) {
        const tree = trees[f];
        if (!tree) continue;
        const pruned = pruneTree(tree, candidate);
        samples.forEach((s, i) => {
          if (fold[i] === f && predictNode(pruned, s.features).prediction === s.label)
            correct += 1;
        });
      }
      return correct;
    });
    // One-standard-error rule (Breiman et al.): take the simplest tree whose
    // CV error is within one standard error of the lowest CV error.
    const n = samples.length;
    const minError = Math.min(...correctByCandidate.map((c) => 1 - c / n));
    const se = Math.sqrt((minError * (1 - minError)) / n);
    let chosen = 0;
    correctByCandidate.forEach((c, index) => {
      if (1 - c / n <= minError + se + EPS) chosen = index;
    });
    alpha = path[chosen];
    const bestCorrect = correctByCandidate[chosen];
    validation = {
      accuracy: bestCorrect / samples.length,
      baseline: majorityAccuracy(samples, classes),
      folds: k,
    };
  }

  const root = opts.prune ? pruneTree(full, alpha) : full;
  return {
    root,
    classes,
    specs,
    n: samples.length,
    alpha,
    importance: computeImportance(root, specs),
    validation,
  };
}

function describe(spec: FeatureSpec | undefined, node: SplitNode, left: boolean) {
  const label = spec?.label ?? node.feature;
  const fmt = spec?.format ?? ((v: number | string) => String(v));
  if (node.test.type === "lte") {
    const t = Math.round(node.test.threshold * 10) / 10;
    return `${label} ${left ? "≤" : ">"} ${fmt(t)}`;
  }
  const values = node.test.values.map((v) => fmt(v)).join(" or ");
  return left ? `${label} is ${values}` : `${label} is not ${values}`;
}

function condition(model: CartModel, node: SplitNode, left: boolean): Condition {
  const spec = model.specs.find((s) => s.key === node.feature);
  return {
    feature: node.feature,
    label: spec?.label ?? node.feature,
    text: describe(spec, node, left),
  };
}

export function predictCart(
  model: CartModel,
  features: Record<string, FeatureValue>,
): Prediction {
  const path: Condition[] = [];
  let node = model.root;
  while (node.kind === "split") {
    const left = goesLeft(node, features[node.feature]);
    path.push(condition(model, node, left));
    node = left ? node.left : node.right;
  }
  return {
    label: node.prediction,
    support: node.n ? (node.counts[node.prediction] ?? 0) / node.n : 0,
    leafSize: node.n,
    counts: node.counts,
    path,
  };
}

/** Every root-to-leaf path as a readable if–then rule. */
export function extractRules(model: CartModel): Rule[] {
  const rules: Rule[] = [];
  const walk = (node: TreeNode, conditions: Condition[]) => {
    if (node.kind === "leaf") {
      rules.push({
        conditions,
        prediction: node.prediction,
        support: node.n ? (node.counts[node.prediction] ?? 0) / node.n : 0,
        n: node.n,
        counts: node.counts,
      });
      return;
    }
    walk(node.left, [...conditions, condition(model, node, true)]);
    walk(node.right, [...conditions, condition(model, node, false)]);
  };
  walk(model.root, []);
  return rules;
}

export function treeDepth(node: TreeNode): number {
  return node.kind === "leaf" ? 0 : 1 + Math.max(treeDepth(node.left), treeDepth(node.right));
}

export function leafCount(node: TreeNode): number {
  return node.kind === "leaf" ? 1 : leafCount(node.left) + leafCount(node.right);
}
