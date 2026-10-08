import { useMemo, useState } from "react";
import { FlaskConical, GitBranch, Info, TriangleAlert } from "lucide-react";
import type { AnalysisRecord } from "../../shared/types";
import type { CartModel, TreeNode } from "../../shared/cart";
import { leafCount, treeDepth } from "../../shared/cart";
import {
  ABOVE,
  OUTCOME_TARGETS,
  beatsBaseline,
  buildOutcomeModel,
  type ModelRecord,
  type OutcomeTarget,
} from "../../shared/outcome-model";
import { syntheticHistory } from "../lib/outcome-demo";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function conditionText(model: CartModel, node: Extract<TreeNode, { kind: "split" }>, yes: boolean) {
  const spec = model.specs.find((s) => s.key === node.feature);
  const label = spec?.label ?? node.feature;
  const fmt = spec?.format ?? ((v: number | string) => String(v));
  if (node.test.type === "lte") {
    const t = Math.round(node.test.threshold * 10) / 10;
    return `${label} ${yes ? "≤" : ">"} ${fmt(t)}`;
  }
  const values = node.test.values.map((v) => fmt(v)).join(" or ");
  return `${label} ${yes ? "is" : "is not"} ${values}`;
}

function Leaf({ node }: { node: TreeNode }) {
  const above = node.counts[ABOVE] ?? 0;
  const share = node.n ? above / node.n : 0;
  const up = node.prediction === ABOVE;
  return (
    <div className={`cart-leaf ${up ? "up" : "down"}`}>
      <strong>{up ? "Usually above your median" : "Usually at or below your median"}</strong>
      <span>
        {above} of {node.n} posts above · {pct(share)}
      </span>
      <span className="cart-leaf-bar" aria-hidden="true">
        <span style={{ width: pct(share) }} />
      </span>
    </div>
  );
}

function Branch({ model, node }: { model: CartModel; node: TreeNode }) {
  if (node.kind === "leaf") return <Leaf node={node} />;
  return (
    <ul className="cart-branch">
      {([true, false] as const).map((yes) => (
        <li key={String(yes)}>
          <span className="cart-condition">
            <span className={`cart-answer ${yes ? "yes" : "no"}`}>{yes ? "IF" : "ELSE"}</span>
            {conditionText(model, node, yes)}
          </span>
          <Branch model={model} node={yes ? node.left : node.right} />
        </li>
      ))}
    </ul>
  );
}

export default function PatternFinder({ records }: { records: AnalysisRecord[] }) {
  const [target, setTarget] = useState<OutcomeTarget>("engagement");
  const [demo, setDemo] = useState(false);
  const source: ModelRecord[] = useMemo(
    () => (demo ? syntheticHistory() : records),
    [demo, records],
  );
  const state = useMemo(() => buildOutcomeModel(source, target), [source, target]);

  return (
    <section className="panel cart-panel" aria-labelledby="cart-heading">
      <div className="section-heading">
        <div>
          <div className="eyebrow">CART DECISION TREE</div>
          <h3 id="cart-heading">What your stronger posts have in common</h3>
          <p>
            A classification tree trained on your logged posts. It splits them by
            what was known before publishing and shows which choices separated
            your above-median results from the rest.
          </p>
        </div>
        <GitBranch size={22} />
      </div>

      <div className="cart-controls">
        <div className="cart-segment" role="radiogroup" aria-label="Outcome to learn">
          {(Object.keys(OUTCOME_TARGETS) as OutcomeTarget[]).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={target === t}
              className={target === t ? "active" : ""}
              onClick={() => setTarget(t)}
            >
              {OUTCOME_TARGETS[t].label}
            </button>
          ))}
        </div>
        <button
          className={`button secondary small-button ${demo ? "active" : ""}`}
          onClick={() => setDemo((d) => !d)}
          aria-pressed={demo}
        >
          <FlaskConical size={14} />
          {demo ? "Back to my results" : "Preview with synthetic data"}
        </button>
      </div>

      {demo && (
        <p className="cart-banner">
          <TriangleAlert size={15} />
          Synthetic demo: 48 generated posts with planted patterns (strong hooks and
          evening posts earn more engagement; TikTok and YouTube draw more views).
          Nothing here is real or saved.
        </p>
      )}

      {state.status === "insufficient" ? (
        <div className="cart-empty">
          <div className="cart-progress" aria-hidden="true">
            <span style={{ width: pct(Math.min(1, state.usable / state.required)) }} />
          </div>
          <strong>
            {state.usable} of {state.required} posts with results
          </strong>
          <p>{state.reason}</p>
        </div>
      ) : (
        <Trained
          model={state.result.model}
          median={state.result.median}
          target={target}
          trainedOn={state.result.trainedOn}
          beats={beatsBaseline(state.result)}
        />
      )}

      <p className="table-note">
        <Info size={12} /> Labels compare each post with your own median, so the
        tree describes your history, not virality in general. Pruning strength is
        chosen by cross-validation, which also produces the accuracy shown; with a
        small history that figure is noisy and slightly optimistic. Splits show
        association, not cause.
      </p>
    </section>
  );
}

function Trained({
  model,
  median,
  target,
  trainedOn,
  beats,
}: {
  model: CartModel;
  median: number;
  target: OutcomeTarget;
  trainedOn: number;
  beats: boolean;
}) {
  const v = model.validation;
  const medianText =
    target === "engagement"
      ? `${median.toFixed(1)}% engagement`
      : `${Math.round(median).toLocaleString()} views`;
  return (
    <>
      <div className="cart-stats">
        <div>
          <span>Trained on</span>
          <strong>{trainedOn} posts</strong>
        </div>
        <div>
          <span>Your median</span>
          <strong>{medianText}</strong>
        </div>
        <div>
          <span>Cross-validated accuracy</span>
          <strong>{v ? pct(v.accuracy) : "—"}</strong>
          {v && <small>vs {pct(v.baseline)} by always guessing</small>}
        </div>
        <div>
          <span>Tree size</span>
          <strong>
            {leafCount(model.root)} {leafCount(model.root) === 1 ? "leaf" : "leaves"}
          </strong>
          <small>depth {treeDepth(model.root)}</small>
        </div>
      </div>

      {!beats && (
        <p className="cart-banner muted-banner">
          <TriangleAlert size={15} />
          The tree does not beat simple guessing yet. Treat any splits below as
          hints, and keep logging results with a consistent observation window.
        </p>
      )}

      {model.root.kind === "leaf" ? (
        <p className="cart-none">
          After pruning, no split was reliable enough to keep. Your logged posts
          don't yet differ in a consistent way on the signals Viralify measures.
        </p>
      ) : (
        <div className="cart-layout">
          <div className="cart-tree" aria-label="Decision tree rules">
            <Branch model={model} node={model.root} />
          </div>
          <div className="cart-factors">
            <h4>What the tree relies on</h4>
            {model.importance.map((f) => (
              <div className="cart-factor" key={f.key}>
                <span>{f.label}</span>
                <span className="cart-factor-bar" aria-hidden="true">
                  <span style={{ width: pct(f.value) }} />
                </span>
                <strong>{pct(f.value)}</strong>
              </div>
            ))}
            <p>Share of the tree's total Gini impurity decrease.</p>
          </div>
        </div>
      )}
    </>
  );
}
