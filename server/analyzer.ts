import type {
  AnalysisInput,
  AnalysisResult,
  Dimension,
  Goal,
  Platform,
  Suggestion,
} from "../shared/types.js";

/** A transparent preparation rubric, not a trained prediction of virality. */
export const DIMENSION_WEIGHTS = {
  hook: 22,
  clarity: 18,
  value: 20,
  engagement: 15,
  platform: 15,
  craft: 10,
} as const;

const PLATFORM_NAMES: Record<Platform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
};
// These are editorial starting ranges, never platform limits or an audience model.
const COPY_RANGES: Record<Platform, [number, number]> = {
  instagram: [25, 160],
  tiktok: [15, 100],
  youtube: [25, 220],
  linkedin: [40, 220],
  x: [12, 65],
};
const GENERIC_OPENING =
  /^(?:hey\b|hi\b|hello\b|welcome\b|happy\s+\w+day\b|in (?:this|today'?s) (?:post|video)|today (?:i|we) (?:want|wanted|am going|are going)|just (?:wanted|want) to|check (?:this|it) out)/i;
const ACTION =
  /\b(?:start|try|use|save|compare|build|write|check|track|measure|test|remove|replace|add|choose|learn|create|avoid|reduce|improve|practice|plan|record|list|set|review|focus|cut)\b/gi;
const VALUE =
  /\b(?:because|so that|instead|example|step|how to|here'?s how|lesson|tip|mistake|solution|reason|guide|checklist|result|before|after|learned|help|fix)\b/gi;
const BENEFIT =
  /\b(?:save|learn|build|improve|reduce|avoid|stop|start|better|easier|faster|mistake|why|how)\b/i;
const CONTRAST = /\b(?:but|instead|without|versus|vs\.?|stop|never|not)\b/i;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "another",
  "anyone",
  "because",
  "before",
  "being",
  "better",
  "could",
  "content",
  "does",
  "doing",
  "each",
  "every",
  "first",
  "from",
  "have",
  "here",
  "into",
  "just",
  "like",
  "make",
  "more",
  "most",
  "much",
  "only",
  "other",
  "over",
  "really",
  "same",
  "should",
  "some",
  "something",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "thing",
  "things",
  "this",
  "those",
  "through",
  "time",
  "today",
  "under",
  "very",
  "want",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "your",
  "yourself",
  "video",
  "post",
  "still",
  "even",
  "using",
  "used",
  "take",
  "look",
  "come",
]);

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.round(
    Math.min(
      maximum,
      Math.max(minimum, Number.isFinite(value) ? value : minimum),
    ),
  );
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const positive = (value: unknown): value is number =>
  finite(value) && value > 0;
const words = (text: string) =>
  text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
const count = (text: string, expression: RegExp) =>
  text.match(expression)?.length ?? 0;
const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const sentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((line) =>
      [...sentenceSegmenter.segment(line)]
        .map((part) => part.segment.trim())
        .filter(Boolean),
    );
const compact = (text: string) => text.replace(/\s+/g, " ").trim();
const excerpt = (text: string, length = 150) => {
  const value = compact(text);
  if (value.length <= length) return value;
  const boundary = value.lastIndexOf(" ", length - 1);
  return `${value.slice(0, boundary > length / 2 ? boundary : length - 1)}…`;
};

function addSuggestion(
  suggestions: Suggestion[],
  id: string,
  priority: Suggestion["priority"],
  title: string,
  detail: string,
  dimension: string,
  example?: string,
) {
  suggestions.push({
    id,
    priority,
    title,
    detail,
    dimension,
    ...(example ? { example } : {}),
  });
}

function goalPrompt(goal: Goal, hasActionableContent: boolean): string {
  if (goal === "community") return "What has your experience been?";
  if (goal === "conversions")
    return "What would you need to know before trying this?";
  if (hasActionableContent) return "Which step would you try first?";
  return "What would you add?";
}

function hasResponseInvitation(text: string): boolean {
  // Benefit statements such as "save time" and narration such as "we share a
  // workspace" are not calls to action. Look for an invitation or an imperative
  // with a relevant object, instead of awarding points for an isolated verb.
  if (
    /\b(?:tell me|tell us|let me know|let us know|what do you|what would you|what has your|which .{0,45}(?:try|choose|prefer))\b/i.test(
      text,
    )
  )
    return true;
  if (/[?？]\s*$/.test(text)) return true;
  const imperative =
    /(?:^|[.!?\n]\s*|\bplease\s+)(?:save\s+(?:this\b|it\b|the\s+(?:post|video|guide|checklist|recipe)\b)|share\s+(?:your\s+(?:thoughts|experience|feedback|answer|ideas)\b|this\b|it\b)|follow\s+(?:me|us|for|along)\b|subscribe\b|comment\s+(?:below\b|with\b|your\s+(?:thoughts|experience|answer|ideas)\b)|reply\s+(?:below\b|with\b|to\b|and\b))/i;
  return imperative.test(text);
}

/** Format the creator's existing words and add only a question, never new evidence. */
function optimizeCopy(
  text: string,
  goal: Goal,
  hasActionableContent: boolean,
  hasCTA: boolean,
): string {
  if (!text.trim()) return "";
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => {
      // Preserve line lists, claims, quotations and URLs exactly. Only add paragraph breaks.
      if (paragraph.includes("\n") || /https?:\/\/|["“”]/.test(paragraph))
        return paragraph.trim();
      const parts = [...sentenceSegmenter.segment(paragraph)];
      if (parts.length < 3 || words(paragraph).length < 42)
        return paragraph.trim();
      // Keep the source segments intact, replacing only existing separating whitespace.
      // Reconstructing from regex sentence matches can corrupt decimals and abbreviations.
      return parts
        .map((part, index) =>
          index % 2 === 1 && index < parts.length - 1
            ? part.segment.replace(/\s+$/, "\n\n")
            : part.segment,
        )
        .join("")
        .trim();
    });
  const formatted = paragraphs.join("\n\n");
  return hasCTA
    ? formatted
    : `${formatted}\n\n${goalPrompt(goal, hasActionableContent)}`;
}

function makeHooks(text: string, title: string, goal: Goal): string[] {
  const candidates = sentences(text).filter(
    (sentence) =>
      words(sentence).length >= 4 && !GENERIC_OPENING.test(sentence),
  );
  const first = candidates[0] ?? sentences(text)[0] ?? title.trim();
  if (!first)
    return [
      "Start with the specific question your content answers.",
      "Show the result first, then explain how you got there.",
      "Name one problem your audience recognizes, in their words.",
    ];
  const best =
    candidates.find(
      (sentence) => BENEFIT.test(sentence) || /\d/.test(sentence),
    ) ?? first;
  const body = excerpt(best, 145);
  const second = candidates.find((sentence) => sentence !== best);
  return [
    body,
    `Start here: ${excerpt(second ?? best, 132)}`,
    `${excerpt(title.trim() || first, 95).replace(/[.!?]+$/, "")} — ${goal === "community" ? "what is your experience?" : "what would you add?"}`,
  ];
}

function makeHashtags(text: string, title: string, audience: string): string[] {
  const supplied = Array.from(
    text.matchAll(/#([\p{L}\p{N}_]+)/gu),
    (match) => `#${match[1]}`,
  );
  const frequencies = new Map<string, { display: string; weight: number }>();
  for (const [source, boost] of [
    [title, 4],
    [audience, 2],
    [text, 1],
  ] as const) {
    for (const token of words(source)) {
      const key = token.toLowerCase();
      if (
        key.length < 4 ||
        key.length > 24 ||
        STOP_WORDS.has(key) ||
        /^\d/.test(key)
      )
        continue;
      const existing = frequencies.get(key);
      frequencies.set(key, {
        display: token.replace(/[^\p{L}\p{N}]/gu, ""),
        weight: (existing?.weight ?? 0) + boost,
      });
    }
  }
  const contextual = [...frequencies.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(
      (item) =>
        `#${item.display.charAt(0).toUpperCase()}${item.display.slice(1)}`,
    );
  const seen = new Set<string>();
  return [...supplied, ...contextual]
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

function mediaCraft(
  input: AnalysisInput,
  suggestions: Suggestion[],
): { score: number; evidence: string[] } {
  const media = input.media;
  if (!media) {
    addSuggestion(
      suggestions,
      "upload-source",
      "high",
      `Add your ${input.type} for a technical check`,
      "The current review can assess only the supplied words. Upload the source file to measure its format and available media signals.",
      "craft",
    );
    return {
      score: 25,
      evidence: [
        "No source file is attached; media quality cannot be assessed.",
      ],
    };
  }
  const evidence: string[] = [];
  const components: number[] = [];
  if (input.type === "image" || input.type === "video") {
    if (positive(media.width) && positive(media.height)) {
      const shorter = Math.min(media.width, media.height);
      components.push(
        shorter >= 1080 ? 90 : shorter >= 720 ? 78 : shorter >= 480 ? 58 : 30,
      );
      evidence.push(`${media.width} × ${media.height} source pixels.`);
      if (shorter < 720)
        addSuggestion(
          suggestions,
          "source-resolution",
          "high",
          "Export a clearer source",
          `The shorter edge is ${shorter}px. Preview small details at phone size; export from the original at 720px or more on the shorter edge when available.`,
          "craft",
        );
    } else {
      components.push(30);
      evidence.push("Source dimensions are unavailable.");
    }
    if (finite(media.brightness)) {
      const brightness = Math.min(255, Math.max(0, media.brightness));
      const extreme = brightness < 28 || brightness > 235;
      components.push(extreme ? 48 : 80);
      evidence.push(
        `Measured average brightness: ${Math.round(brightness)}/255; this is not a judgment of artistic quality.`,
      );
      if (extreme)
        addSuggestion(
          suggestions,
          "exposure-review",
          "medium",
          "Check detail in your brightest and darkest areas",
          "Average brightness is near one end of the range. Inspect subject and text visibility on a phone; a deliberate dark or light design may already be appropriate.",
          "craft",
        );
    }
    if (finite(media.contrast)) {
      const contrast = Math.max(0, media.contrast);
      components.push(contrast < 12 ? 55 : 82);
      evidence.push(
        `Pixel variation: ${Math.round(contrast)}; text contrast and legibility still need a visual check.`,
      );
      if (contrast < 12)
        addSuggestion(
          suggestions,
          "visual-legibility",
          "medium",
          "Preview your subject and text at thumbnail size",
          "Low pixel variation can indicate a flat frame or a deliberate minimal design. Make sure the focal point and any text remain distinguishable.",
          "craft",
        );
    }
  }
  if (input.type === "audio" || input.type === "video") {
    if (positive(media.duration)) {
      components.push(media.duration < 3 ? 42 : 78);
      evidence.push(`${Math.round(media.duration)} seconds of media.`);
      if (media.duration < 3)
        addSuggestion(
          suggestions,
          "very-short-media",
          "medium",
          "Check that the idea has enough time to land",
          "This file is under three seconds. Confirm the full message can be heard or read, or make its role as a short loop intentional.",
          "craft",
        );
    } else {
      components.push(35);
      evidence.push("Media duration is unavailable.");
    }
    if (finite(media.silenceRatio)) {
      const silenceRatio = Math.min(1, Math.max(0, media.silenceRatio));
      components.push(silenceRatio > 0.45 ? 43 : silenceRatio > 0.25 ? 65 : 84);
      evidence.push(
        `${Math.round(silenceRatio * 100)}% of the measured audio meets the silence threshold.`,
      );
      if (silenceRatio > 0.25)
        addSuggestion(
          suggestions,
          "review-pauses",
          "medium",
          "Review long silent sections",
          "Listen for pauses that do not serve the story. Trim only unnecessary silence; pacing, music, accessibility and dramatic pauses may justify keeping it.",
          "craft",
        );
    }
    if (finite(media.audioPeak)) {
      const peak = Math.min(1, Math.max(0, media.audioPeak));
      components.push(
        peak === 0 ? 25 : peak < 0.08 ? 45 : peak >= 0.999 ? 65 : 85,
      );
      evidence.push(
        `Measured audio peak: ${Math.round(peak * 100)}% of full scale; this does not measure perceived loudness.`,
      );
      if (peak < 0.08)
        addSuggestion(
          suggestions,
          "quiet-audio",
          "high",
          "Check audibility on a phone speaker",
          "The measured audio peak is low. Listen at a normal device volume, raise the voice track if needed, and provide captions or a transcript.",
          "craft",
        );
      else if (peak >= 0.999)
        addSuggestion(
          suggestions,
          "audio-headroom",
          "medium",
          "Listen for distortion near loud peaks",
          "The signal reaches full scale. Check the loudest moments and reduce gain if they distort; peak level alone cannot establish clipping.",
          "craft",
        );
    }
    if (!media.transcript?.trim())
      addSuggestion(
        suggestions,
        "add-transcript",
        "high",
        "Add the spoken words for a stronger review",
        "A transcript lets the review evaluate the actual opening, structure and call to action. A caption or file name cannot establish what is said in the recording.",
        "clarity",
      );
  }
  return {
    score: components.length
      ? clamp(
          components.reduce((sum, value) => sum + value, 0) / components.length,
        )
      : 35,
    evidence: evidence.length
      ? evidence
      : [
          "Only file metadata is available; quality signals could not be measured.",
        ],
  };
}

function assessPlatform(
  input: AnalysisInput,
  wordCount: number,
  suggestions: Suggestion[],
): { score: number; explanation: string } {
  const [low, high] = COPY_RANGES[input.platform];
  const name = PLATFORM_NAMES[input.platform];
  let score = 70;
  const evidence: string[] = [];
  if (wordCount === 0) {
    score -= 25;
    evidence.push("No caption or script is supplied.");
  } else if (wordCount < low) {
    score -= 12;
    evidence.push(
      `${wordCount} words: a brief draft against this rubric's ${low}–${high} word starting range.`,
    );
  } else if (wordCount <= high) {
    score += 14;
    evidence.push(
      `${wordCount} words, within this rubric's ${low}–${high} word starting range.`,
    );
  } else {
    score -= Math.min(32, Math.round(((wordCount - high) / high) * 20));
    evidence.push(
      `${wordCount} words, above this rubric's ${low}–${high} word starting range.`,
    );
    addSuggestion(
      suggestions,
      "tighten-format",
      "medium",
      "Give the draft a more focused first pass",
      `For this ${name} draft, separate the essential takeaway from supporting detail. The ${low}–${high} word range is an editorial test, not a platform limit; a long-form piece can intentionally exceed it.`,
      "platform",
    );
  }
  const media = input.media;
  if (
    (input.type === "image" || input.type === "video") &&
    positive(media?.width) &&
    positive(media?.height)
  ) {
    const ratio = media.width / media.height;
    const verticalFeed =
      input.platform === "tiktok" || input.platform === "instagram";
    if (verticalFeed && ratio > 1.05) {
      score -= 17;
      evidence.push(
        "Landscape source; consider a portrait variant for vertical-feed placement.",
      );
      addSuggestion(
        suggestions,
        "portrait-variant",
        "high",
        "Prepare a portrait version for the feed",
        "Preview a portrait crop that keeps faces, the focal point and on-screen text visible. Compare it with the original; choose the format that best serves the content.",
        "platform",
        input.type === "video"
          ? "Try a 9:16 export and keep essential text away from the top and bottom controls."
          : "Try a 4:5 or 9:16 version while preserving the main subject.",
      );
    } else {
      score += 7;
      evidence.push(
        "Source proportions provide a usable starting format; preview the intended placement.",
      );
    }
  }
  if (
    input.type === "audio" &&
    ["tiktok", "instagram", "youtube"].includes(input.platform)
  ) {
    score -= 15;
    evidence.push(
      "Audio needs a visual treatment for this video-oriented publishing plan.",
    );
    addSuggestion(
      suggestions,
      "audio-visual-wrapper",
      "high",
      "Package the audio with a visual",
      "Create a captioned clip, a simple waveform or a relevant still-image sequence. Check that the first frame communicates the subject with sound off.",
      "platform",
    );
  }
  if (
    input.type === "video" &&
    positive(media?.duration) &&
    media.duration > 90 &&
    ["tiktok", "instagram"].includes(input.platform)
  ) {
    score -= 8;
    evidence.push(
      "Over 90 seconds; test a shorter excerpt alongside the full version.",
    );
    addSuggestion(
      suggestions,
      "short-excerpt",
      "medium",
      "Test a focused excerpt",
      "Keep the full story if it needs the time. Also cut one self-contained passage that delivers a useful takeaway early, and compare completion rate.",
      "platform",
    );
  }
  return {
    score: clamp(score),
    explanation: `${evidence.join(" ")} Format signals cannot predict distribution.`,
  };
}

export function analyzeContent(input: AnalysisInput): AnalysisResult {
  const copy = input.text.trim();
  const transcript = input.media?.transcript?.trim() ?? "";
  // A supplied transcript is the source of truth for a recording's spoken hook.
  const corpus =
    transcript && (input.type === "audio" || input.type === "video")
      ? transcript
      : copy;
  const tokens = words(corpus);
  const wordCount = tokens.length;
  const parts = sentences(corpus);
  const opening = parts[0] ?? "";
  const openingWords = words(opening).length;
  const sentenceLengths = parts.map((sentence) => words(sentence).length);
  const averageLength = parts.length ? wordCount / parts.length : 0;
  const longestSentence = sentenceLengths.length
    ? Math.max(...sentenceLengths)
    : 0;
  const uniqueWords = new Set(tokens.map((word) => word.toLowerCase())).size;
  const repetitionRatio = wordCount ? uniqueWords / wordCount : 0;
  const actionCount = count(corpus, ACTION);
  const valueCount = count(corpus, VALUE);
  const numberCount = count(corpus, /\b\d+(?:[.,]\d+)?\b/g);
  const questionCount = count(corpus, /[?？]/g);
  const hashtagCount = count(copy, /#[\p{L}\p{N}_]+/gu);
  const hasQuestion = questionCount > 0;
  const hasCTA = hasResponseInvitation(corpus);
  const genericOpening = GENERIC_OPENING.test(opening);
  const hasAudience = words(input.audience).length >= 2;
  const hasActionableContent = actionCount >= 2 && wordCount >= 20;
  const suggestions: Suggestion[] = [];
  const strengths: string[] = [];
  const dimensions: Dimension[] = [];
  const dimension = (
    id: keyof typeof DIMENSION_WEIGHTS,
    label: string,
    score: number,
    explanation: string,
  ) => {
    dimensions.push({
      id,
      label,
      score: clamp(score),
      weight: DIMENSION_WEIGHTS[id],
      explanation,
    });
  };

  let hook = wordCount ? 32 : 10;
  if (openingWords >= 4 && openingWords <= 24) hook += 21;
  else if (openingWords > 24) hook += 6;
  if (/[?？]/.test(opening)) hook += 10;
  if (BENEFIT.test(opening)) hook += 14;
  if (/\d/.test(opening)) hook += 9;
  if (CONTRAST.test(opening)) hook += 7;
  if (genericOpening) hook -= 22;
  if (openingWords > 42) hook -= 15;
  dimension(
    "hook",
    "Opening hook",
    hook,
    wordCount
      ? `The opening contains ${openingWords} words.${genericOpening ? " It starts with a generic greeting or setup." : ""}${BENEFIT.test(opening) ? " It names a benefit or problem." : ""}${/\d/.test(opening) ? " It includes a concrete number; the truth of that number is not verified." : ""}${/[?？]/.test(opening) ? " It poses a question." : ""} This checks wording, not whether people will stop scrolling.`
      : "No opening words are available to assess.",
  );
  if (hook < 67)
    addSuggestion(
      suggestions,
      "lead-with-value",
      "high",
      "Make the first line earn the next one",
      genericOpening
        ? "Move past the greeting and open with a specific problem, useful result or question already supported by your content."
        : "State the specific question or useful takeaway immediately. Keep the first sentence focused and make sure the content delivers on it.",
      "hook",
      makeHooks(corpus, input.title, input.goal)[0],
    );
  else
    strengths.push(
      "The opening has a concrete benefit, question or number that gives readers a reason to continue.",
    );

  let clarity = wordCount ? 42 : 10;
  if (averageLength >= 5 && averageLength <= 23) clarity += 28;
  else if (averageLength > 23 && averageLength <= 32) clarity += 12;
  if (wordCount >= 20) clarity += 12;
  if (parts.length >= 2) clarity += 7;
  if (/\n/.test(corpus)) clarity += 6;
  if (longestSentence > 42) clarity -= 16;
  const allCapsCount = tokens.filter((token) =>
    /^[A-Z]{3,}$/.test(token),
  ).length;
  if (allCapsCount / Math.max(1, wordCount) > 0.25) clarity -= 15;
  if (wordCount > 30 && repetitionRatio < 0.35) clarity -= 20;
  dimension(
    "clarity",
    "Clarity & flow",
    clarity,
    wordCount
      ? `${wordCount} words across ${parts.length} sentence${parts.length === 1 ? "" : "s"}; average ${Math.round(averageLength)} words per sentence.${longestSentence > 42 ? ` The longest sentence has ${longestSentence} words and may be hard to scan.` : ""}${/\n/.test(corpus) ? " Line breaks provide visual structure." : ""} Language complexity and factual accuracy are not assessed.`
      : "Provide the caption, script or transcript so the structure can be assessed.",
  );
  if (longestSentence > 32 || (wordCount > 80 && !/\n/.test(corpus)))
    addSuggestion(
      suggestions,
      "shorten-sentences",
      "high",
      "Make the draft easier to scan",
      "Split the longest sentence at a natural pause and put each main idea in its own short paragraph. Keep any conditions or caveats attached to the claim they qualify.",
      "clarity",
    );
  else if (clarity >= 75)
    strengths.push(
      "Sentence length and structure make the supplied words reasonably easy to scan.",
    );

  let value = wordCount ? 27 : 10;
  value += Math.min(27, actionCount * 6);
  value += Math.min(24, valueCount * 7);
  value += Math.min(10, numberCount * 4);
  if (wordCount >= 35) value += 8;
  if (hasAudience) value += 5;
  if (wordCount < 15) value -= 12;
  dimension(
    "value",
    "Audience value",
    value,
    `${actionCount} action-word signal${actionCount === 1 ? "" : "s"} and ${valueCount} explanation/example signal${valueCount === 1 ? "" : "s"} in the supplied words.${hasAudience ? " An audience brief is provided; actual audience fit is unverified." : " No specific audience brief is provided."} These are vocabulary cues, not a semantic judgment or evidence of novelty.`,
  );
  if (value < 68)
    addSuggestion(
      suggestions,
      "specific-takeaway",
      "high",
      "Give your audience one concrete takeaway",
      "Add a usable step, a genuine example or a clearly explained observation. Use only results and experience you can support; replace broad promises with the detail your audience needs.",
      "value",
      "Try this structure: [specific problem] → [one practical step] → [why it helps, with evidence you have].",
    );
  else
    strengths.push(
      "The draft includes action or explanation cues that can make the idea useful.",
    );
  if (!hasAudience)
    addSuggestion(
      suggestions,
      "define-audience",
      "medium",
      "Name the reader you want to help",
      "Describe a specific group, their familiarity with the topic and the problem they have. Then check whether your examples and language meet that brief.",
      "value",
      "For example: first-time creators who want to make clearer educational videos.",
    );

  let engagement = wordCount ? 32 : 10;
  if (hasCTA) engagement += 28;
  if (hasQuestion) engagement += 13;
  if (/\b(?:you|your)\b/i.test(corpus)) engagement += 10;
  if (hasAudience) engagement += 6;
  if (questionCount > 4) engagement -= 12;
  if (
    /\b(?:like and share|like,? comment,? (?:and )?share|tag \d+ friends|guaranteed (?:viral|views)|100% viral)\b/i.test(
      corpus,
    )
  )
    engagement -= 20;
  dimension(
    "engagement",
    "Conversation potential",
    engagement,
    `${hasCTA ? "A response or next-step invitation is present." : "There is no clear invitation to respond or take a next step."} ${questionCount} question${questionCount === 1 ? "" : "s"} detected. This evaluates the invitation, not expected engagement.`,
  );
  if (!hasCTA)
    addSuggestion(
      suggestions,
      "one-next-step",
      "high",
      "End with one relevant next step",
      input.goal === "conversions"
        ? "Choose one real action your viewer can take and explain what they will get. Add the actual destination yourself; do not make up an offer or link."
        : "Invite a useful response that follows naturally from the idea. Give readers one thing to answer instead of several competing requests.",
      "engagement",
      goalPrompt(input.goal, hasActionableContent),
    );
  else if (questionCount > 4)
    addSuggestion(
      suggestions,
      "focus-question",
      "medium",
      "Choose one main question",
      "There are several questions in this draft. Keep the one that best serves your goal as the closing invitation.",
      "engagement",
    );
  else if (engagement >= 72)
    strengths.push(
      "The draft includes a clear invitation to respond or continue.",
    );

  const platform = assessPlatform(
    input,
    words(copy || transcript).length,
    suggestions,
  );
  dimension("platform", "Platform fit", platform.score, platform.explanation);

  if (input.type === "text") {
    let craft = wordCount ? 62 : 10;
    if (wordCount >= 20 && repetitionRatio >= 0.5) craft += 16;
    if (hashtagCount <= 5) craft += 8;
    else craft -= Math.min(25, (hashtagCount - 5) * 3);
    if (allCapsCount / Math.max(1, wordCount) > 0.25) craft -= 15;
    if (wordCount > 30 && repetitionRatio < 0.35) craft -= 25;
    if (/[!?]{3,}/.test(copy)) craft -= 12;
    dimension(
      "craft",
      "Copy readiness",
      craft,
      `${hashtagCount} hashtag${hashtagCount === 1 ? "" : "s"}.${wordCount ? ` ${uniqueWords} distinct words among ${wordCount} words.` : ""} This checks repetition and presentation; originality, truth and relevance need editorial review.`,
    );
    if (wordCount > 30 && repetitionRatio < 0.35)
      addSuggestion(
        suggestions,
        "reduce-repetition",
        "high",
        "Replace repetition with supporting detail",
        "Many of the words repeat. Remove duplicated phrases and use the space for one useful example or clarification.",
        "craft",
      );
  } else {
    const craft = mediaCraft(input, suggestions);
    dimension(
      "craft",
      "Media readiness",
      craft.score,
      craft.evidence.join(" "),
    );
    if (craft.score >= 76)
      strengths.push(
        "The available technical media signals provide a workable source for a publishing test.",
      );
  }
  if (hashtagCount > 5)
    addSuggestion(
      suggestions,
      "focus-hashtags",
      "low",
      "Keep the tags specific to the topic",
      "Choose a small set that accurately describes the content. The suggested tags are extracted from your words and have no verified trend or search-volume data.",
      "craft",
    );
  if (wordCount < 20)
    addSuggestion(
      suggestions,
      "add-context",
      "high",
      "Add enough context to evaluate the idea",
      "This is a short sample. Supply the complete caption or script, including the opening, actual takeaway and ending, before using the score to compare revisions.",
      "clarity",
    );
  if (input.type === "image")
    addSuggestion(
      suggestions,
      "image-accessibility",
      "medium",
      "Check the image at phone size and add alt text",
      "Confirm the focal point and text remain readable. Write a concise description of meaningful visual information; local pixel measurements cannot understand the image.",
      "craft",
    );
  if (input.type === "video")
    addSuggestion(
      suggestions,
      "video-opening",
      "medium",
      "Review the first three seconds with sound off",
      "Make the topic visible immediately and add accurate captions for speech. Local file measurements cannot judge the visual story or whether the opening earns attention.",
      "hook",
    );

  const technicalOnly = input.type !== "text" && wordCount === 0;
  if (technicalOnly) {
    // Missing semantic evidence is unknown, not evidence of poor content.
    // Only measured technical properties contribute until words are supplied.
    for (const item of dimensions) {
      if (item.id === "craft") item.weight = 100;
      else {
        item.weight = 0;
        item.score = 0;
        item.explanation =
          "Not assessed: no caption or transcript is available. Add context to assess this signal; its weight is excluded from this technical-only result.";
      }
    }
    const usefulSuggestions = suggestions.filter(
      (item) =>
        item.dimension === "craft" ||
        item.id === "add-context" ||
        item.id === "video-opening",
    );
    suggestions.splice(0, suggestions.length, ...usefulSuggestions);
  }
  const score = clamp(
    dimensions.reduce((sum, item) => sum + (item.score * item.weight) / 100, 0),
  );
  const confidence =
    wordCount >= 40 && (input.type === "text" || words(transcript).length >= 30)
      ? "medium"
      : "low";
  const verdict = technicalOnly
    ? "Technical signals only"
    : score >= 80
      ? "Ready for a thoughtful test"
      : score >= 65
        ? "Promising, with room to sharpen"
        : score >= 45
          ? "A useful starting point"
          : "Give the idea more shape";
  const weakest = dimensions
    .filter((item) => item.weight > 0)
    .sort((a, b) => a.score - b.score)[0];
  const priorities = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => priorities[a.priority] - priorities[b.priority]);
  const summary = technicalOnly
    ? `${score}/100 for the available technical media signals only. Your message, hook and audience value have not been assessed. Add a caption or transcript for a content assessment. This result cannot be compared directly with a full content score or used to predict virality.`
    : `${score}/100 on an explainable content-readiness rubric. ${weakest.score < 72 ? `Focus your next revision on ${weakest.label.toLowerCase()}.` : "The measured signals are well balanced; test the draft with your audience."} ${confidence === "low" ? "Limited text or media evidence lowers confidence in this review." : "Confidence is medium for the measured signals only."} This is not a probability of going viral.`;
  const limitations = [
    "This local review uses transparent wording and file-metadata heuristics. It is not a trained virality model, cannot guarantee reach, and does not estimate the probability of going viral.",
    "Scores are editorial readiness indicators. They do not verify factual claims, originality, audience fit, emotional impact or platform recommendation behavior.",
    "Publishing windows are starting hypotheses in the selected timezone. No connected account analytics, current trend data or live audience activity is used.",
    "Hashtags are suggested from the supplied words. Their popularity, safety in context and search volume have not been checked.",
    "Language signals currently use English vocabulary; other languages can receive less informative scores. Compare revisions with the same platform and review mode.",
  ];
  if (input.type !== "text")
    limitations.push(
      "Local mode does not understand visual scenes, image text, music, speech tone or story pacing. Technical measurements describe only the available source signals.",
    );
  if ((input.type === "audio" || input.type === "video") && !transcript)
    limitations.push(
      "No transcript is available. Wording dimensions use the supplied caption or script and do not assess the actual spoken words.",
    );
  if (transcript)
    limitations.push(
      "When a transcript is present, wording dimensions review the transcript; platform copy length and the suggested caption use the supplied caption when available.",
    );

  return {
    score,
    verdict,
    summary,
    confidence,
    mode: "local",
    dimensions,
    suggestions,
    strengths,
    optimizedText: optimizeCopy(
      copy || transcript,
      input.goal,
      hasActionableContent,
      // Do not let a CTA in a separate transcript suppress a needed caption invitation.
      copy && transcript ? hasResponseInvitation(copy) : hasCTA,
    ),
    hooks: makeHooks(corpus, input.title, input.goal),
    hashtags: makeHashtags(copy || transcript, input.title, input.audience),
    publishing: getPublishingRecommendations(input.platform, input.timezone),
    metrics: makeMetrics(input, wordCount, openingWords, hasCTA),
    limitations,
  };
}

function makeMetrics(
  input: AnalysisInput,
  wordCount: number,
  openingWords: number,
  hasCTA: boolean,
): AnalysisResult["metrics"] {
  const metrics: AnalysisResult["metrics"] = [
    {
      label: "Words reviewed",
      value: String(wordCount),
      detail:
        input.media?.transcript &&
        (input.type === "audio" || input.type === "video")
          ? "Measured from the supplied transcript."
          : "Measured from your supplied caption or script.",
    },
    {
      label: "Opening length",
      value: `${openingWords} words`,
      detail:
        "Read the first sentence aloud. Keep the core idea clear before adding context.",
    },
    {
      label: "Next step",
      value: hasCTA ? "Present" : "Add one",
      detail: "Give the audience one relevant action that matches your goal.",
    },
  ];
  if (positive(input.media?.duration))
    metrics.push({
      label: "Source duration",
      value: `${Math.round(input.media.duration)} sec`,
      detail:
        "Measured file duration; review where viewers receive the first useful payoff.",
    });
  if (input.type === "video" || input.type === "audio")
    metrics.push({
      label: "Retention",
      value: "Track after release",
      detail:
        "Record average watch/listen time and completion rate. Compare posts of similar duration on the same platform.",
    });
  else
    metrics.push({
      label: "Save rate",
      value: "Track after release",
      detail:
        "Saves ÷ views × 100, when the platform provides both. Compare against your own similar posts.",
    });
  metrics.push({
    label: "Share rate",
    value: "Track after release",
    detail:
      "Shares ÷ views × 100, when available. Use a consistent reporting window such as seven days.",
  });
  metrics.push(
    input.goal === "conversions"
      ? {
          label: "Conversion rate",
          value: "Track after release",
          detail:
            "Completed goal actions ÷ tracked visits × 100. Use a real tagged destination and one defined action.",
        }
      : {
          label: "Conversation rate",
          value: "Track after release",
          detail:
            "Comments ÷ views × 100, when available. Also read responses to understand whether the idea connected.",
        },
  );
  return metrics;
}

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const WINDOW_PROFILES: Record<Platform, number[]> = {
  linkedin: [17, 12, 16, 40, 72, 82, 85, 76, 70, 53, 35, 22],
  x: [26, 18, 21, 43, 73, 78, 84, 76, 80, 77, 62, 40],
  instagram: [34, 20, 18, 30, 49, 64, 76, 64, 76, 88, 85, 55],
  tiktok: [44, 24, 19, 27, 44, 58, 70, 67, 76, 84, 89, 73],
  youtube: [33, 22, 18, 25, 43, 59, 73, 78, 85, 86, 74, 49],
};

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
}

export function getPublishingRecommendations(
  platform: Platform,
  timezone: string,
): AnalysisResult["publishing"] {
  let validTimezone = timezone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    validTimezone = "UTC";
  }
  // Deliberately static hypotheses: common workday / leisure windows to experiment with.
  const profile = WINDOW_PROFILES[platform];
  const heatmap = DAYS.map((_, day) =>
    profile.map((base, index) => {
      const hour = index * 2;
      const weekday = day < 5;
      const workdayBump =
        platform === "linkedin"
          ? weekday
            ? [0, 5, 4, 3, -4][day]
            : -21
          : platform === "x"
            ? weekday
              ? [0, 2, 4, 3, 0][day]
              : -5
            : weekday
              ? [0, 2, 3, 4, 1][day]
              : 5;
      const weekendLeisure =
        !weekday && hour >= 10 && hour <= 16 && platform !== "linkedin" ? 4 : 0;
      return clamp(base + workdayBump + weekendLeisure, 10, 95);
    }),
  );
  const ranked = heatmap
    .flatMap((row, dayIndex) =>
      row.map((strength, index) => ({
        day: DAYS[dayIndex],
        dayIndex,
        hour: index * 2,
        strength,
      })),
    )
    .sort(
      (a, b) =>
        b.strength - a.strength || a.dayIndex - b.dayIndex || a.hour - b.hour,
    );
  const selectedDays = new Set<number>();
  const slots = ranked
    .filter((slot) => {
      if (selectedDays.has(slot.dayIndex) || selectedDays.size >= 3)
        return false;
      selectedDays.add(slot.dayIndex);
      return true;
    })
    .map((slot) => ({
      ...slot,
      label: `${slot.day.slice(0, 3)} · ${hourLabel(slot.hour)}–${hourLabel((slot.hour + 2) % 24)}`,
      reason: `${slot.hour < 10 ? "Morning" : slot.hour < 16 ? "Midday" : "Evening"} ${slot.dayIndex < 5 ? "weekday" : "weekend"} window to test. Compare retention, saves and shares with your own baseline; audience activity is unverified.`,
    }));
  return {
    timezone: validTimezone,
    slots,
    heatmap,
    basis: `Starting hypotheses for ${PLATFORM_NAMES[platform]}, based on assumed workday and leisure routines, not account analytics or measured audience activity. All 2-hour windows use ${validTimezone}. The 0–100 values rank test priority, not expected reach. Test at least three comparable posts per window, then replace these defaults with your own results.`,
  };
}
