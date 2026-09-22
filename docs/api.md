# Viralify API

The local API runs on `http://127.0.0.1:3001` by default. In development Vite forwards `/api` requests to it. The local production server also serves `dist/` after `npm run build`. On Vercel, static files are served from `dist/` and `/api/*` is routed to `api/index.ts`.

There are two storage modes. The local server is a single-user, single-process application with a disk library; keep this mode bound to loopback. The Vercel deployment is stateless: analysis results are returned to the caller and retained by the frontend in that browser's IndexedDB. The hosted server never opens a shared user library. There is no account login, cloud sync, social-account connection, automatic publishing, or remote database.

Application errors have the shape `{ "error": "Readable explanation" }`. Unknown API endpoints return 404. JSON responses use `Cache-Control: no-store`. Mutating browser requests must come from the current loopback API origin, the local Vite origin on port 5173, an exact Vercel deployment/branch/production origin supplied by the platform, or an exact origin explicitly configured in `ALLOWED_ORIGINS` (comma separated). Unknown hostnames are rejected to prevent DNS rebinding; client-supplied forwarded-host headers grant no access. Other `vercel.app` projects are not automatically trusted. Non-browser clients may omit `Origin`.

## Capabilities

`GET /api/health`

```json
{
  "aiEnabled": false,
  "mediaEnabled": true,
  "maxUploadMb": 50,
  "maxUploadBytes": 52428800,
  "model": null,
  "storageMode": "server"
}
```

`aiEnabled` means an API key is configured, not that it has been verified against the provider. Each result reports its actual `mode`. `mediaEnabled` means FFmpeg is available for audio/video; image analysis with Sharp works independently.

On Vercel, `storageMode` is `browser`, `maxUploadMb` is `4`, and `maxUploadBytes` is `4000000`. Use the exact byte value to validate files; the hosted cap is decimal MB and the local cap is 50 MiB. The frontend chooses its persistence adapter using `storageMode`, not the page hostname.

## Analyze

`POST /api/analyze`

Send `multipart/form-data` with one field named `input` containing a JSON-encoded object. Add one file in `file` for image, audio, or video. Let the HTTP client set the multipart boundary.

```json
{
  "title": "Morning habits",
  "text": "Three small changes that made my mornings calmer…",
  "type": "text",
  "platform": "instagram",
  "goal": "engagement",
  "audience": "Busy creators",
  "timezone": "Asia/Kolkata"
}
```

| Field      | Values / limits                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `title`    | Optional; up to 160 characters; derived from the content or filename if empty.                                  |
| `text`     | Up to 30,000 characters; text content requires at least 20 non-padding characters. Media captions may be empty. |
| `type`     | `text`, `image`, `audio`, `video`                                                                               |
| `platform` | `instagram`, `tiktok`, `youtube`, `linkedin`, `x`                                                               |
| `goal`     | `reach`, `engagement`, `community`, `conversions`                                                               |
| `audience` | Optional description, up to 500 characters.                                                                     |
| `timezone` | Valid IANA timezone, including `UTC`.                                                                           |
| `media`    | Client metadata is ignored. The server measures the actual uploaded file.                                       |

The request returns **201** with an `AnalysisRecord` (see `shared/types.ts`): ID, timestamps, input and measured metadata, `status: "analyzed"`, and the full result. Result fields include readiness score, dimensions, summary, prioritized suggestions, rewritten copy, hooks, relevant hashtags, publishing hypotheses, tracking metrics, and limitations. In browser mode this response is the only copy returned by the API; the caller must save it locally to keep it.

Limits:

- One upload, at most 50 MiB locally or **4,000,000 bytes on Vercel**; one input field, at most 200 KB. The hosted limit leaves room for multipart metadata below the platform's request-size ceiling.
- Images: JPEG, PNG, WebP, GIF, AVIF and TIFF supported by the installed Sharp decoder; under 40 million pixels. Animated images use their first frame for review.
- Audio/video: at most 20 minutes and 8192 pixels per video dimension, under 40 million pixels. Allowed FFmpeg demuxers cover MP4/MOV, Matroska/WebM, AVI, MP3, WAV, OGG, FLAC, AAC, AIFF and AMR. Actual decoding must succeed; changing an extension or MIME type does not make a file valid.
- Up to three simultaneous analyses; additional requests return **429**.
- Invalid input returns **400**, unsupported or undecodable media **422**, oversized uploads **413**, unavailable FFmpeg **503**.

Media is processed in generated `viralify-*` directories under the operating system temp directory (`/tmp` on Vercel), then deleted after success or failure. Files are never served back or retained in the analysis library. A process crash or hard platform timeout can interrupt cleanup. Image operations and FFmpeg subprocesses have time limits; FFmpeg runs without a shell and with restricted demuxers/protocols. Silence and peak levels sample the first two minutes; AI transcription samples the first three minutes; video visual review samples the opening, 40%, and 80% points.

Without an API key, analysis uses local wording and technical-file heuristics. With `OPENAI_API_KEY`, the server can send captions, audience/context, a transcript, and reduced image/video samples to OpenAI. Audio is submitted as a short WAV for transcription. The key is never returned to clients. Responses requests set `store: false`. Provider errors, refusals, timeouts, invalid schemas, or incomplete output fall back to the local result with an explicit limitation. The readiness score, score dimensions, and publishing windows remain local heuristics even when editorial feedback is AI assisted.

## Library

These library routes are available only in `storageMode: "server"`. In browser mode, every request to `/api/analyses` or its child paths returns **405**; there is no shared server list, lookup, update, or deletion. The frontend performs these operations in IndexedDB. Browser libraries are scoped to the current browser profile and site origin: preview and production URLs do not share a library. Clearing site data removes that browser's saved records.

`GET /api/analyses` returns all saved records, newest first. A new installation returns an empty array.

`GET /api/analyses/:id` returns a saved record or **404**.

Records persist in `data/analyses.json` by default. The API serializes mutations, validates existing records, writes and flushes a temporary file, then replaces the library atomically. A malformed or unreadable library produces **503** and is preserved rather than silently reset. Back up this file to preserve the library. Run only one server process against a data directory.

## Schedule and results

`PATCH /api/analyses/:id`, with `Content-Type: application/json`:

```json
{ "scheduledAt": "2027-06-01T12:30:00+05:30" }
```

`scheduledAt` must include a timezone offset or `Z`, and must be strictly in the future. It is stored in UTC and sets status to `scheduled`. Setting it to `null` removes the scheduled time; `status: "analyzed"` also clears the schedule. These are planning records only; no content is automatically published.

```json
{
  "status": "published",
  "outcomes": {
    "views": 1200,
    "likes": 35,
    "comments": 7,
    "shares": 5,
    "saves": 19
  }
}
```

`status` accepts `analyzed`, `scheduled`, or `published`. A scheduled record requires a valid future `scheduledAt`. Outcome counters must all be provided as nonnegative safe integers. Outcomes are manually entered observations; the application does not fetch social metrics or silently train a predictive model from them. Unknown properties are rejected. A successful update returns **200** with the updated record.

`DELETE /api/analyses/:id` permanently removes the analysis, plan and associated entered outcomes. Returns **204** or **404** if absent.

## Provider references

The optional integration follows official OpenAI documentation for [structured Responses output](https://developers.openai.com/api/docs/guides/structured-outputs), [image inputs](https://developers.openai.com/api/docs/guides/images-vision), and [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text). Model names are configurable through `OPENAI_MODEL` and `OPENAI_TRANSCRIPTION_MODEL`.

## Vercel deployment

`api/index.ts` exports an Express app constructed with `{ stateless: true }`. `vercel.json` builds Vite, serves `dist/`, rewrites `/api/(.*)` to that function, allows up to 300 seconds per invocation, and explicitly includes the Linux FFmpeg executable and Sharp native dependencies. No library file is created in the deployment filesystem. Local `npm run dev` and `npm start` retain the disk-backed behavior.

`VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, and `VERCEL_BRANCH_URL` are accepted only when `VERCEL=1`. These exact platform-provided domains are used for the Host and Origin allowlists. Additional custom domains must be listed explicitly in `ALLOWED_ORIGINS` when they are not represented by those variables. The function does not trust client headers to add allowed hosts.

The public deployment can run without an OpenAI key and has no AI-provider charges in that configuration. The public analysis endpoint does not authenticate callers. Before enabling a paid API key on a public deployment, add authentication, per-user quotas and abuse controls. Its three-analysis concurrency guard is per running function instance and is not a distributed account quota.

Vercel documents [function configuration and included files](https://vercel.com/docs/project-configuration/vercel-json#functions), [function limits](https://vercel.com/docs/functions/limitations), and [deployment environment variables](https://vercel.com/docs/environment-variables/system-environment-variables). Platform-level timeouts or over-limit requests can return Vercel's error format before the application receives them.
