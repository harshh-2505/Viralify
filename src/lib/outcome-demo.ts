import type { ModelRecord } from "../../shared/outcome-model";
import type { Dimension, Platform } from "../../shared/types";

/**
 * Synthetic history for demonstrating the decision tree before a creator has
 * logged real results. It is generated, never saved, and always labelled as
 * synthetic in the interface. Planted patterns, with noise: stronger opening
 * hooks and evening posting raise the engagement rate; short-video platforms
 * (TikTok, YouTube) draw more views.
 */
export function syntheticHistory(count = 48, seed = 20261008): ModelRecord[] {
  let state = seed;
  const random = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const score = (lo: number, hi: number) => Math.round(lo + random() * (hi - lo));
  const platforms: Platform[] = ["instagram", "tiktok", "linkedin", "youtube", "x"];
  const start = Date.parse("2026-06-01T00:00:00.000Z");

  return Array.from({ length: count }, (_, i) => {
    const hook = score(25, 92);
    const platform = pick(platforms);
    const hourLocal = pick([8, 9, 12, 13, 15, 18, 19, 20, 21, 22]);
    const dims: Dimension[] = [
      ["hook", "Opening hook", hook, 22],
      ["clarity", "Clarity and flow", score(40, 90), 18],
      ["value", "Audience value", score(35, 90), 20],
      ["engagement", "Conversation potential", score(30, 90), 15],
      ["platform", "Platform fit", score(45, 90), 15],
      ["craft", "Copy readiness", score(50, 95), 10],
    ].map(([id, label, s, weight]) => ({
      id: id as string,
      label: label as string,
      score: s as number,
      weight: weight as number,
      explanation: "Synthetic example",
    }));
    const readiness = Math.round(
      dims.reduce((sum, d) => sum + d.score * d.weight, 0) / 100,
    );
    // Asia/Kolkata is UTC+05:30; convert the local posting hour to UTC.
    const scheduledAt = new Date(
      start + i * 86_400_000 + (hourLocal * 60 - 330) * 60_000,
    ).toISOString();
    const evening = hourLocal >= 18;
    let rate = 3 + (hook >= 60 ? 3 : 0) + (evening ? 2 : 0) + random() * 1.2;
    if (random() < 0.06) rate = 2 + random() * 8; // occasional surprise post
    const views =
      platform === "tiktok" || platform === "youtube"
        ? score(3500, 9000)
        : score(800, 4500);
    const interactions = Math.round((views * rate) / 100);
    const likes = Math.round(interactions * 0.7);
    const comments = Math.round(interactions * 0.1);
    const shares = Math.round(interactions * 0.08);
    return {
      id: `synthetic-${i}`,
      input: {
        platform,
        type: pick(["text", "image", "video"] as const),
        goal: "engagement" as const,
        text: "word ".repeat(score(20, 160)).trim(),
        timezone: "Asia/Kolkata",
      },
      result: { score: readiness, dimensions: dims },
      scheduledAt,
      outcomes: {
        views,
        likes,
        comments,
        shares,
        saves: Math.max(0, interactions - likes - comments - shares),
      },
    };
  });
}
