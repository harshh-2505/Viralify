import test from "node:test";
import assert from "node:assert/strict";
import { localDateTime, zonedDateTimeToIso } from "../src/lib/timezone";

test("India wall time converts to the previous UTC date without changing its local date", () => {
  const instant = zonedDateTimeToIso("2026-09-21T00:15", "Asia/Kolkata");
  assert.equal(instant, "2026-09-20T18:45:00.000Z");
  assert.equal(
    localDateTime(new Date(instant), "Asia/Kolkata"),
    "2026-09-21T00:15",
  );
});

test("UTC conversion preserves the exact selected minute, including midnight and leap day", () => {
  assert.equal(
    zonedDateTimeToIso("2028-02-29T00:00", "UTC"),
    "2028-02-29T00:00:00.000Z",
  );
  assert.equal(
    localDateTime(new Date("2028-02-29T00:00:00.000Z"), "UTC"),
    "2028-02-29T00:00",
  );
  assert.equal(
    zonedDateTimeToIso("2026-12-31T23:59", "UTC"),
    "2026-12-31T23:59:00.000Z",
  );
});

test("western and far-eastern zones cross UTC day and year boundaries correctly", () => {
  const california = zonedDateTimeToIso(
    "2026-12-31T23:30",
    "America/Los_Angeles",
  );
  assert.equal(california, "2027-01-01T07:30:00.000Z");
  assert.equal(
    localDateTime(new Date(california), "America/Los_Angeles"),
    "2026-12-31T23:30",
  );
  const kiritimati = zonedDateTimeToIso(
    "2027-01-01T00:30",
    "Pacific/Kiritimati",
  );
  assert.equal(kiritimati, "2026-12-31T10:30:00.000Z");
  assert.equal(
    localDateTime(new Date(kiritimati), "Pacific/Kiritimati"),
    "2027-01-01T00:30",
  );
});

test("quarter-hour timezone offsets are preserved", () => {
  const instant = zonedDateTimeToIso("2026-09-21T09:00", "Asia/Kathmandu");
  assert.equal(instant, "2026-09-21T03:15:00.000Z");
  assert.equal(
    localDateTime(new Date(instant), "Asia/Kathmandu"),
    "2026-09-21T09:00",
  );
});

test("New York spring DST gap is rejected while the adjacent valid hours have correct offsets", () => {
  assert.throws(
    () => zonedDateTimeToIso("2026-03-08T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.equal(
    zonedDateTimeToIso("2026-03-08T01:30", "America/New_York"),
    "2026-03-08T06:30:00.000Z",
  );
  assert.equal(
    zonedDateTimeToIso("2026-03-08T03:30", "America/New_York"),
    "2026-03-08T07:30:00.000Z",
  );
});

test("New York autumn DST fold is rejected instead of silently choosing an occurrence", () => {
  assert.equal(
    localDateTime(new Date("2026-11-01T05:30:00.000Z"), "America/New_York"),
    "2026-11-01T01:30",
  );
  assert.equal(
    localDateTime(new Date("2026-11-01T06:30:00.000Z"), "America/New_York"),
    "2026-11-01T01:30",
  );
  assert.throws(
    () => zonedDateTimeToIso("2026-11-01T01:30", "America/New_York"),
    /occurs twice/,
  );
  assert.equal(
    zonedDateTimeToIso("2026-11-01T02:30", "America/New_York"),
    "2026-11-01T07:30:00.000Z",
  );
});

test("London DST transitions reject both missing and repeated wall times", () => {
  assert.throws(
    () => zonedDateTimeToIso("2026-03-29T01:30", "Europe/London"),
    /does not exist/,
  );
  assert.throws(
    () => zonedDateTimeToIso("2026-10-25T01:30", "Europe/London"),
    /occurs twice/,
  );
  assert.equal(
    zonedDateTimeToIso("2026-07-01T12:00", "Europe/London"),
    "2026-07-01T11:00:00.000Z",
  );
  assert.equal(
    zonedDateTimeToIso("2026-12-01T12:00", "Europe/London"),
    "2026-12-01T12:00:00.000Z",
  );
});

test("half-hour DST transitions are handled without assuming a one-hour clock change", () => {
  assert.throws(
    () => zonedDateTimeToIso("2026-10-04T02:15", "Australia/Lord_Howe"),
    /does not exist/,
  );
  assert.throws(
    () => zonedDateTimeToIso("2026-04-05T01:45", "Australia/Lord_Howe"),
    /occurs twice/,
  );
  assert.equal(
    zonedDateTimeToIso("2026-10-04T02:45", "Australia/Lord_Howe"),
    "2026-10-03T15:45:00.000Z",
  );
});

test("malformed or impossible calendar dates cannot silently normalize into another day", () => {
  for (const invalid of [
    "",
    "2026-09-21",
    "2026-09-21T12:34Z",
    "2026-09-21T24:00",
    "2026-02-30T12:00",
    "2026-13-01T12:00",
  ]) {
    assert.throws(() => zonedDateTimeToIso(invalid, "UTC"), Error, invalid);
  }
  assert.throws(
    () => zonedDateTimeToIso("2026-09-21T12:00", "Invalid/Timezone"),
    Error,
  );
});
