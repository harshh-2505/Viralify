import type { AnalysisRecord, Platform } from "../../shared/types";

export const platforms: {
  id: Platform;
  label: string;
  short: string;
  color: string;
}[] = [
  { id: "instagram", label: "Instagram", short: "IG", color: "#bd4877" },
  { id: "tiktok", label: "TikTok", short: "Tk", color: "#283a3c" },
  { id: "youtube", label: "YouTube", short: "YT", color: "#db5148" },
  { id: "linkedin", label: "LinkedIn", short: "in", color: "#367ca6" },
  { id: "x", label: "X / Twitter", short: "X", color: "#333f48" },
];
export const timezones = [
  "Asia/Kolkata",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];
export function dateLabel(value: string, timezone?: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
}
export function timeLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}
/** Build a portable report without a browser, clock, or changes to the saved record. */
export function buildReport(record: AnalysisRecord): string {
  const { input, result } = record;
  const sections = [
    `# ${input.title || "Untitled content"}`,
    `Viralify content assessment\n\nCreated: ${record.createdAt}\nUpdated: ${record.updatedAt}\nPlatform: ${input.platform}\nContent type: ${input.type}\nGoal: ${input.goal}\nAudience: ${input.audience || "Not specified"}\nAudience timezone: ${input.timezone}\nMode: ${result.mode}\nConfidence: ${result.confidence}\nStatus: ${record.status}${record.scheduledAt ? `\nPlanned release: ${record.scheduledAt}` : ""}`,
    `Readiness score: ${result.score}/100 (not a probability of going viral)\n\n${result.verdict}\n\n${result.summary}`,
    `## Content\n\n${input.text || "No caption or script supplied."}`,
  ];
  if (input.media) {
    sections.push(
      `## Source media\n\nFile: ${input.media.name}\nType: ${input.media.mimeType}\nSize: ${input.media.size} bytes${input.media.width && input.media.height ? `\nDimensions: ${input.media.width} × ${input.media.height}` : ""}${input.media.duration !== undefined ? `\nDuration: ${input.media.duration} seconds` : ""}`,
    );
    if (input.media.transcript)
      sections.push(`## Transcript reviewed\n\n${input.media.transcript}`);
  }
  sections.push(
    `## Signal breakdown\n\n${result.dimensions.map((d) => `- ${d.label}: ${d.score}/100 (weight ${d.weight}%) — ${d.explanation}`).join("\n")}`,
    `## Strengths\n\n${result.strengths.length ? result.strengths.map((s) => `- ${s}`).join("\n") : "Not enough evidence to identify a specific strength."}`,
    `## Improvements\n\n${result.suggestions.map((s) => `- [${s.priority}] ${s.title}: ${s.detail}${s.example ? `\n  Example: ${s.example}` : ""}`).join("\n")}`,
    `## Suggested draft\n\n${result.optimizedText || "Add a caption, script or transcript to create a suggested draft."}`,
    `## Hook alternatives\n\n${result.hooks.map((hook, index) => `${index + 1}. ${hook}`).join("\n")}`,
    `## Suggested hashtags\n\n${result.hashtags.join(" ") || "No tags suggested."}`,
    `## Publishing experiments (${result.publishing.timezone})\n\n${result.publishing.slots.map((s) => `- ${s.label}: ${s.reason}`).join("\n")}\n\n${result.publishing.basis}`,
    `## Metrics to review\n\n${result.metrics.map((metric) => `- ${metric.label}: ${metric.value} — ${metric.detail}`).join("\n")}`,
  );
  if (record.outcomes)
    sections.push(
      `## Recorded outcomes\n\n${Object.entries(record.outcomes)
        .map(([label, value]) => `- ${label}: ${value}`)
        .join("\n")}`,
    );
  sections.push(
    `## Limitations\n\n${result.limitations.map((l) => `- ${l}`).join("\n")}`,
  );
  return `${sections.join("\n\n")}\n`;
}
export function downloadReport(record: AnalysisRecord) {
  download(
    buildReport(record),
    `viralify-${record.id.slice(0, 8)}.md`,
    "text/markdown;charset=utf-8",
  );
}
export function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// RFC 5545 §3.3.11: escape TEXT values; raw CR/LF must never inject properties.
function calendarText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
const utf8 = new TextEncoder();
// RFC 5545 §3.1: fold at 75 UTF-8 octets, including the continuation space,
// and never split a Unicode code point. https://www.rfc-editor.org/rfc/rfc5545
function foldCalendarLine(line: string): string {
  const physicalLines: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = utf8.encode(character).length;
    if (bytes + size > 75) {
      physicalLines.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  physicalLines.push(current);
  return physicalLines.join("\r\n");
}
function calendarStamp(date: Date): string | null {
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 0 ||
    date.getUTCFullYear() > 9999
  )
    return null;
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** A deterministic, clock-free export of scheduled records. Invalid dates are omitted. */
export function buildCalendar(records: readonly AnalysisRecord[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Viralify//Publishing Planner//EN",
    "CALSCALE:GREGORIAN",
  ];
  const included = new Set<string>();
  for (const record of records) {
    if (
      record.status !== "scheduled" ||
      !record.scheduledAt ||
      included.has(record.id)
    )
      continue;
    const start = new Date(record.scheduledAt);
    const startStamp = calendarStamp(start);
    const endStamp = calendarStamp(new Date(start.getTime() + 30 * 60 * 1000));
    if (!startStamp || !endStamp) continue;
    // With no METHOD property, DTSTAMP represents the component's last revision.
    const updated =
      calendarStamp(new Date(record.updatedAt)) ??
      calendarStamp(new Date(record.createdAt)) ??
      startStamp;
    const snippet = Array.from(record.input.text).slice(0, 300).join("");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${encodeURIComponent(record.id)}@viralify.local`,
      `DTSTAMP:${updated}`,
      `LAST-MODIFIED:${updated}`,
      `DTSTART:${startStamp}`,
      `DTEND:${endStamp}`,
      `SUMMARY:${calendarText(`Publish: ${record.input.title || "Untitled content"}`)}`,
      `DESCRIPTION:${calendarText(`${record.input.platform} — ${snippet}\nPlanned with Viralify. Publish manually on your platform.`)}`,
      "END:VEVENT",
    );
    included.add(record.id);
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}

export function exportCalendar(records: readonly AnalysisRecord[]) {
  download(
    buildCalendar(records),
    "viralify-publishing-plan.ics",
    "text/calendar;charset=utf-8",
  );
}
