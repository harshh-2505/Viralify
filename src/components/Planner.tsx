import { useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Plus,
} from "lucide-react";
import type { AnalysisRecord } from "../../shared/types";
import { dateLabel, exportCalendar, timeLabel } from "../lib/utils";
import { PlatformIcon } from "./Brand";

function dateKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export default function Planner({
  records,
  timezone,
  onOpen,
  onNew,
  onSchedule,
  onTrack,
  onUnschedule,
}: {
  records: AnalysisRecord[];
  timezone: string;
  onOpen: (r: AnalysisRecord) => void;
  onNew: () => void;
  onSchedule: (r: AnalysisRecord) => void;
  onTrack: (r: AnalysisRecord) => void;
  onUnschedule: (r: AnalysisRecord) => void;
}) {
  const [offset, setOffset] = useState(0);
  const todayKey = dateKey(new Date(), timezone);
  const today = new Date(`${todayKey}T12:00:00Z`);
  const monday = new Date(today);
  monday.setUTCDate(
    today.getUTCDate() - ((today.getUTCDay() + 6) % 7) + offset * 7,
  );
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  const scheduled = records
    .filter((r) => r.scheduledAt && r.status === "scheduled")
    .sort(
      (a, b) =>
        new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime(),
    );
  const unscheduled = records.filter((r) => r.status === "analyzed");
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">GIVE YOUR CONTENT A MOMENT</div>
          <h1>
            Publishing planner<span className="title-dot">.</span>
          </h1>
          <p>A little intention goes a long way. Plan, publish, and learn.</p>
        </div>
        <button
          className="button secondary"
          disabled={!scheduled.length}
          onClick={() => exportCalendar(records)}
        >
          <Download size={16} />
          Export calendar
        </button>
      </div>
      <div className="planner-banner">
        <span className="round-icon">
          <Clock3 size={22} />
        </span>
        <div>
          <h3>Consistency starts with a plan.</h3>
          <p>
            Add your content to a time slot, then publish on your chosen
            platform. Calendar reminders keep you on track.
          </p>
        </div>
        <span className="tag">Manual publishing</span>
      </div>
      <section className="panel calendar-panel">
        <div className="calendar-toolbar">
          <h3>
            {dateLabel(days[0].toISOString(), "UTC")} –{" "}
            {dateLabel(days[6].toISOString(), "UTC")}
            <span>{monday.getUTCFullYear()}</span>
          </h3>
          <div>
            <span className="timezone-label">
              {timezone.replace(/_/g, " ")}
            </span>
            <button
              className="button secondary small-button"
              onClick={() => setOffset(0)}
            >
              Today
            </button>
            <button
              className="icon-button"
              aria-label="Previous week"
              onClick={() => setOffset(offset - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Next week"
              onClick={() => setOffset(offset + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
        <div className="calendar-grid">
          {days.map((day, i) => {
            const key = day.toISOString().slice(0, 10);
            const items = scheduled.filter(
              (r) => dateKey(new Date(r.scheduledAt!), timezone) === key,
            );
            return (
              <div
                className={`calendar-day ${key === todayKey ? "today" : ""}`}
                key={key}
              >
                <div className="calendar-day-header">
                  <span>
                    {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][i]}
                  </span>
                  <strong>{day.getUTCDate()}</strong>
                </div>
                <div className="calendar-day-content">
                  {items.length ? (
                    items.map((r) => (
                      <button
                        className="calendar-event"
                        onClick={() => onOpen(r)}
                        key={r.id}
                      >
                        <span>
                          <PlatformIcon platform={r.input.platform} size={13} />
                          {timeLabel(r.scheduledAt!, timezone)}
                        </span>
                        <strong>{r.input.title || "Untitled content"}</strong>
                        <small>Readiness {r.result.score}/100</small>
                      </button>
                    ))
                  ) : (
                    <span className="calendar-empty">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <div className="planner-bottom">
        <section className="panel">
          <div className="section-heading">
            <h3>Coming up next</h3>
            <span className="tag">{scheduled.length} planned</span>
          </div>
          {scheduled.length ? (
            scheduled.slice(0, 6).map((r) => (
              <div className="planned-row" key={r.id}>
                <span className="date-block">
                  <strong>
                    {new Intl.DateTimeFormat("en", {
                      day: "numeric",
                      timeZone: timezone,
                    }).format(new Date(r.scheduledAt!))}
                  </strong>
                  <small>
                    {new Intl.DateTimeFormat("en", {
                      month: "short",
                      timeZone: timezone,
                    }).format(new Date(r.scheduledAt!))}
                  </small>
                </span>
                <div>
                  <button className="text-link" onClick={() => onOpen(r)}>
                    {r.input.title || "Untitled content"}
                  </button>
                  <p>
                    {timeLabel(r.scheduledAt!, timezone)} · {r.input.platform}
                    {new Date(r.scheduledAt!) < new Date()
                      ? " · Time passed"
                      : ""}
                  </p>
                  <button
                    className="text-link muted small-link"
                    onClick={() => onUnschedule(r)}
                  >
                    Remove from plan
                  </button>
                </div>
                <button
                  className="button secondary small-button"
                  onClick={() => onTrack(r)}
                >
                  Log results
                </button>
              </div>
            ))
          ) : (
            <div className="compact-empty">
              <CalendarDays size={26} />
              <p>A clear calendar. A fresh start.</p>
              <span>Add an analyzed draft to plan your next post.</span>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h3>Ready for a date</h3>
            <span className="tag">{unscheduled.length} drafts</span>
          </div>
          {unscheduled.length ? (
            unscheduled.slice(0, 5).map((r) => (
              <div className="ready-row" key={r.id}>
                <span className="ready-platform">
                  <PlatformIcon platform={r.input.platform} size={18} />
                </span>
                <div>
                  <strong>{r.input.title || "Untitled content"}</strong>
                  <small>
                    {r.input.type} · {r.result.score}/100 readiness
                  </small>
                </div>
                <button
                  className="icon-button"
                  title="Schedule draft"
                  aria-label={`Schedule ${r.input.title}`}
                  onClick={() => onSchedule(r)}
                >
                  <Plus size={19} />
                </button>
              </div>
            ))
          ) : (
            <div className="compact-empty">
              <p>Make room for your next idea.</p>
              <button className="text-link" onClick={onNew}>
                Analyze something new
                <ArrowUpRight size={15} />
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
