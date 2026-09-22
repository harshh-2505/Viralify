import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisInput, AnalysisRecord } from "../shared/types";
import { analyzeContent } from "../server/analyzer";
import { buildCalendar, buildReport } from "../src/lib/utils";

const input: AnalysisInput = {
  title: "Make your first recording clearer",
  text: "Try one test recording before your main take. Listen on a phone speaker and move closer to the microphone if the words are hard to hear. Which step would you try first?",
  type: "text",
  platform: "instagram",
  goal: "engagement",
  audience: "First-time video creators",
  timezone: "Asia/Kolkata",
};
const record: AnalysisRecord = {
  id: "4febdc71-f38a-46bc-a117-f9f8f1646c15",
  createdAt: "2026-09-21T08:15:30.345Z",
  updatedAt: "2026-09-22T12:16:45.789Z",
  input,
  result: analyzeContent(input),
  status: "scheduled",
  scheduledAt: "2026-09-24T18:30:00+05:30",
};
const unfold = (calendar: string) => calendar.replace(/\r\n[ \t]/g, "");
function values(calendar: string, property: string) {
  return unfold(calendar)
    .split("\r\n")
    .filter((line) => line.startsWith(`${property}:`))
    .map((line) => line.slice(property.length + 1));
}
function decodeText(value: string) {
  return value.replace(/\\([nN\\,;])/g, (_, escaped: string) =>
    escaped.toLowerCase() === "n" ? "\n" : escaped,
  );
}

test("calendar exports only scheduled records with valid dates", () => {
  const calendar = buildCalendar([
    record,
    { ...record, id: "analyzed", status: "analyzed" },
    { ...record, id: "published", status: "published" },
    { ...record, id: "no-time", scheduledAt: undefined },
    { ...record, id: "invalid-time", scheduledAt: "not-a-date" },
  ]);
  assert.equal(
    values(calendar, "BEGIN").filter((value) => value === "VEVENT").length,
    1,
  );
  assert.deepEqual(values(calendar, "UID"), [`${record.id}@viralify.local`]);
  assert.ok(calendar.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(calendar.endsWith("END:VCALENDAR\r\n"));
  assert.ok(!calendar.includes("undefined"));
});

test("calendar timestamps are UTC, deterministic and use a 30-minute publishing block", () => {
  const calendar = buildCalendar([record]);
  assert.deepEqual(values(calendar, "DTSTART"), ["20260924T130000Z"]);
  assert.deepEqual(values(calendar, "DTEND"), ["20260924T133000Z"]);
  assert.deepEqual(values(calendar, "DTSTAMP"), ["20260922T121645Z"]);
  assert.deepEqual(values(calendar, "LAST-MODIFIED"), ["20260922T121645Z"]);
  assert.equal(calendar, buildCalendar([record]));
  assert.ok(!calendar.includes("TZID"));
});

test("event identifiers stay unique and stable across exports and rescheduling", () => {
  const second = { ...record, id: "a4c1cf81-1d7d-4238-a364-9d6f58718b71" };
  const calendar = buildCalendar([record, second, record]);
  assert.equal(new Set(values(calendar, "UID")).size, 2);
  assert.equal(values(calendar, "UID").length, 2);
  assert.deepEqual(
    values(
      buildCalendar([{ ...record, scheduledAt: "2026-09-26T19:00:00Z" }]),
      "UID",
    ),
    values(buildCalendar([record]), "UID"),
  );
});

test("CR, LF, CRLF and punctuation are text data rather than injected calendar properties", () => {
  const title =
    "Line one\r\nEND:VEVENT\rBEGIN:VEVENT\nSUMMARY:injected; commas, and \\slashes";
  const text =
    "Original text\n\nATTENDEE:mailto:intruder@example.test\rDESCRIPTION:fake\r\nlast;line, slash\\";
  const calendar = buildCalendar([
    { ...record, input: { ...input, title, text } },
  ]);
  assert.equal(
    values(calendar, "BEGIN").filter((value) => value === "VEVENT").length,
    1,
  );
  assert.equal(
    values(calendar, "END").filter((value) => value === "VEVENT").length,
    1,
  );
  assert.equal(values(calendar, "SUMMARY").length, 1);
  assert.equal(values(calendar, "DESCRIPTION").length, 1);
  assert.equal(values(calendar, "ATTENDEE").length, 0);
  assert.equal(
    decodeText(values(calendar, "SUMMARY")[0]),
    `Publish: ${title.replace(/\r\n|\r/g, "\n")}`,
  );
  assert.equal(
    decodeText(values(calendar, "DESCRIPTION")[0]),
    `instagram — ${text.replace(/\r\n|\r/g, "\n")}\nPlanned with Viralify. Publish manually on your platform.`,
  );
  assert.ok(!calendar.replace(/\r\n/g, "").match(/[\r\n]/));
});

test("identifiers cannot inject fields even for malformed imported records", () => {
  const calendar = buildCalendar([
    { ...record, id: "test\r\nATTENDEE:malicious@example.test" },
  ]);
  assert.deepEqual(values(calendar, "ATTENDEE"), []);
  assert.deepEqual(values(calendar, "UID"), [
    "test%0D%0AATTENDEE%3Amalicious%40example.test@viralify.local",
  ]);
});

test("folded Unicode and ASCII lines are at most 75 UTF-8 octets and unfold without loss", () => {
  const title = "🎬नमस्ते世界é".repeat(30);
  const text = "An extended message to test a longer physical line. ".repeat(7);
  const calendar = buildCalendar([
    { ...record, input: { ...input, title, text } },
  ]);
  assert.ok(calendar.includes("\r\n "));
  for (const line of calendar.split("\r\n")) {
    assert.ok(
      Buffer.byteLength(line, "utf8") <= 75,
      `Physical line has ${Buffer.byteLength(line, "utf8")} bytes`,
    );
    assert.equal(
      Buffer.from(line).toString("utf8"),
      line,
      "No broken UTF-16 surrogate is encoded",
    );
  }
  assert.equal(decodeText(values(calendar, "SUMMARY")[0]), `Publish: ${title}`);
  assert.equal(
    decodeText(values(calendar, "DESCRIPTION")[0]),
    `instagram — ${Array.from(text).slice(0, 300).join("")}\nPlanned with Viralify. Publish manually on your platform.`,
  );
});

test("empty export remains a valid calendar envelope and never creates blank events", () => {
  const calendar = buildCalendar([]);
  assert.deepEqual(values(calendar, "BEGIN"), ["VCALENDAR"]);
  assert.deepEqual(values(calendar, "END"), ["VCALENDAR"]);
  assert.ok(!calendar.includes("\r\n\r\n"));
});

test("report includes analysis evidence, alternatives, metrics, schedule assumptions and limitations", () => {
  const report = buildReport(record);
  for (const expected of [
    input.title,
    input.text,
    record.result.optimizedText,
    record.result.summary,
    record.result.publishing.basis,
    record.result.hooks[0],
    record.result.limitations[0],
    "not a probability of going viral",
    "Confidence:",
    "Metrics to review",
    "Asia/Kolkata",
    "weight 22%",
    "Planned release: 2026-09-24T18:30:00+05:30",
  ])
    assert.ok(report.includes(expected), expected);
  assert.ok(!report.includes("undefined"));
  assert.equal(report, buildReport(record));
});

test("media reports include the exact transcript and measured source details", () => {
  const mediaInput: AnalysisInput = {
    ...input,
    type: "video",
    text: "",
    media: {
      name: "test.mp4",
      mimeType: "video/mp4",
      size: 12345,
      width: 1080,
      height: 1920,
      duration: 35.5,
      transcript:
        "A careful claim with a 2.5% estimate that still needs verification.",
    },
  };
  const report = buildReport({
    ...record,
    input: mediaInput,
    result: analyzeContent(mediaInput),
    outcomes: { views: 100, likes: 12, comments: 3, shares: 2, saves: 4 },
  });
  for (const expected of [
    "test.mp4",
    "1080 × 1920",
    "35.5 seconds",
    mediaInput.media!.transcript!,
    "No caption or script supplied.",
    "## Recorded outcomes",
    "- views: 100",
  ])
    assert.ok(report.includes(expected), expected);
});

test("export builders leave saved records untouched", () => {
  const original = structuredClone(record);
  buildCalendar([record]);
  buildReport(record);
  assert.deepEqual(record, original);
});
