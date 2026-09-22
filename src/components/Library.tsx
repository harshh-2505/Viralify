import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  CalendarPlus,
  Check,
  Copy,
  FileText,
  Film,
  Headphones,
  Image,
  Library as LibraryIcon,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { AnalysisRecord } from "../../shared/types";
import { dateLabel, platforms } from "../lib/utils";
import { PlatformIcon } from "./Brand";

export default function Library({
  records,
  onOpen,
  onNew,
  onDelete,
  onSchedule,
  onDuplicate,
  storageMode,
}: {
  records: AnalysisRecord[];
  onOpen: (r: AnalysisRecord) => void;
  onNew: () => void;
  onDelete: (r: AnalysisRecord) => void;
  onSchedule: (r: AnalysisRecord) => void;
  onDuplicate: (r: AnalysisRecord) => void;
  storageMode?: "browser" | "server";
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const visible = useMemo(
    () =>
      records
        .filter(
          (r) =>
            (filter === "all" || r.input.type === filter) &&
            `${r.input.title} ${r.input.text} ${r.input.platform}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "score"
            ? b.result.score - a.result.score
            : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
    [records, search, filter, sort],
  );
  const icons = {
    text: FileText,
    image: Image,
    audio: Headphones,
    video: Film,
  };
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">YOUR IDEAS, ALL TOGETHER</div>
          <h1>
            Content library<span className="title-dot">.</span>
          </h1>
          <p>Every draft is a step forward. Pick up where you left off.</p>
        </div>
        <button className="button primary" onClick={onNew}>
          New analysis
          <ArrowUpRight size={17} />
        </button>
      </div>
      <div className="library-stats">
        <div>
          <span>Content analyzed</span>
          <strong>{records.length.toString().padStart(2, "0")}</strong>
          <p>Your growing collection of ideas</p>
        </div>
        <div>
          <span>Average readiness</span>
          <strong>
            {records.length
              ? Math.round(
                  records.reduce((a, r) => a + r.result.score, 0) /
                    records.length,
                )
              : "—"}
            <small>{records.length ? "/ 100" : ""}</small>
          </strong>
          <p>A quality signal, not a reach forecast</p>
        </div>
        <div>
          <span>Planned for publishing</span>
          <strong>
            {records
              .filter((r) => r.status === "scheduled")
              .length.toString()
              .padStart(2, "0")}
          </strong>
          <p>Good content, with a plan</p>
        </div>
      </div>
      <section className="panel library-panel">
        <div className="library-toolbar">
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="Search content"
              placeholder="Find a title, idea, or platform…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="icon-button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            aria-label="Sort content"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="score">Highest score</option>
          </select>
        </div>
        <div className="filter-tabs">
          {["all", "text", "image", "audio", "video"].map((t) => (
            <button
              className={filter === t ? "active" : ""}
              key={t}
              onClick={() => setFilter(t)}
            >
              {t === "all"
                ? "All content"
                : t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "all" && <span>{records.length}</span>}
            </button>
          ))}
        </div>
        {visible.length ? (
          <div className="library-table">
            <div className="library-row table-header">
              <span>CONTENT</span>
              <span>PLATFORM</span>
              <span>READINESS</span>
              <span>STATUS</span>
              <span />
            </div>
            {visible.map((r) => {
              const Icon = icons[r.input.type];
              return (
                <div className="library-row" key={r.id}>
                  <button className="content-cell" onClick={() => onOpen(r)}>
                    <span className={`content-type-icon ${r.input.type}`}>
                      <Icon size={21} />
                    </span>
                    <span>
                      <strong>{r.input.title || "Untitled content"}</strong>
                      <small>
                        {dateLabel(r.createdAt)} <i>·</i>{" "}
                        {r.input.type.charAt(0).toUpperCase() +
                          r.input.type.slice(1)}
                      </small>
                    </span>
                  </button>
                  <span className="platform-cell">
                    <PlatformIcon platform={r.input.platform} />
                    {platforms.find((p) => p.id === r.input.platform)?.label}
                  </span>
                  <span
                    className={`table-score ${r.result.score >= 70 ? "good" : r.result.score < 45 ? "low" : ""}`}
                  >
                    <i />
                    {r.result.score}
                    <small>/100</small>
                  </span>
                  <span>
                    <span className={`status-tag ${r.status}`}>
                      {r.status === "analyzed"
                        ? "Analyzed"
                        : r.status === "scheduled"
                          ? "Planned"
                          : "Published"}
                    </span>
                  </span>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      title="View report"
                      aria-label={`View ${r.input.title}`}
                      onClick={() => onOpen(r)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                    <details>
                      <summary
                        className="icon-button"
                        aria-label={`Actions for ${r.input.title}`}
                      >
                        <MoreHorizontal size={18} />
                      </summary>
                      <div className="action-menu">
                        <button onClick={() => onSchedule(r)}>
                          <CalendarPlus size={15} />
                          Plan publishing
                        </button>
                        <button onClick={() => onDuplicate(r)}>
                          <Copy size={15} />
                          Revise draft
                        </button>
                        <button
                          className="danger-text"
                          onClick={() => onDelete(r)}
                        >
                          <Trash2 size={15} />
                          Delete report
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <LibraryIcon size={30} />
            </span>
            <h3>
              {records.length
                ? "No matching ideas. Yet."
                : "Your next great idea belongs here."}
            </h3>
            <p>
              {records.length
                ? "Try another search or content type."
                : "Analyze your first piece of content to start your collection."}
            </p>
            <button
              className="button secondary"
              onClick={
                records.length
                  ? () => {
                      setSearch("");
                      setFilter("all");
                    }
                  : onNew
              }
            >
              {records.length ? "Clear filters" : "Analyze your first idea"}
              <ArrowUpRight size={16} />
            </button>
          </div>
        )}
      </section>
      <div className="page-footnote">
        <Check size={14} />
        {storageMode === "browser"
          ? "Reports are saved in this browser. Export reports before clearing browser data."
          : "Reports are saved on this device’s server."}{" "}
        Your original media files are removed after analysis.
      </div>
    </>
  );
}
