import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import type {
  AnalysisInput,
  AnalysisRecord,
  Capabilities,
} from "../shared/types";
import { analyzeContent } from "./analyzer.js";
import {
  enhanceAnalysis,
  transcribeAudio,
  type AiConfiguration,
} from "./ai.js";
import { HttpError, StorageError } from "./errors.js";
import {
  processMedia,
  resolveFfmpeg,
  MAX_UPLOAD_BYTES,
  type ProcessedMedia,
} from "./media.js";
import { AnalysisStore } from "./store.js";
import { inputSchema, patchSchema } from "./validation.js";

export interface AppOptions {
  /** Serverless deployments return results to browser storage and never open a shared library. */
  stateless?: boolean;
  dataDir?: string;
  distDir?: string;
  openaiApiKey?: string;
  model?: string;
  transcriptionModel?: string;
  ffmpegPath?: string | null;
  allowedOrigins?: string[];
  fetcher?: typeof fetch;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  const stateless = options.stateless ?? process.env.VERCEL === "1";
  const store = stateless
    ? undefined
    : new AnalysisStore(options.dataDir ?? resolve("data"));
  // Leave space for the JSON field and multipart boundary under Vercel's 4.5 MB request cap.
  const maxUploadBytes = stateless ? 4_000_000 : MAX_UPLOAD_BYTES;
  const maxUploadMb = stateless ? 4 : 50;
  const ffmpeg = resolveFfmpeg(options.ffmpegPath);
  const apiKey = (
    options.openaiApiKey ??
    process.env.OPENAI_API_KEY ??
    ""
  ).trim();
  const model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const ai: AiConfiguration = {
    apiKey,
    model,
    transcriptionModel:
      options.transcriptionModel ??
      process.env.OPENAI_TRANSCRIPTION_MODEL ??
      "gpt-4o-mini-transcribe",
    fetcher: options.fetcher,
  };
  const capabilities: Capabilities = {
    aiEnabled: Boolean(apiKey),
    mediaEnabled: Boolean(ffmpeg),
    maxUploadMb,
    maxUploadBytes,
    model: apiKey ? model : null,
    storageMode: stateless ? "browser" : "server",
  };
  const origins = new Set(
    options.allowedOrigins ??
      (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean),
  );
  // Platform-owned environment variables contain exact hostnames, never a wildcard tenant allowlist.
  if (process.env.VERCEL === "1") {
    for (const domain of [
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_BRANCH_URL,
    ]) {
      if (!domain) continue;
      try {
        const url = new URL(`https://${domain}`);
        if (url.host === domain && !url.username && !url.password)
          origins.add(url.origin);
      } catch {
        /* Invalid deployment metadata grants no access. */
      }
    }
  }
  const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  for (const origin of origins) {
    try {
      allowedHosts.add(new URL(origin).hostname);
    } catch {
      /* Invalid configuration grants no access. */
    }
  }

  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    if (request.path.startsWith("/api/"))
      response.setHeader("Cache-Control", "no-store");
    const origin = request.get("origin");
    const host = request.get("host");
    try {
      if (!host || !allowedHosts.has(new URL(`http://${host}`).hostname))
        return next(new HttpError(403, "This host is not allowed."));
    } catch {
      return next(new HttpError(403, "This host is not allowed."));
    }
    let allowed = !origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        const hostUrl = new URL(`http://${host}`);
        const loopback = ["localhost", "127.0.0.1", "[::1]"];
        const localUi =
          loopback.includes(parsed.hostname) &&
          loopback.includes(hostUrl.hostname) &&
          ["5173", hostUrl.port].includes(parsed.port) &&
          parsed.protocol === "http:";
        allowed = origins.has(origin) || localUi;
      } catch {
        allowed = false;
      }
    }
    if (origin && allowed) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PATCH,DELETE,OPTIONS",
      );
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (!allowed && !["GET", "HEAD"].includes(request.method))
      return next(
        new HttpError(403, "Requests from this origin are not allowed."),
      );
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "200kb" }));

  app.get("/api/health", (_request, response) => response.json(capabilities));
  if (stateless) {
    app.use("/api/analyses", (_request, _response, next) =>
      next(
        new HttpError(
          405,
          "This deployment stores your library in this browser. Server library endpoints are disabled.",
        ),
      ),
    );
  }
  const localStore = () => {
    if (!store)
      throw new HttpError(
        405,
        "This deployment stores your library in this browser. Server library endpoints are disabled.",
      );
    return store;
  };
  app.get("/api/analyses", async (_request, response) =>
    response.json(await localStore().list()),
  );
  app.get("/api/analyses/:id", async (request, response) => {
    const record = (await localStore().list()).find(
      (item) => item.id === request.params.id,
    );
    if (!record) throw new HttpError(404, "Analysis not found.");
    response.json(record);
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxUploadBytes,
      files: 1,
      fields: 1,
      fieldSize: 200_000,
      parts: 2,
    },
  });
  let activeAnalyses = 0;
  app.post(
    "/api/analyze",
    (request, response, next) => {
      if (activeAnalyses >= 3)
        return next(
          new HttpError(
            429,
            "Three analyses are already processing. Please wait a moment and try again.",
          ),
        );
      activeAnalyses++;
      let released = false;
      const release = () => {
        if (!released) {
          activeAnalyses--;
          released = true;
        }
      };
      response.locals.releaseAnalysis = release;
      response.once("finish", release);
      response.once("close", () => {
        if (!response.locals.processingAnalysis) release();
      });
      next();
    },
    upload.single("file"),
    async (request, response) => {
      response.locals.processingAnalysis = true;
      let raw: unknown;
      try {
        raw = JSON.parse(request.body?.input ?? "");
      } catch {
        throw new HttpError(
          400,
          "Send valid JSON in the multipart input field.",
        );
      }
      const input: AnalysisInput = inputSchema.parse(raw);
      if (input.type !== "text" && !request.file)
        throw new HttpError(
          400,
          "Upload a file for image, audio, or video analysis.",
        );
      if (input.type === "text" && request.file)
        throw new HttpError(
          400,
          "Select the matching media content type before uploading a file.",
        );
      if (!input.title)
        input.title =
          input.text.trim().slice(0, 70) ||
          request.file?.originalname.slice(0, 70) ||
          "Untitled content";
      let processed: ProcessedMedia | undefined;
      const limitations: string[] = [];
      try {
        if (request.file) {
          processed = await processMedia(
            request.file,
            input.type,
            ffmpeg,
            Boolean(apiKey),
          );
          input.media = processed.metadata;
          limitations.push(...processed.limitations);
          if (apiKey && processed.audio) {
            try {
              const transcript = await transcribeAudio(processed.audio, ai);
              if (transcript) input.media.transcript = transcript;
              else
                limitations.push(
                  "The transcription service returned no speech. Feedback uses the caption and measured media properties.",
                );
            } catch {
              limitations.push(
                "Speech transcription is temporarily unavailable. Feedback uses your caption and the measured media properties.",
              );
            }
          }
        }
        let result = analyzeContent(input);
        result.limitations.push(...limitations);
        if (apiKey) {
          try {
            result = await enhanceAnalysis(
              input,
              result,
              processed?.images ?? [],
              ai,
            );
          } catch {
            result.limitations.push(
              "The AI service was unavailable or returned unusable feedback. This result uses the local assessment; try again later for semantic feedback.",
            );
          }
        }
        const now = new Date().toISOString();
        const record: AnalysisRecord = {
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          input,
          result,
          status: "analyzed",
        };
        if (store)
          await store.mutate((records) => {
            records.push(record);
          });
        response.status(201).json(record);
      } finally {
        try {
          await processed?.cleanup();
        } finally {
          response.locals.releaseAnalysis?.();
        }
      }
    },
  );

  app.patch("/api/analyses/:id", async (request, response) => {
    const patch = patchSchema.parse(request.body);
    const result = await localStore().mutate((records) => {
      const record = records.find((item) => item.id === request.params.id);
      if (!record) throw new HttpError(404, "Analysis not found.");
      if (
        patch.scheduledAt &&
        new Date(patch.scheduledAt).getTime() <= Date.now()
      ) {
        throw new HttpError(400, "Choose a release time in the future.");
      }
      if (patch.scheduledAt === null) {
        delete record.scheduledAt;
        if (record.status === "scheduled") record.status = "analyzed";
      } else if (patch.scheduledAt) {
        record.scheduledAt = new Date(patch.scheduledAt).toISOString();
        record.status = "scheduled";
      }
      if (patch.status) record.status = patch.status;
      if (
        record.status === "scheduled" &&
        (!record.scheduledAt ||
          new Date(record.scheduledAt).getTime() <= Date.now())
      ) {
        throw new HttpError(
          400,
          "A scheduled item must have a release time in the future.",
        );
      }
      if (patch.status === "analyzed") delete record.scheduledAt;
      if (patch.outcomes) record.outcomes = patch.outcomes;
      record.updatedAt = new Date().toISOString();
      return record;
    });
    response.json(result);
  });
  app.delete("/api/analyses/:id", async (request, response) => {
    await localStore().mutate((records) => {
      const index = records.findIndex((item) => item.id === request.params.id);
      if (index < 0) throw new HttpError(404, "Analysis not found.");
      records.splice(index, 1);
    });
    response.status(204).end();
  });
  app.use("/api", (_request, _response, next) =>
    next(new HttpError(404, "API endpoint not found.")),
  );
  const dist = options.distDir ?? resolve("dist");
  if (!stateless && existsSync(join(dist, "index.html"))) {
    app.use(express.static(dist, { index: false }));
    app.get("/{*path}", (_request, response) =>
      response.sendFile(join(dist, "index.html")),
    );
  }
  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    response.locals.releaseAnalysis?.();
    if (response.headersSent) return _next(error);
    if (error instanceof z.ZodError)
      return response
        .status(400)
        .json({ error: error.issues.map((issue) => issue.message).join(" ") });
    if (error instanceof HttpError)
      return response.status(error.status).json({ error: error.message });
    if (error instanceof StorageError)
      return response.status(503).json({ error: error.message });
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? `The file exceeds the ${maxUploadMb} MB upload limit.`
          : "Upload one file and one input field within the allowed limits.";
      return response
        .status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({ error: message });
    }
    if (error?.type === "entity.too.large")
      return response
        .status(413)
        .json({ error: "The request body is too large." });
    if (error instanceof SyntaxError && "body" in error)
      return response
        .status(400)
        .json({ error: "The request contains invalid JSON." });
    response
      .status(500)
      .json({
        error: "The analysis could not be completed. Please try again.",
      });
  };
  app.use(errors);
  return app;
}
