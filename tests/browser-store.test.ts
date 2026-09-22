import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IDBFactory as FakeIDBFactory } from "fake-indexeddb";
import {
  BrowserAnalysisStore,
  BrowserStorageError,
} from "../src/lib/browser-store";
import { uploadLimitBytes } from "../src/lib/media";
import { analyzeContent } from "../server/analyzer";
import type { AnalysisInput, AnalysisRecord } from "../shared/types";

const now = Date.parse("2026-09-22T10:00:00.000Z");
const future = "2026-09-23T10:00:00.000Z";
function record(createdAt = "2026-09-22T09:00:00.000Z"): AnalysisRecord {
  const input: AnalysisInput = {
    title: "A smaller next step",
    type: "text",
    platform: "instagram",
    goal: "engagement",
    text: "Try making the smallest version of your idea today. Write three sentences or sketch one frame. Which small step would you try?",
    audience: "Creative professionals",
    timezone: "Asia/Kolkata",
  };
  return {
    id: randomUUID(),
    createdAt,
    updatedAt: createdAt,
    input,
    result: analyzeContent(input),
    status: "analyzed",
  };
}

function fixture() {
  const factory = new FakeIDBFactory();
  const name = `viralify-test-${randomUUID()}`;
  const make = () =>
    new BrowserAnalysisStore({
      indexedDB: factory,
      databaseName: name,
      now: () => now,
    });
  return { factory, name, make, store: make() };
}

test("browser library survives closing and reopening the connection, including scheduling and outcomes", async (t) => {
  const f = fixture();
  const first = record();
  await f.store.add(first);
  const scheduled = await f.store.update(first.id, {
    scheduledAt: "2026-09-23T15:30:00+05:30",
  });
  assert.equal(scheduled.scheduledAt, future);
  assert.equal(scheduled.status, "scheduled");
  const outcomes = {
    views: 1200,
    likes: 80,
    comments: 12,
    shares: 17,
    saves: 9,
  };
  const published = await f.store.update(first.id, {
    status: "published",
    outcomes,
  });
  assert.equal(published.updatedAt, new Date(now).toISOString());
  await f.store.close();
  const reopened = f.make();
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.list(), [published]);
  assert.equal((await reopened.list())[0].createdAt, first.createdAt);
  await reopened.remove(first.id);
  assert.deepEqual(await reopened.list(), []);
  await assert.rejects(reopened.remove(first.id), /not found/);
});

test("reports sort newest first and duplicate IDs cannot silently overwrite a saved report", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const older = record("2026-09-20T09:00:00.000Z");
  const newer = record();
  await f.store.add(older);
  await f.store.add(newer);
  await assert.rejects(
    f.store.add({ ...older, input: { ...older.input, title: "Overwritten" } }),
    BrowserStorageError,
  );
  assert.deepEqual(
    (await f.store.list()).map((r) => r.id),
    [newer.id, older.id],
  );
  assert.equal((await f.store.list())[1].input.title, older.input.title);
});

test("separate browser storage factories keep identical database names isolated", async (t) => {
  const name = "viralify-library";
  const first = new BrowserAnalysisStore({
    indexedDB: new FakeIDBFactory(),
    databaseName: name,
  });
  const second = new BrowserAnalysisStore({
    indexedDB: new FakeIDBFactory(),
    databaseName: name,
  });
  t.after(() => Promise.all([first.close(), second.close()]));
  await first.add(record());
  assert.equal((await first.list()).length, 1);
  assert.deepEqual(await second.list(), []);
});

test("concurrent browser updates serialize without losing the schedule or outcome edit", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const item = record();
  await f.store.add(item);
  const outcomes = { views: 300, likes: 20, comments: 4, shares: 2, saves: 8 };
  await Promise.all([
    f.store.update(item.id, { scheduledAt: future }),
    f.store.update(item.id, { outcomes }),
  ]);
  const saved = (await f.store.list())[0];
  assert.equal(saved.status, "scheduled");
  assert.equal(saved.scheduledAt, future);
  assert.deepEqual(saved.outcomes, outcomes);
});

test("invalid schedules, outcome counts, and unsupported fields leave the stored record unchanged", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const item = record();
  await f.store.add(item);
  for (const patch of [
    {},
    { scheduledAt: "not-a-date" },
    { scheduledAt: new Date(now).toISOString() },
    { scheduledAt: "2026-09-21T10:00:00.000Z" },
    { status: "scheduled" },
    { status: "invented" },
    { title: "An unsupported edit" },
    { outcomes: { views: -1, likes: 0, comments: 0, shares: 0, saves: 0 } },
    { outcomes: { views: 20, likes: 1.5, comments: 0, shares: 0, saves: 0 } },
    {
      outcomes: {
        views: Number.MAX_SAFE_INTEGER + 1,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
      },
    },
    { outcomes: { views: 1, likes: 0, comments: 0, shares: 0 } },
  ]) {
    await assert.rejects(f.store.update(item.id, patch));
    assert.deepEqual(await f.store.list(), [item]);
  }
  await assert.rejects(
    f.store.update(randomUUID(), { status: "published" }),
    /not found/,
  );
});

test("unscheduling clears the timestamp and returns a scheduled record to analyzed", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const item = record();
  await f.store.add(item);
  await f.store.update(item.id, { scheduledAt: future });
  const unscheduled = await f.store.update(item.id, { scheduledAt: null });
  assert.equal(unscheduled.status, "analyzed");
  assert.equal(unscheduled.scheduledAt, undefined);
  await f.store.update(item.id, { scheduledAt: future });
  const analyzed = await f.store.update(item.id, { status: "analyzed" });
  assert.equal(analyzed.scheduledAt, undefined);
});

test("malformed server responses are rejected before they can enter the browser library", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const item = record();
  await f.store.add(item);
  const malformed = { ...record(), result: { ...item.result, score: 1000 } };
  await assert.rejects(f.store.add(malformed), /analysis response was invalid/);
  assert.deepEqual(await f.store.list(), [item]);
});

test("a corrupt IndexedDB record is reported and preserved instead of being silently reset", async (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  await f.store.add(record());
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = f.factory.open(f.name, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  t.after(() => database.close());
  const corrupted = { id: randomUUID(), result: "broken data" };
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("analyses", "readwrite");
    transaction.objectStore("analyses").put(corrupted);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
  await assert.rejects(f.store.list(), /stored data has not been replaced/);
  const saved = await new Promise<unknown>((resolve, reject) => {
    const request = database
      .transaction("analyses")
      .objectStore("analyses")
      .get(corrupted.id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.deepEqual(saved, corrupted);
});

test("storage-open failures are surfaced without a fake empty-library fallback and can be retried", async () => {
  let calls = 0;
  const factory = {
    open() {
      calls++;
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    },
  } as unknown as IDBFactory;
  const store = new BrowserAnalysisStore({ indexedDB: factory });
  await assert.rejects(store.list(), /storage is full/);
  await assert.rejects(store.add(record()), /storage is full/);
  assert.equal(calls, 2);
});

test("the exact deployed upload byte cap overrides the binary-megabyte fallback", () => {
  assert.equal(uploadLimitBytes(4, 4_000_000), 4_000_000);
  assert.equal(uploadLimitBytes(50), 52_428_800);
  assert.equal(uploadLimitBytes(), 52_428_800);
  assert.equal(uploadLimitBytes(4), 4_194_304);
  assert.equal(uploadLimitBytes(4, -1), 4_194_304);
});
