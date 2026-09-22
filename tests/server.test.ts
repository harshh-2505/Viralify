import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { request as httpRequest, type Server } from "node:http";
import sharp from "sharp";
import type { AnalysisInput, AnalysisRecord } from "../shared/types";
import { createApp } from "../server/app";
import { resolveFfmpeg } from "../server/media";

const exec = promisify(execFile);
const example: AnalysisInput = {
  title: "A better morning",
  text: "Three small habits that helped me reclaim my mornings: leave your phone outside the bedroom, prepare one easy breakfast, and walk outside for five minutes. Which one would you try first?",
  type: "text",
  platform: "instagram",
  goal: "engagement",
  audience: "Busy creators",
  timezone: "Asia/Kolkata",
};

async function fixture(options: Parameters<typeof createApp>[0] = {}) {
  const directory = await mkdtemp(join(tmpdir(), "viralify-test-"));
  const app = createApp({
    stateless: false,
    openaiApiKey: "",
    dataDir: directory,
    distDir: join(directory, "no-dist"),
    ...options,
  });
  const server: Server = await new Promise((resolveServer) => {
    const instance = app.listen(0, "127.0.0.1", () => resolveServer(instance));
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    directory,
    url,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
      if (
        dirname(resolve(directory)) === resolve(tmpdir()) &&
        basename(directory).startsWith("viralify-test-")
      ) {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

function form(
  input: unknown = example,
  file?: { bytes: Uint8Array; name: string; mime: string },
) {
  const data = new FormData();
  data.set("input", JSON.stringify(input));
  if (file)
    data.set(
      "file",
      new Blob([new Uint8Array(file.bytes)], { type: file.mime }),
      file.name,
    );
  return data;
}
async function post(
  url: string,
  input: unknown = example,
  file?: Parameters<typeof form>[1],
) {
  return fetch(`${url}/api/analyze`, {
    method: "POST",
    body: form(input, file),
  });
}
async function patch(url: string, id: string, body: unknown) {
  return fetch(`${url}/api/analyses/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("HTTP library lifecycle persists analysis, scheduling and actual outcomes, then deletes", async () => {
  const instance = await fixture();
  try {
    const health = await (await fetch(`${instance.url}/api/health`)).json();
    assert.equal(health.aiEnabled, false);
    assert.equal(health.model, null);
    assert.equal(health.maxUploadMb, 50);
    assert.equal(health.maxUploadBytes, 50 * 1024 * 1024);
    assert.equal(health.storageMode, "server");
    assert.deepEqual(
      await (await fetch(`${instance.url}/api/analyses`)).json(),
      [],
    );
    const created = await post(instance.url);
    assert.equal(created.status, 201, await created.clone().text());
    const record: AnalysisRecord = await created.json();
    assert.equal(record.result.mode, "local");
    assert(record.result.score >= 0 && record.result.score <= 100);
    assert.equal(record.input.text, example.text);
    assert.equal(record.result.publishing.heatmap.length, 7);
    const schedule = new Date(Date.now() + 86_400_000).toISOString();
    const scheduled = await patch(instance.url, record.id, {
      scheduledAt: schedule,
    });
    assert.equal(scheduled.status, 200);
    assert.equal((await scheduled.json()).status, "scheduled");
    const badDate = await patch(instance.url, record.id, {
      scheduledAt: "2020-01-01T00:00:00Z",
    });
    assert.equal(badDate.status, 400);
    const outcomes = {
      views: 1200,
      likes: 35,
      comments: 7,
      shares: 5,
      saves: 19,
    };
    const published = await patch(instance.url, record.id, {
      status: "published",
      outcomes,
    });
    assert.equal(published.status, 200);
    assert.deepEqual((await published.json()).outcomes, outcomes);
    const saved = JSON.parse(
      await readFile(join(instance.directory, "analyses.json"), "utf8"),
    );
    assert.equal(saved.length, 1);
    assert.equal(saved[0].status, "published");
    assert.deepEqual(saved[0].outcomes, outcomes);
    const reread = await (
      await fetch(`${instance.url}/api/analyses/${record.id}`)
    ).json();
    assert.equal(reread.id, record.id);
    assert.equal(
      (
        await fetch(`${instance.url}/api/analyses/${record.id}`, {
          method: "DELETE",
        })
      ).status,
      204,
    );
    assert.equal(
      (await fetch(`${instance.url}/api/analyses/${record.id}`)).status,
      404,
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(join(instance.directory, "analyses.json"), "utf8"),
      ),
      [],
    );
  } finally {
    await instance.close();
  }
});

test("concurrent successful writes are serialized without lost records", async () => {
  const instance = await fixture();
  try {
    const responses = await Promise.all(
      [1, 2, 3].map((index) =>
        post(instance.url, { ...example, title: `Concurrent ${index}` }),
      ),
    );
    for (const response of responses)
      assert.equal(response.status, 201, await response.clone().text());
    const records: AnalysisRecord[] = await (
      await fetch(`${instance.url}/api/analyses`)
    ).json();
    assert.equal(records.length, 3);
    assert.equal(new Set(records.map((record) => record.id)).size, 3);
    const restarted = createApp({
      openaiApiKey: "",
      dataDir: instance.directory,
    });
    const second: Server = await new Promise((resolveServer) => {
      const active = restarted.listen(0, "127.0.0.1", () =>
        resolveServer(active),
      );
    });
    try {
      const address = second.address();
      assert(address && typeof address !== "string");
      assert.equal(
        (
          await (
            await fetch(`http://127.0.0.1:${address.port}/api/analyses`)
          ).json()
        ).length,
        3,
      );
    } finally {
      second.closeAllConnections();
      await new Promise<void>((resolveClose) =>
        second.close(() => resolveClose()),
      );
    }
  } finally {
    await instance.close();
  }
});

test("invalid and corrupt storage is preserved and never reset by writes", async () => {
  const instance = await fixture();
  try {
    const path = join(instance.directory, "analyses.json");
    const corrupt = "{broken but important user data";
    await writeFile(path, corrupt);
    assert.equal((await fetch(`${instance.url}/api/analyses`)).status, 503);
    assert.equal((await post(instance.url)).status, 503);
    assert.equal(await readFile(path, "utf8"), corrupt);
    await writeFile(path, JSON.stringify([{ id: "not-a-record" }]));
    assert.equal((await post(instance.url)).status, 503);
    assert.equal(await readFile(path, "utf8"), '[{"id":"not-a-record"}]');
  } finally {
    await instance.close();
  }
});

test("input validation rejects impossible schedules, unknown properties and forged metadata", async () => {
  const instance = await fixture();
  try {
    for (const input of [
      { ...example, timezone: "Mars/Space" },
      { ...example, text: "short" },
      { ...example, text: "x".repeat(30_001) },
      { ...example, type: "executable" },
      { ...example, unexpected: true },
      { ...example, type: "image", media: { width: 1000, height: 1000 } },
    ])
      assert.equal((await post(instance.url, input)).status, 400);
    const result = await post(instance.url, {
      ...example,
      media: { transcript: "spoofed", width: 999 },
    });
    assert.equal(result.status, 201);
    const record: AnalysisRecord = await result.json();
    assert.equal(record.input.media, undefined);
    for (const change of [
      {},
      { status: "scheduled" },
      { status: "unknown" },
      { score: 100 },
      { scheduledAt: "garbage" },
      { outcomes: { views: -1, likes: 0, comments: 0, shares: 0, saves: 0 } },
    ]) {
      assert.equal((await patch(instance.url, record.id, change)).status, 400);
    }
    assert.equal((await fetch(`${instance.url}/api/missing`)).status, 404);
  } finally {
    await instance.close();
  }
});

test("cross-origin mutations and DNS-rebinding hostnames are rejected", async () => {
  const instance = await fixture();
  try {
    const response = await fetch(`${instance.url}/api/analyze`, {
      method: "POST",
      headers: { Origin: "https://untrusted.example" },
      body: form(),
    });
    assert.equal(response.status, 403);
    const nullOrigin = await fetch(`${instance.url}/api/analyze`, {
      method: "POST",
      headers: { Origin: "null" },
      body: form(),
    });
    assert.equal(nullOrigin.status, 403);
    const allowed = await fetch(`${instance.url}/api/analyze`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173" },
      body: form(),
    });
    assert.equal(allowed.status, 201);
    // Node fetch rewrites Host, so use the HTTP transport to test an actual forged hostname.
    const hostStatus = await new Promise<number | undefined>(
      (resolveStatus, reject) => {
        const request = httpRequest(
          `${instance.url}/api/analyses`,
          { headers: { Host: "attacker.example" } },
          (response) => {
            response.resume();
            resolveStatus(response.statusCode);
          },
        );
        request.once("error", reject);
        request.end();
      },
    );
    assert.equal(hostStatus, 403);
  } finally {
    await instance.close();
  }
});

test("image uploads use measured dimensions and reject mislabeled or oversized data", async () => {
  const instance = await fixture();
  try {
    const bytes = await sharp({
      create: {
        width: 120,
        height: 240,
        channels: 3,
        background: { r: 180, g: 140, b: 80 },
      },
    })
      .png()
      .toBuffer();
    const response = await post(
      instance.url,
      { ...example, type: "image", text: "", media: { width: 5, height: 5 } },
      { bytes, mime: "image/png", name: "../my-image.png" },
    );
    assert.equal(response.status, 201, await response.clone().text());
    const record: AnalysisRecord = await response.json();
    assert.equal(record.input.media?.width, 120);
    assert.equal(record.input.media?.height, 240);
    assert.equal(record.input.media?.name, "my-image.png");
    assert.equal(record.input.media?.size, bytes.length);
    assert.equal(typeof record.input.media?.brightness, "number");
    const invalid = await post(
      instance.url,
      { ...example, type: "image" },
      {
        bytes: new TextEncoder().encode("not really an image"),
        mime: "image/png",
        name: "fake.png",
      },
    );
    assert.equal(invalid.status, 422);
    const oversized = await post(
      instance.url,
      { ...example, type: "image" },
      {
        bytes: new Uint8Array(50 * 1024 * 1024 + 1),
        mime: "image/png",
        name: "oversized.png",
      },
    );
    assert.equal(oversized.status, 413);
  } finally {
    await instance.close();
  }
});

test(
  "audio and video uploads are decoded and measured by real FFmpeg",
  { skip: !resolveFfmpeg() },
  async () => {
    const instance = await fixture();
    try {
      const audio = join(instance.directory, "sample.wav");
      const video = join(instance.directory, "sample.mp4");
      await exec(
        resolveFfmpeg()!,
        [
          "-hide_banner",
          "-nostdin",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=2",
          audio,
        ],
        { windowsHide: true },
      );
      await exec(
        resolveFfmpeg()!,
        [
          "-hide_banner",
          "-nostdin",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=320x240:d=2",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          video,
        ],
        { windowsHide: true },
      );
      const audioResponse = await post(
        instance.url,
        { ...example, type: "audio", text: "" },
        { bytes: await readFile(audio), name: "sample.wav", mime: "audio/wav" },
      );
      assert.equal(
        audioResponse.status,
        201,
        await audioResponse.clone().text(),
      );
      const audioRecord: AnalysisRecord = await audioResponse.json();
      assert.equal(audioRecord.input.media?.duration, 2);
      assert.equal(typeof audioRecord.input.media?.audioPeak, "number");
      assert.equal(typeof audioRecord.input.media?.silenceRatio, "number");
      const videoResponse = await post(
        instance.url,
        { ...example, type: "video", text: "" },
        { bytes: await readFile(video), name: "sample.mp4", mime: "video/mp4" },
      );
      assert.equal(
        videoResponse.status,
        201,
        await videoResponse.clone().text(),
      );
      const videoRecord: AnalysisRecord = await videoResponse.json();
      assert.equal(videoRecord.input.media?.width, 320);
      assert.equal(videoRecord.input.media?.height, 240);
      assert.equal(videoRecord.input.media?.frameCount, 3);
      assert.equal(videoRecord.input.media?.duration, 2);
      const wrongType = await post(
        instance.url,
        { ...example, type: "audio" },
        { bytes: await readFile(video), name: "fake.wav", mime: "audio/wav" },
      );
      assert.equal(wrongType.status, 422);
    } finally {
      await instance.close();
    }
  },
);

test("AI provider failures fall back to usable local feedback without exposing secrets", async () => {
  const key = "test-secret-never-in-response";
  const instance = await fixture({
    openaiApiKey: key,
    fetcher: async () => {
      throw new Error(`Network error ${key}`);
    },
  });
  try {
    const response = await post(instance.url);
    assert.equal(response.status, 201);
    const body = await response.text();
    assert(!body.includes(key));
    const record = JSON.parse(body) as AnalysisRecord;
    assert.equal(record.result.mode, "local");
    assert(
      record.result.limitations.some((item) => item.includes("AI service")),
    );
  } finally {
    await instance.close();
  }
});

test("validated AI editorial feedback enhances content while preserving the local scoring rubric", async () => {
  let sent: Record<string, any> | undefined;
  const feedback = {
    summary:
      "Lead with the practical morning benefit and make each change easy to scan.",
    optimizedText:
      "Make mornings calmer with three small changes: keep your phone outside the bedroom, prepare breakfast, and walk outside for five minutes. Which would you try first?",
    hooks: ["Three small changes for a calmer morning."],
    hashtags: ["#MorningHabits"],
    strengths: ["Three concrete actions make this useful."],
    suggestions: [
      {
        priority: "high",
        title: "State the benefit first",
        detail:
          "Open with a calmer morning so the reader knows why to continue.",
        example: "Three small changes for a calmer morning.",
        dimension: "hook",
      },
    ],
  };
  const aiInstance = await fixture({
    openaiApiKey: "test-only",
    fetcher: async (_url, init) => {
      sent = JSON.parse(init?.body as string);
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(feedback) }],
          },
        ],
      });
    },
  });
  const localInstance = await fixture();
  try {
    const response = await post(aiInstance.url);
    assert.equal(response.status, 201);
    const enhanced: AnalysisRecord = await response.json();
    const local: AnalysisRecord = await (await post(localInstance.url)).json();
    assert.equal(enhanced.result.mode, "ai");
    assert.equal(enhanced.result.optimizedText, feedback.optimizedText);
    assert.equal(enhanced.result.score, local.result.score);
    assert.deepEqual(enhanced.result.dimensions, local.result.dimensions);
    assert.equal(sent?.store, false);
    assert.equal(sent?.text.format.type, "json_schema");
    assert.equal(sent?.text.format.strict, true);
    assert.equal(sent?.model, "gpt-4.1-mini");
  } finally {
    await aiInstance.close();
    await localInstance.close();
  }
});

test("AI refusals and malformed structured responses fall back without corrupting the library", async () => {
  for (const providerOutput of [
    {
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "refusal", refusal: "Unable to assist." }],
        },
      ],
    },
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: '{"score":100}' }],
        },
      ],
    },
  ]) {
    const instance = await fixture({
      openaiApiKey: "test-only",
      fetcher: async () => Response.json(providerOutput),
    });
    try {
      const response = await post(instance.url);
      assert.equal(response.status, 201);
      const record: AnalysisRecord = await response.json();
      assert.equal(record.result.mode, "local");
      assert.equal(
        (await (await fetch(`${instance.url}/api/analyses`)).json()).length,
        1,
      );
    } finally {
      await instance.close();
    }
  }
});

test("stateless deployments return analysis without reading or persisting any shared library", async () => {
  const instance = await fixture({ stateless: true });
  try {
    const health = await (await fetch(`${instance.url}/api/health`)).json();
    assert.equal(health.storageMode, "browser");
    assert.equal(health.maxUploadMb, 4);
    assert.equal(health.maxUploadBytes, 4_000_000);
    const response = await post(instance.url);
    assert.equal(response.status, 201);
    const record: AnalysisRecord = await response.json();
    assert.equal(record.input.title, example.title);
    assert.deepEqual(await readdir(instance.directory), []);
    // Even a pre-existing invalid library must remain inaccessible and untouched.
    const sharedFile = join(instance.directory, "analyses.json");
    await writeFile(sharedFile, "preserve this private existing file");
    assert.equal((await post(instance.url)).status, 201);
    assert.equal(
      await readFile(sharedFile, "utf8"),
      "preserve this private existing file",
    );
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      for (const path of ["/api/analyses", `/api/analyses/${record.id}`]) {
        const unavailable = await fetch(`${instance.url}${path}`, { method });
        assert.equal(unavailable.status, 405);
        assert.match((await unavailable.json()).error, /browser/);
      }
    }
  } finally {
    await instance.close();
  }
});

test("stateless uploads enforce the advertised decimal 4 MB cap before decoding", async () => {
  const instance = await fixture({ stateless: true });
  try {
    const bytes = await sharp({
      create: { width: 100, height: 80, channels: 3, background: "#a7beee" },
    })
      .png()
      .toBuffer();
    const uploaded = await post(
      instance.url,
      { ...example, type: "image", text: "" },
      { bytes, mime: "image/png", name: "small.png" },
    );
    assert.equal(uploaded.status, 201);
    assert.equal((await uploaded.json()).input.media.width, 100);
    const tooLarge = await post(
      instance.url,
      { ...example, type: "image" },
      {
        bytes: new Uint8Array(4_000_001),
        mime: "image/png",
        name: "oversized.png",
      },
    );
    assert.equal(tooLarge.status, 413);
    assert.match((await tooLarge.json()).error, /4 MB/);
    assert.deepEqual(await readdir(instance.directory), []);
  } finally {
    await instance.close();
  }
});

test("Vercel accepts exact deployment origins and original API paths without trusting forged proxy headers", async () => {
  const keys = [
    "VERCEL",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
    "VERCEL_BRANCH_URL",
  ] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.VERCEL = "1";
  process.env.VERCEL_URL = "viralify-test-deployment.vercel.app";
  process.env.VERCEL_PROJECT_PRODUCTION_URL =
    "viralify-test-production.vercel.app";
  process.env.VERCEL_BRANCH_URL = "viralify-test-git-main.vercel.app";
  const instance = await fixture({ stateless: true });
  const encoded = new Request("http://localhost", {
    method: "POST",
    body: form(),
  });
  const body = Buffer.from(await encoded.arrayBuffer());
  async function raw(
    path: string,
    host: string,
    origin?: string,
    forwardedHost?: string,
  ) {
    const headers: Record<string, string> = {
      Host: host,
      "Content-Type": encoded.headers.get("content-type")!,
      "Content-Length": String(body.length),
    };
    if (origin) headers.Origin = origin;
    if (forwardedHost) headers["X-Forwarded-Host"] = forwardedHost;
    return new Promise<{ status: number | undefined; body: string }>(
      (resolveResponse, reject) => {
        const request = httpRequest(
          `${instance.url}${path}`,
          { method: "POST", headers },
          (response) => {
            let content = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              content += chunk;
            });
            response.on("end", () =>
              resolveResponse({ status: response.statusCode, body: content }),
            );
          },
        );
        request.once("error", reject);
        request.end(body);
      },
    );
  }
  try {
    for (const host of [
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_BRANCH_URL,
    ]) {
      const response = await raw(
        "/api/analyze?unused=true",
        host,
        `https://${host}`,
      );
      assert.equal(response.status, 201, response.body);
      assert.equal(JSON.parse(response.body).input.text, example.text);
    }
    const hostileOrigin = await raw(
      "/api/analyze",
      process.env.VERCEL_URL,
      "https://another-project.vercel.app",
    );
    assert.equal(hostileOrigin.status, 403);
    const forgedHost = await raw(
      "/api/analyze",
      "attacker.example",
      `https://${process.env.VERCEL_URL}`,
      process.env.VERCEL_URL,
    );
    assert.equal(forgedHost.status, 403);
    const wrongPath = await raw(
      "/api/missing",
      process.env.VERCEL_URL,
      `https://${process.env.VERCEL_URL}`,
    );
    assert.equal(wrongPath.status, 404);
  } finally {
    await instance.close();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
