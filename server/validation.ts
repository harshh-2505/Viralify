import { z } from "zod";

export const timezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone, such as Asia/Kolkata.");

export const inputSchema = z
  .object({
    title: z.string().trim().max(160).default(""),
    text: z.string().max(30_000).default(""),
    type: z.enum(["text", "image", "audio", "video"]),
    platform: z.enum(["instagram", "tiktok", "youtube", "linkedin", "x"]),
    goal: z.enum(["reach", "engagement", "community", "conversions"]),
    audience: z.string().trim().max(500).default(""),
    timezone: timezoneSchema,
    // Metadata supplied by clients is never trusted; actual uploads are measured.
    media: z.unknown().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.type === "text" && input.text.trim().length < 20) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Add at least 20 characters of content to analyze.",
      });
    }
  })
  .transform(({ media: _media, ...input }) => input);

export const outcomesSchema = z
  .object({
    views: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    likes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    comments: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    shares: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    saves: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const patchSchema = z
  .object({
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    status: z.enum(["analyzed", "scheduled", "published"]).optional(),
    outcomes: outcomesSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide a schedule, status, or outcome to update.",
  );

const score = z.number().finite().min(0).max(100);
const suggestion = z.object({
  id: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  title: z.string(),
  detail: z.string(),
  example: z.string().optional(),
  dimension: z.string(),
});
const media = z.object({
  name: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  duration: z.number().nonnegative().optional(),
  brightness: z.number().finite().optional(),
  contrast: z.number().finite().optional(),
  audioPeak: z.number().finite().optional(),
  silenceRatio: z.number().min(0).max(1).optional(),
  transcript: z.string().optional(),
  frameCount: z.number().int().nonnegative().optional(),
});

// Stored records are validated before every read; malformed files are never silently reset.
export const recordSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  input: z.object({
    title: z.string(),
    text: z.string(),
    type: z.enum(["text", "image", "audio", "video"]),
    platform: z.enum(["instagram", "tiktok", "youtube", "linkedin", "x"]),
    goal: z.enum(["reach", "engagement", "community", "conversions"]),
    audience: z.string(),
    timezone: z.string(),
    media: media.optional(),
  }),
  result: z.object({
    score,
    verdict: z.string(),
    summary: z.string(),
    confidence: z.enum(["low", "medium"]),
    mode: z.enum(["local", "ai"]),
    dimensions: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        score,
        weight: z.number().finite(),
        explanation: z.string(),
      }),
    ),
    suggestions: z.array(suggestion),
    strengths: z.array(z.string()),
    optimizedText: z.string(),
    hooks: z.array(z.string()),
    hashtags: z.array(z.string()),
    publishing: z.object({
      timezone: z.string(),
      basis: z.string(),
      heatmap: z.array(z.array(z.number().finite())),
      slots: z.array(
        z.object({
          day: z.string(),
          dayIndex: z.number().int(),
          hour: z.number().int(),
          label: z.string(),
          strength: z.number().finite(),
          reason: z.string(),
        }),
      ),
    }),
    metrics: z.array(
      z.object({ label: z.string(), value: z.string(), detail: z.string() }),
    ),
    limitations: z.array(z.string()),
  }),
  scheduledAt: z.string().datetime().optional(),
  status: z.enum(["analyzed", "scheduled", "published"]),
  outcomes: outcomesSchema.optional(),
});

export const librarySchema = z
  .array(recordSchema)
  .refine(
    (records) =>
      new Set(records.map((item) => item.id)).size === records.length,
  );
