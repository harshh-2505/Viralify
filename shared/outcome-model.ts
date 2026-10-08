/**
 * Learns from a creator's own logged outcomes with a CART decision tree.
 *
 * Each record whose results were logged becomes one training sample. Its
 * features are what Viralify already knew before publishing (readiness
 * signals, platform, format, length, planned posting time). Its label is
 * whether the post did better than the creator's own median for the chosen
 * outcome. The tree is therefore a summary of *this creator's* history, not a
 * general virality model.
 */
import {
  extractRules,
  predictCart,
  trainCart,
  type CartModel,
  type FeatureSpec,
  type FeatureValue,
  type Prediction,
  type Rule,
  type Sample,
} from "./cart";
import type { AnalysisInput, AnalysisResult, AnalysisRecord } from "./types";

export type OutcomeTarget = "engagement" | "views";

export const OUTCOME_TARGETS: Record<OutcomeTarget, { label: string; short: string }> = {
  engagement: { label: "Engagement rate", short: "engagement" },
  views: { label: "Views", short: "views" },
};

export const ABOVE = "Above your median";
export const BELOW = "At or below your median";

/** Fewest logged posts before a tree is trained. Below this, splits are mostly noise. */
export const MIN_TRAINING_POSTS = 10;

/** The subset of a record the model needs; real AnalysisRecords satisfy it. */
export interface ModelRecord {
  id?: string;
  input: Pick<AnalysisInput, "platform" | "type" | "goal" | "text" | "timezone"> & {
    media?: Pick<NonNullable<AnalysisInput["media"]>, "duration">;
  };
  result: Pick<AnalysisResult, "score" | "dimensions">;
  scheduledAt?: string;
  outcomes?: AnalysisRecord["outcomes"];
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
};
const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  image: "Image",
  audio: "Audio",
  video: "Video",
};
const GOAL_LABELS: Record<string, string> = {
  reach: "Reach",
  engagement: "Engagement",
  community: "Community",
  conversions: "Conversions",
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const lookup = (table: Record<string, string>) => (v: number | string) =>
  table[String(v)] ?? String(v);
const whole = (v: number | string) => String(Math.round(Number(v)));

function hourLabel(v: number | string) {
  // Thresholds fall between whole hours (e.g. 13.5), so show the next full hour.
  const h = Math.ceil(Number(v)) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

export const OUTCOME_FEATURES: FeatureSpec[] = [
  { key: "readiness", label: "Readiness score", kind: "numeric", format: whole },
  { key: "hook", label: "Opening hook score", kind: "numeric", format: whole },
  { key: "clarity", label: "Clarity score", kind: "numeric", format: whole },
  { key: "value", label: "Audience value score", kind: "numeric", format: whole },
  { key: "engagement", label: "Conversation score", kind: "numeric", format: whole },
  { key: "platform_fit", label: "Platform fit score", kind: "numeric", format: whole },
  { key: "craft", label: "Copy readiness score", kind: "numeric", format: whole },
  { key: "words", label: "Word count", kind: "numeric", format: whole },
  { key: "duration", label: "Media length (s)", kind: "numeric", format: whole },
  { key: "platform", label: "Platform", kind: "categorical", format: lookup(PLATFORM_LABELS) },
  { key: "format", label: "Format", kind: "categorical", format: lookup(TYPE_LABELS) },
  { key: "goal", label: "Goal", kind: "categorical", format: lookup(GOAL_LABELS) },
  { key: "day", label: "Posting day", kind: "categorical" },
  { key: "hour", label: "Posting hour", kind: "numeric", format: hourLabel },
];

const DIMENSION_FEATURES: Record<string, string> = {
  hook: "hook",
  clarity: "clarity",
  value: "value",
  engagement: "engagement",
  platform: "platform_fit",
  craft: "craft",
};

function localDayHour(iso: string, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const day = parts.find((p) => p.type === "weekday")?.value;
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    if (!day || !DAYS.includes(day) || !Number.isFinite(hour)) return null;
    return { day, hour: hour % 24 };
  } catch {
    return null;
  }
}

/** Features known before publishing. Missing evidence stays missing (null). */
export function recordFeatures(record: ModelRecord): Record<string, FeatureValue> {
  const features: Record<string, FeatureValue> = {
    readiness: record.result.score,
    platform: record.input.platform,
    format: record.input.type,
    goal: record.input.goal,
    words: record.input.text.trim() ? record.input.text.trim().split(/\s+/).length : 0,
    duration: record.input.media?.duration ?? null,
    day: null,
    hour: null,
  };
  for (const key of Object.values(DIMENSION_FEATURES)) features[key] = null;
  for (const d of record.result.dimensions) {
    const key = DIMENSION_FEATURES[d.id];
    // Weight 0 marks a dimension as "not assessed" (e.g. media without a caption).
    if (key && d.weight > 0) features[key] = d.score;
  }
  if (record.scheduledAt) {
    const when = localDayHour(record.scheduledAt, record.input.timezone);
    if (when) {
      features.day = when.day;
      features.hour = when.hour;
    }
  }
  return features;
}

export function outcomeValue(record: ModelRecord, target: OutcomeTarget): number | null {
  const o = record.outcomes;
  if (!o) return null;
  if (target === "views") return o.views;
  if (o.views <= 0) return null;
  return ((o.likes + o.comments + o.shares + o.saves) / o.views) * 100;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface OutcomeModel {
  target: OutcomeTarget;
  /** The creator's median for the target; the line between the two classes. */
  median: number;
  model: CartModel;
  rules: Rule[];
  trainedOn: number;
}

export type OutcomeModelState =
  | { status: "ready"; result: OutcomeModel }
  | { status: "insufficient"; usable: number; required: number; reason: string };

export function buildOutcomeModel(
  records: ModelRecord[],
  target: OutcomeTarget,
): OutcomeModelState {
  const usable = records
    .map((r) => ({ r, y: outcomeValue(r, target) }))
    .filter((x): x is { r: ModelRecord; y: number } => x.y !== null && Number.isFinite(x.y));
  if (usable.length < MIN_TRAINING_POSTS)
    return {
      status: "insufficient",
      usable: usable.length,
      required: MIN_TRAINING_POSTS,
      reason: `Log results for at least ${MIN_TRAINING_POSTS} posts${target === "engagement" ? " with views above zero" : ""} to train a tree.`,
    };
  const mid = median(usable.map((x) => x.y));
  const samples: Sample[] = usable.map(({ r, y }) => ({
    features: recordFeatures(r),
    label: y > mid ? ABOVE : BELOW,
  }));
  if (!samples.some((s) => s.label === ABOVE) || !samples.some((s) => s.label === BELOW))
    return {
      status: "insufficient",
      usable: usable.length,
      required: MIN_TRAINING_POSTS,
      reason: "Every logged post has the same result, so there is nothing to tell apart yet.",
    };
  const model = trainCart(samples, OUTCOME_FEATURES, {
    maxDepth: usable.length >= 40 ? 4 : 3,
    minSamplesLeaf: usable.length >= 40 ? 3 : 2,
  });
  return {
    status: "ready",
    result: { target, median: mid, model, rules: extractRules(model), trainedOn: usable.length },
  };
}

export function predictOutcome(outcome: OutcomeModel, record: ModelRecord): Prediction {
  return predictCart(outcome.model, recordFeatures(record));
}

/** True when cross-validation shows the tree beats always guessing the majority class. */
export function beatsBaseline(outcome: OutcomeModel) {
  const v = outcome.model.validation;
  return Boolean(v && v.accuracy > v.baseline + 1e-9);
}
