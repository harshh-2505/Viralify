import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeContent,
  DIMENSION_WEIGHTS,
  getPublishingRecommendations,
} from "../server/analyzer.js";
import type { AnalysisInput, ContentType, Platform } from "../shared/types.js";

const baseline: AnalysisInput = {
  title: "A better study routine",
  text: "",
  type: "text",
  platform: "linkedin",
  goal: "engagement",
  audience: "University students preparing for exams",
  timezone: "Asia/Calcutta",
};
const usefulDraft =
  "How can you build a study routine without burning out?\n\nStart with one focused 25-minute session. Write down the topic you want to understand before you begin. After the session, test yourself with 3 questions because recalling the idea helps you identify what needs more practice.\n\nWhich step would you try first?";

test("media without words excludes unknown semantic signals instead of scoring them as poor", () => {
  const result = analyzeContent({
    ...baseline,
    type: "image",
    text: "",
    media: {
      name: "photo.png",
      mimeType: "image/png",
      size: 50000,
      width: 1080,
      height: 1350,
      brightness: 125,
      contrast: 50,
    },
  });
  assert.equal(result.verdict, "Technical signals only");
  assert.equal(result.dimensions.filter((d) => d.weight > 0).length, 1);
  assert.equal(
    result.score,
    result.dimensions.find((d) => d.id === "craft")!.score,
  );
  assert.ok(
    result.dimensions
      .filter((d) => d.weight === 0)
      .every((d) => /Not assessed/.test(d.explanation)),
  );
  assert.match(result.summary, /cannot be compared directly/);
  assert.ok(result.suggestions.some((s) => s.id === "add-context"));
  assert.ok(!result.suggestions.some((s) => s.id === "one-next-step"));
});

test("explicit weights sum to 100 and determine the overall score", () => {
  const result = analyzeContent({ ...baseline, text: usefulDraft });
  assert.equal(
    Object.values(DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0),
    100,
  );
  assert.equal(result.dimensions.length, 6);
  assert.equal(
    result.score,
    Math.round(
      result.dimensions.reduce(
        (sum, item) => sum + (item.score * item.weight) / 100,
        0,
      ),
    ),
  );
  assert.ok(result.dimensions.every((item) => item.explanation.length > 20));
});

test("a useful, clear revision improves the score and resolves missing-CTA feedback", () => {
  const weak = analyzeContent({
    ...baseline,
    text: "Hey everyone! Here is my new post. Check this out!",
  });
  const stronger = analyzeContent({ ...baseline, text: usefulDraft });
  assert.ok(
    stronger.score > weak.score + 20,
    `${stronger.score} should exceed ${weak.score} by >20`,
  );
  assert.ok(weak.suggestions.some((item) => item.id === "one-next-step"));
  assert.ok(!stronger.suggestions.some((item) => item.id === "one-next-step"));
  assert.equal(weak.confidence, "low");
  assert.equal(stronger.confidence, "medium");
  assert.equal(stronger.mode, "local");
});

test("the empty and very short cases expose low evidence instead of confident predictions", () => {
  for (const text of ["", "Hello", "🔥🔥🔥", "   \n   "]) {
    const result = analyzeContent({ ...baseline, text });
    assert.equal(result.confidence, "low");
    assert.ok(Number.isFinite(result.score));
    assert.ok(result.score <= 55);
    assert.ok(result.suggestions.some((item) => item.id === "add-context"));
    assert.equal(result.hooks.length, 3);
    assert.match(result.summary, /not a probability/i);
  }
});

test("copy formatting preserves claims, caveats and punctuation; adds only a relevant question", () => {
  const text =
    "Our pilot involved 12 people, and the results may not generalize. We saw 2 improvements in the workflow after a short trial. These observations need replication before we can draw strong conclusions. The change should be tested again with a larger group and clear measures.";
  const result = analyzeContent({ ...baseline, text });
  const closing = "What would you add?";
  assert.ok(result.optimizedText.endsWith(closing));
  assert.equal(
    result.optimizedText.slice(0, -closing.length).replace(/\s+/g, " ").trim(),
    text,
  );
  assert.ok(!result.optimizedText.includes("guaranteed"));
});

test("URLs and quotations are not split by the draft formatter", () => {
  const text =
    'Read https://example.org/study.v2 for details. The author said "Use caution." We tested a process over 12 weeks and found different results each week. The evidence is preliminary and should not be assumed to apply in every case. What do you think?';
  const result = analyzeContent({ ...baseline, text });
  assert.equal(result.optimizedText, text);
});

test("copy formatting and hooks preserve decimals, abbreviations and factual qualifiers", () => {
  const text =
    "Dr. Patel reported a 2.5% change in a small pilot. The team used version 1.2 of the process with 12 volunteers, and the sample may not represent other groups. More trials are needed before the result can be generalized. Which detail would you check first?";
  const result = analyzeContent({ ...baseline, text });
  assert.equal(result.optimizedText.replace(/\s+/g, " "), text);
  assert.ok(result.hooks[0].includes("2.5%"));
  assert.ok(!result.hooks.some((hook) => hook.includes("2. 5")));
});

test("repetition and long sentences reduce readability versus useful prose", () => {
  const repetitive = Array(70).fill("great amazing content").join(" ");
  const weak = analyzeContent({ ...baseline, text: repetitive });
  const better = analyzeContent({ ...baseline, text: usefulDraft });
  assert.ok(better.score > weak.score);
  assert.ok(weak.suggestions.some((item) => item.id === "reduce-repetition"));
  assert.ok(weak.suggestions.some((item) => item.id === "shorten-sentences"));
});

test("all content types have bounded, finite results across platforms", () => {
  const types: ContentType[] = ["text", "image", "audio", "video"];
  const platforms: Platform[] = [
    "instagram",
    "tiktok",
    "youtube",
    "linkedin",
    "x",
  ];
  for (const type of types) {
    for (const platform of platforms) {
      const result = analyzeContent({
        ...baseline,
        type,
        platform,
        text: usefulDraft,
        media:
          type === "text"
            ? undefined
            : {
                name: `example.${type}`,
                mimeType: `${type}/test`,
                size: 1000,
                width: 1080,
                height: 1920,
                duration: 42,
                brightness: 120,
                contrast: 46,
                silenceRatio: 0.1,
                audioPeak: 0.8,
              },
      });
      assert.ok(result.score >= 0 && result.score <= 100);
      assert.ok(
        result.dimensions.every(
          (item) =>
            Number.isFinite(item.score) && item.score >= 0 && item.score <= 100,
        ),
      );
      assert.equal(result.hooks.length, 3);
      assert.equal(
        new Set(result.suggestions.map((item) => item.id)).size,
        result.suggestions.length,
      );
      assert.ok(!JSON.stringify(result).includes("NaN"));
      assert.ok(!JSON.stringify(result).includes("undefined"));
      assert.ok(
        result.metrics.some(
          (item) =>
            item.label === "Share rate" && item.value === "Track after release",
        ),
      );
      if (type !== "text") assert.equal(result.confidence, "low");
    }
  }
});

test("source metadata leads to actionable media feedback without claiming semantic understanding", () => {
  const result = analyzeContent({
    ...baseline,
    type: "video",
    platform: "tiktok",
    text: "A recording of our process.",
    media: {
      name: "process.mp4",
      mimeType: "video/mp4",
      size: 10000,
      width: 640,
      height: 360,
      duration: 120,
      brightness: 12,
      contrast: 8,
      audioPeak: 0.02,
      silenceRatio: 0.6,
    },
  });
  const ids = new Set(result.suggestions.map((item) => item.id));
  for (const id of [
    "source-resolution",
    "portrait-variant",
    "quiet-audio",
    "review-pauses",
    "add-transcript",
    "short-excerpt",
  ])
    assert.ok(ids.has(id), id);
  assert.ok(
    result.limitations.some((value) =>
      /does not understand visual scenes/.test(value),
    ),
  );
  assert.equal(result.confidence, "low");
});

test("clean technical source gets a higher media score than a degraded source", () => {
  const source: AnalysisInput = {
    ...baseline,
    text: usefulDraft,
    type: "video",
    platform: "instagram",
    media: {
      name: "clip.mp4",
      mimeType: "video/mp4",
      size: 100000,
      width: 1080,
      height: 1920,
      duration: 35,
      brightness: 118,
      contrast: 45,
      silenceRatio: 0.1,
      audioPeak: 0.8,
    },
  };
  const good = analyzeContent(source);
  const poor = analyzeContent({
    ...source,
    media: {
      ...source.media!,
      width: 320,
      height: 180,
      brightness: 4,
      contrast: 3,
      silenceRatio: 0.7,
      audioPeak: 0.01,
    },
  });
  assert.ok(good.score > poor.score);
  assert.ok(
    good.dimensions.find((item) => item.id === "craft")!.score >
      poor.dimensions.find((item) => item.id === "craft")!.score,
  );
});

test("absent and invalid media measurements stay finite and identify incomplete evidence", () => {
  const empty = analyzeContent({ ...baseline, type: "image" });
  assert.ok(empty.suggestions.some((item) => item.id === "upload-source"));
  const corrupt = analyzeContent({
    ...baseline,
    type: "video",
    text: usefulDraft,
    media: {
      name: "file.mp4",
      mimeType: "video/mp4",
      size: 1,
      width: NaN,
      height: Infinity,
      duration: -1,
      brightness: NaN,
      contrast: Infinity,
      audioPeak: NaN,
      silenceRatio: Infinity,
    },
  });
  assert.ok(Number.isFinite(corrupt.score));
  assert.ok(corrupt.dimensions.every((item) => Number.isFinite(item.score)));
  assert.ok(
    corrupt.dimensions
      .find((item) => item.id === "craft")!
      .explanation.includes("unavailable"),
  );
});

test("recordings review the actual transcript while preserving the supplied caption", () => {
  const result = analyzeContent({
    ...baseline,
    type: "audio",
    text: "A short caption for our study discussion.",
    media: {
      name: "discussion.mp3",
      mimeType: "audio/mpeg",
      size: 1000,
      duration: 40,
      transcript: usefulDraft,
    },
  });
  assert.equal(result.confidence, "medium");
  assert.ok(!result.suggestions.some((item) => item.id === "add-transcript"));
  assert.ok(
    result.optimizedText.startsWith(
      "A short caption for our study discussion.",
    ),
  );
  assert.match(
    result.metrics.find((item) => item.label === "Words reviewed")!.detail,
    /transcript/,
  );
  assert.ok(result.hooks[0].includes("study routine"));
});

test("suggested tags come from supplied content and are unique without trend assertions", () => {
  const result = analyzeContent({
    ...baseline,
    text: `${usefulDraft} #Study #study #ExamPrep`,
  });
  assert.ok(result.hashtags.includes("#Study"));
  assert.equal(
    result.hashtags.length,
    new Set(result.hashtags.map((tag) => tag.toLowerCase())).size,
  );
  assert.ok(result.hashtags.length <= 5);
  assert.ok(result.limitations.some((value) => value.includes("popularity")));
});

test("publishing matrix has 7 days, 12 bounded two-hour windows, and 3 distinct test days", () => {
  for (const platform of Object.keys({
    instagram: 0,
    tiktok: 0,
    youtube: 0,
    linkedin: 0,
    x: 0,
  }) as Platform[]) {
    const result = getPublishingRecommendations(platform, "Asia/Calcutta");
    assert.equal(result.timezone, "Asia/Calcutta");
    assert.equal(result.heatmap.length, 7);
    assert.ok(
      result.heatmap.every(
        (row) =>
          row.length === 12 &&
          row.every(
            (value) => Number.isInteger(value) && value >= 0 && value <= 100,
          ),
      ),
    );
    assert.equal(result.slots.length, 3);
    assert.equal(new Set(result.slots.map((slot) => slot.dayIndex)).size, 3);
    for (const slot of result.slots) {
      assert.equal(slot.strength, result.heatmap[slot.dayIndex][slot.hour / 2]);
      assert.equal(slot.strength, Math.max(...result.heatmap[slot.dayIndex]));
      assert.ok(slot.hour % 2 === 0 && slot.hour >= 0 && slot.hour < 24);
      assert.match(slot.reason, /unverified/);
    }
    assert.match(result.basis, /Starting hypotheses/);
    assert.match(result.basis, /not account analytics/);
  }
});

test("publishing recommendations preserve a valid timezone and safely label invalid direct calls", () => {
  assert.equal(
    getPublishingRecommendations("instagram", "America/New_York").timezone,
    "America/New_York",
  );
  assert.equal(
    getPublishingRecommendations("instagram", "Definitely/Invalid").timezone,
    "UTC",
  );
  assert.deepEqual(
    getPublishingRecommendations("tiktok", "UTC"),
    getPublishingRecommendations("tiktok", "UTC"),
  );
});

test("analysis is deterministic and never mutates the creator input", () => {
  const input = { ...baseline, text: usefulDraft };
  const original = structuredClone(input);
  assert.deepEqual(analyzeContent(input), analyzeContent(input));
  assert.deepEqual(input, original);
});

test("benefit language and narration do not masquerade as a response invitation", () => {
  for (const text of [
    "Save time by preparing a weekly checklist before you start the next task.",
    "We share a workspace and follow the same process to keep our records organized.",
    "The guide explains how to save money and subscribe to a service only when you need it.",
  ]) {
    const result = analyzeContent({ ...baseline, text });
    assert.ok(
      result.suggestions.some((item) => item.id === "one-next-step"),
      text,
    );
    assert.equal(
      result.metrics.find((item) => item.label === "Next step")!.value,
      "Add one",
    );
    assert.ok(result.optimizedText.length > text.length);
  }
});

test("specific response invitations and imperative next steps are recognized", () => {
  for (const invitation of [
    "Save this checklist for your next recording.",
    "Share your experience below.",
    "Please share this with a friend who is starting.",
    "Follow us for the next lesson.",
    "Subscribe for the next guide.",
    "Comment below with the step you will try.",
    "Reply with your experience.",
    "Tell me what you would change.",
    "What would you add?",
  ]) {
    const text = `Preparing a short test can help you catch recording problems before the main take. ${invitation}`;
    const result = analyzeContent({ ...baseline, text });
    assert.ok(
      !result.suggestions.some((item) => item.id === "one-next-step"),
      invitation,
    );
    assert.equal(
      result.metrics.find((item) => item.label === "Next step")!.value,
      "Present",
    );
  }
});
