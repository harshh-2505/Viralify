import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";
import bundledFfmpeg from "ffmpeg-static";
import type { ContentType, MediaMetadata } from "../shared/types";
import { HttpError } from "./errors.js";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_DURATION_SECONDS = 20 * 60;
const SAMPLE_SECONDS = 120;
const TRANSCRIPTION_SECONDS = 180;
const FORMATS = "mov,matroska,webm,avi,mp3,wav,ogg,flac,aac,aiff,amr";

export function resolveFfmpeg(override?: string | null): string | null {
  const executable =
    override === undefined
      ? process.env.FFMPEG_PATH || bundledFfmpeg
      : override;
  return executable && existsSync(executable) ? executable : null;
}

export interface ProcessedMedia {
  metadata: MediaMetadata;
  images: string[];
  audio?: Buffer;
  limitations: string[];
  cleanup: () => Promise<void>;
}

function runFfmpeg(
  executable: string,
  args: string[],
  timeout = 45_000,
): Promise<string> {
  return new Promise((resolveResult, reject) => {
    execFile(
      executable,
      [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-max_alloc",
        "268435456",
        "-threads",
        "1",
        ...args,
      ],
      {
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
      (error, _stdout, stderr) => {
        if (error)
          reject(
            new HttpError(
              422,
              "This media could not be decoded within the processing limits. Try a shorter, standard MP4, MP3, WAV, WebM, or image file.",
            ),
          );
        else resolveResult(stderr);
      },
    );
  });
}

function inputArgs(file: string): string[] {
  // Restrict demuxers/protocols: uploads cannot reference external URLs or local playlists.
  return [
    "-protocol_whitelist",
    "file,pipe",
    "-format_whitelist",
    FORMATS,
    "-i",
    file,
  ];
}

async function inspectImage(
  buffer: Buffer,
): Promise<{ metadata: Partial<MediaMetadata>; image: string }> {
  try {
    const input = sharp(buffer, {
      limitInputPixels: 40_000_000,
      failOn: "error",
    }).timeout({ seconds: 20 });
    const metadata = await input.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp", "gif", "avif", "heif", "tiff"].includes(
        metadata.format,
      )
    ) {
      throw new Error("Unsupported image format");
    }
    const sample = await input
      .clone()
      .rotate()
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .greyscale()
      .toBuffer();
    // Sharp stats() reads its input, so materialize the resized grayscale image first.
    const stats = await sharp(sample).stats();
    const preview = await input
      .clone()
      .rotate()
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    const rotated = (metadata.orientation || 0) >= 5;
    return {
      metadata: {
        mimeType: `image/${metadata.format}`,
        width: rotated ? metadata.height : metadata.width,
        height: rotated ? metadata.width : metadata.height,
        brightness: Math.round(stats.channels[0].mean * 10) / 10,
        contrast: Math.round(stats.channels[0].stdev * 10) / 10,
        frameCount: metadata.pages ?? 1,
      },
      image: `data:image/jpeg;base64,${preview.toString("base64")}`,
    };
  } catch {
    throw new HttpError(
      422,
      "The image could not be decoded. Use a valid JPEG, PNG, WebP, GIF, AVIF, or TIFF under 40 megapixels.",
    );
  }
}

export async function processMedia(
  file: Express.Multer.File,
  type: ContentType,
  ffmpeg: string | null,
  prepareAi: boolean,
): Promise<ProcessedMedia> {
  if (file.size === 0) throw new HttpError(400, "The uploaded file is empty.");
  const name =
    basename(file.originalname.replaceAll("\\", "/"))
      .replace(/[\x00-\x1f\x7f]/g, "")
      .slice(0, 160) || "uploaded-media";
  const base: MediaMetadata = {
    name,
    mimeType: file.mimetype,
    size: file.size,
  };
  if (type === "image") {
    const image = await inspectImage(file.buffer);
    return {
      metadata: { ...base, ...image.metadata },
      images: prepareAi ? [image.image] : [],
      limitations:
        (image.metadata.frameCount ?? 1) > 1
          ? [
              "Image measurements and visual review use the first frame of this animated image.",
            ]
          : [],
      cleanup: async () => {},
    };
  }
  if (type !== "audio" && type !== "video")
    throw new HttpError(400, "Choose a media content type for an upload.");
  if (!ffmpeg)
    throw new HttpError(
      503,
      "Audio and video processing requires FFmpeg. Install dependencies or set FFMPEG_PATH and restart the server.",
    );
  const directory = await mkdtemp(join(tmpdir(), "viralify-"));
  const cleanup = async () => {
    // Only the dedicated OS-generated media directory can be removed.
    if (
      dirname(resolve(directory)) === resolve(tmpdir()) &&
      basename(directory).startsWith("viralify-")
    ) {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
  };
  try {
    const input = join(directory, "upload.bin");
    await writeFile(input, file.buffer, { mode: 0o600 });
    const probe = await runFfmpeg(ffmpeg, [
      ...inputArgs(input),
      "-t",
      "0.1",
      "-f",
      "null",
      "-",
    ]);
    const durationMatch = probe.match(
      /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/,
    );
    const duration = durationMatch
      ? +durationMatch[1] * 3600 + +durationMatch[2] * 60 + +durationMatch[3]
      : undefined;
    if (
      duration === undefined ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > MAX_DURATION_SECONDS
    ) {
      throw new HttpError(
        422,
        "Use a file with a readable duration of up to 20 minutes.",
      );
    }
    const sourceDescription = probe.split("Output #0")[0];
    const videoLine = sourceDescription
      .split("\n")
      .find(
        (line) => /Stream.*Video:/.test(line) && !line.includes("attached pic"),
      );
    const hasAudio = /Stream.*Audio:/.test(sourceDescription);
    if (type === "video" && !videoLine)
      throw new HttpError(
        422,
        "This upload has no video stream. Choose the audio content type for an audio file.",
      );
    if (type === "audio" && (!hasAudio || videoLine))
      throw new HttpError(
        422,
        "Choose a file with an audio stream and no video, or use the video content type.",
      );
    const dimensions = videoLine?.match(/\b([1-9]\d{0,4})x([1-9]\d{0,4})\b/);
    const width = dimensions ? +dimensions[1] : undefined;
    const height = dimensions ? +dimensions[2] : undefined;
    if (
      width &&
      height &&
      (width * height > 40_000_000 || width > 8192 || height > 8192)
    ) {
      throw new HttpError(
        422,
        "Video dimensions must be at most 8K and under 40 megapixels.",
      );
    }
    const metadata: MediaMetadata = { ...base, duration, width, height };
    const images: string[] = [];
    const limitations: string[] = [];
    if (hasAudio) {
      try {
        const sampleDuration = Math.min(SAMPLE_SECONDS, duration);
        const audioLog = await runFfmpeg(ffmpeg, [
          ...inputArgs(input),
          "-t",
          String(sampleDuration),
          "-vn",
          "-af",
          "silencedetect=noise=-35dB:d=0.4,volumedetect",
          "-f",
          "null",
          "-",
        ]);
        const silence = [
          ...audioLog.matchAll(/silence_duration:\s*([\d.]+)/g),
        ].reduce((sum, match) => sum + Number(match[1]), 0);
        metadata.silenceRatio = Math.min(1, silence / sampleDuration);
        const peak = audioLog.match(/max_volume:\s*(-?[\d.]+)\s*dB/);
        if (peak) metadata.audioPeak = Math.min(1, 10 ** (+peak[1] / 20));
        if (duration > SAMPLE_SECONDS)
          limitations.push(
            "Audio silence and peak levels are measured from the first 2 minutes.",
          );
      } catch {
        limitations.push(
          "Audio level measurements were unavailable for this codec; the remaining analysis is still available.",
        );
      }
    } else {
      limitations.push("No audio stream was detected in this video.");
    }
    if (type === "video") {
      const points = [
        Math.min(0.1, duration / 4),
        duration * 0.4,
        duration * 0.8,
      ];
      for (let index = 0; index < points.length; index++) {
        const frame = join(directory, `frame-${index}.jpg`);
        await runFfmpeg(ffmpeg, [
          "-ss",
          String(points[index]),
          ...inputArgs(input),
          "-an",
          "-frames:v",
          "1",
          "-vf",
          "scale=960:-2",
          frame,
        ]);
        const image = await inspectImage(await readFile(frame));
        if (index === 0) {
          metadata.brightness = image.metadata.brightness;
          metadata.contrast = image.metadata.contrast;
        }
        if (prepareAi) images.push(image.image);
      }
      metadata.frameCount = 3;
      limitations.push(
        "Visual measurements use the opening frame. AI visual review, when enabled, samples 3 frames and cannot assess every moment or edit.",
      );
    }
    let audio: Buffer | undefined;
    if (prepareAi && hasAudio) {
      try {
        const extracted = join(directory, "speech.wav");
        await runFfmpeg(ffmpeg, [
          ...inputArgs(input),
          "-t",
          String(TRANSCRIPTION_SECONDS),
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          extracted,
        ]);
        audio = await readFile(extracted);
        if (duration > TRANSCRIPTION_SECONDS)
          limitations.push(
            "Speech transcription uses the first 3 minutes of this content.",
          );
      } catch {
        limitations.push(
          "Speech extraction was unavailable for this codec. Feedback uses the caption and other available measurements.",
        );
      }
    }
    return { metadata, images, audio, limitations, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
