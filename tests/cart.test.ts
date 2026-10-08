import test from "node:test";
import assert from "node:assert/strict";
import {
  extractRules,
  leafCount,
  predictCart,
  pruneTree,
  pruningPath,
  trainCart,
  type FeatureSpec,
  type Sample,
} from "../shared/cart";
import {
  ABOVE,
  BELOW,
  MIN_TRAINING_POSTS,
  buildOutcomeModel,
  predictOutcome,
  recordFeatures,
  type ModelRecord,
} from "../shared/outcome-model";
import { analyzeContent } from "../server/analyzer";
import type { AnalysisInput } from "../shared/types";

const numeric: FeatureSpec = { key: "x", label: "X", kind: "numeric" };
const color: FeatureSpec = { key: "c", label: "Colour", kind: "categorical" };

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test("CART finds the threshold that separates two numeric classes", () => {
  const samples: Sample[] = [1, 2, 3, 4, 10, 11, 12, 13].map((x) => ({
    features: { x },
    label: x < 7 ? "low" : "high",
  }));
  const model = trainCart(samples, [numeric], { prune: false });
  assert.equal(model.root.kind, "split");
  if (model.root.kind !== "split") return;
  assert.equal(model.root.test.type, "lte");
  assert.equal(model.root.test.type === "lte" && model.root.test.threshold, 7);
  assert.equal(predictCart(model, { x: 0 }).label, "low");
  assert.equal(predictCart(model, { x: 20 }).label, "high");
  assert.equal(model.importance[0].key, "x");
  assert.equal(model.importance[0].value, 1);
});

test("CART groups categories into the optimal binary partition", () => {
  const samples: Sample[] = [];
  for (const c of ["red", "orange", "blue", "teal"])
    for (let i = 0; i < 3; i++)
      samples.push({ features: { c }, label: c === "red" || c === "orange" ? "warm" : "cool" });
  const model = trainCart(samples, [color], { prune: false });
  assert.equal(model.root.kind, "split");
  if (model.root.kind !== "split" || model.root.test.type !== "in") return;
  const group = [...model.root.test.values].sort().join(",");
  assert.ok(group === "blue,teal" || group === "orange,red", group);
  assert.equal(leafCount(model.root), 2);
  assert.equal(predictCart(model, { c: "orange" }).label, "warm");
});

test("missing values follow the larger branch instead of failing", () => {
  const samples: Sample[] = [
    ...[1, 2, 3, 4, 5, 6].map((x) => ({ features: { x }, label: "a" })),
    ...[20, 21].map((x) => ({ features: { x }, label: "b" })),
    { features: { x: null }, label: "a" },
  ];
  const model = trainCart(samples, [numeric], { prune: false, minSamplesLeaf: 1 });
  const prediction = predictCart(model, { x: null });
  assert.equal(prediction.label, "a");
  assert.equal(prediction.path.length, 1);
});

test("cost-complexity pruning collapses splits that only fit noise", () => {
  const random = rng(7);
  const samples: Sample[] = Array.from({ length: 60 }, () => ({
    features: { x: Math.round(random() * 100) },
    label: random() < 0.5 ? "a" : "b",
  }));
  const grown = trainCart(samples, [numeric], { prune: false, maxDepth: 6, minSamplesLeaf: 1 });
  const pruned = trainCart(samples, [numeric], { maxDepth: 6, minSamplesLeaf: 1 });
  assert.ok(leafCount(grown.root) > 4);
  assert.ok(leafCount(pruned.root) < leafCount(grown.root));
  assert.ok(pruned.validation);
  // On pure noise the tree should not claim to beat guessing by much.
  assert.ok(pruned.validation!.accuracy <= pruned.validation!.baseline + 0.15);
});

test("pruning path increases and ends at a single leaf", () => {
  const random = rng(3);
  const samples: Sample[] = Array.from({ length: 40 }, () => {
    const x = Math.round(random() * 50);
    return { features: { x }, label: x > 25 !== random() < 0.2 ? "hi" : "lo" };
  });
  const grown = trainCart(samples, [numeric], { prune: false, maxDepth: 5, minSamplesLeaf: 1 });
  const path = pruningPath(grown.root);
  assert.equal(path[0], 0);
  for (let i = 1; i < path.length; i++) assert.ok(path[i] >= path[i - 1] - 1e-12);
  assert.equal(pruneTree(grown.root, path[path.length - 1]).kind, "leaf");
  // Alpha 0 only removes splits that do not reduce misclassifications.
  assert.ok(leafCount(pruneTree(grown.root, 0)) <= leafCount(grown.root));
});

test("a real signal survives pruning and beats the majority baseline", () => {
  const random = rng(11);
  const samples: Sample[] = Array.from({ length: 50 }, () => {
    const x = Math.round(random() * 100);
    const c = random() < 0.5 ? "red" : "blue";
    const label = x > 60 ? "hi" : "lo";
    return { features: { x, c }, label: random() < 0.08 ? (label === "hi" ? "lo" : "hi") : label };
  });
  const model = trainCart(samples, [numeric, color]);
  assert.ok(model.validation);
  assert.ok(model.validation!.accuracy > model.validation!.baseline);
  assert.equal(model.importance[0].key, "x");
  const rules = extractRules(model);
  assert.equal(rules.reduce((sum, r) => sum + r.n, 0), 50);
  assert.ok(rules.every((r) => r.conditions.length > 0));
});

function input(text: string, platform: AnalysisInput["platform"] = "instagram"): AnalysisInput {
  return {
    title: "Post",
    text,
    type: "text",
    platform,
    goal: "engagement",
    audience: "New founders in India",
    timezone: "Asia/Kolkata",
  };
}

const STRONG =
  "Stop wasting your first hour. Here are 3 steps that saved me 10 hours a week: plan the night before, batch your messages, block one deep-work slot. Which one will you try tomorrow?";
const WEAK = "Hello everyone, hope you are all doing well today and having a nice week.";

function logged(text: string, views: number, interactions: number, scheduledAt?: string): ModelRecord {
  const i = input(text);
  return {
    input: i,
    result: analyzeContent(i),
    scheduledAt,
    outcomes: { views, likes: interactions, comments: 0, shares: 0, saves: 0 },
  };
}

test("record features use readiness signals and local posting time", () => {
  const features = recordFeatures(logged(STRONG, 100, 10, "2026-10-09T13:30:00.000Z"));
  assert.equal(features.platform, "instagram");
  assert.equal(features.day, "Fri");
  assert.equal(features.hour, 19);
  assert.equal(typeof features.hook, "number");
  assert.ok(Number(features.words) > 20);
  assert.equal(features.duration, null);
});

test("outcome model waits for enough logged posts", () => {
  const few = Array.from({ length: MIN_TRAINING_POSTS - 1 }, (_, i) => logged(STRONG, 100, i));
  const state = buildOutcomeModel(few, "engagement");
  assert.equal(state.status, "insufficient");
  const unlogged: ModelRecord = { ...logged(STRONG, 1, 1), outcomes: undefined };
  const stillFew = buildOutcomeModel([...few, unlogged], "engagement");
  assert.equal(stillFew.status, "insufficient");
});

test("outcome model learns which of a creator's posts beat their median", () => {
  const records: ModelRecord[] = [];
  for (let i = 0; i < 8; i++) {
    records.push(logged(STRONG, 1000, 90 + i));
    records.push(logged(WEAK, 1000, 20 + i));
  }
  const state = buildOutcomeModel(records, "engagement");
  assert.equal(state.status, "ready");
  if (state.status !== "ready") return;
  assert.equal(state.result.trainedOn, 16);
  assert.ok(state.result.model.validation!.accuracy > state.result.model.validation!.baseline);
  const strong = predictOutcome(state.result, logged(STRONG, 0, 0));
  const weak = predictOutcome(state.result, logged(WEAK, 0, 0));
  assert.equal(strong.label, ABOVE);
  assert.equal(weak.label, BELOW);
  assert.ok(strong.path.length > 0);
});
