import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  Lightbulb,
  Sparkles,
  Target,
  TrendingUp,
  WandSparkles,
  CalendarPlus,
  ChevronDown,
  Info,
} from "lucide-react";
import type { AnalysisRecord, AnalysisResult } from "../../shared/types";
import { downloadReport } from "../lib/utils";

export function Heatmap({
  publishing,
}: {
  publishing: AnalysisResult["publishing"];
}) {
  return (
    <div className="heatmap-wrap">
      <div
        className="heatmap"
        role="img"
        aria-label={`Suggested publishing activity by day and time in ${publishing.timezone}; hypothetical starting points, not observed audience activity`}
      >
        <span />
        {[
          "12a",
          "2a",
          "4a",
          "6a",
          "8a",
          "10a",
          "12p",
          "2p",
          "4p",
          "6p",
          "8p",
          "10p",
        ].map((h) => (
          <span className="heatmap-hour" key={h}>
            {h}
          </span>
        ))}
        {publishing.heatmap.map((hours, day) => (
          <div className="heatmap-row" key={day}>
            <span className="heatmap-day">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day]}
            </span>
            {hours.map((value, index) => (
              <span
                className="heatmap-cell"
                key={index}
                title={`${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day]}, ${index * 2}:00 — experiment priority ${value}/100`}
                style={{
                  background: `rgba(34, 118, 89, ${0.07 + value / 115})`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend">
        <span>Suggested test windows</span>
        <span>
          Lower{" "}
          {[0.1, 0.3, 0.5, 0.7, 0.93].map((a) => (
            <i key={a} style={{ background: `rgba(34,118,89,${a})` }} />
          ))}{" "}
          Higher
        </span>
      </div>
    </div>
  );
}

export default function Results({
  record,
  onOptimize,
  onSchedule,
  notify,
  previousScore,
}: {
  record: AnalysisRecord;
  onOptimize: (text: string) => void;
  onSchedule: () => void;
  notify: (text: string) => void;
  previousScore?: number;
}) {
  const [tab, setTab] = useState<"overview" | "improvements" | "publishing">(
    "overview",
  );
  const [details, setDetails] = useState(false);
  const r = record.result;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard.");
    } catch {
      notify("Clipboard unavailable. Select the text to copy it.");
    }
  };
  return (
    <section className="report-section" aria-label="Content analysis report">
      <div className="section-heading">
        <div>
          <div className="eyebrow">THE SIGNAL BEHIND YOUR CONTENT</div>
          <h2>Your content, with a little clarity.</h2>
        </div>
        <button
          className="button secondary small-button"
          onClick={() => downloadReport(record)}
        >
          <Download size={15} />
          Export report
        </button>
      </div>
      <div className="report-summary">
        <div className="score-visual">
          <svg viewBox="0 0 160 160" aria-hidden="true">
            <circle
              cx="80"
              cy="80"
              r="67"
              fill="none"
              stroke="#e7eee8"
              strokeWidth="10"
            />
            <circle
              cx="80"
              cy="80"
              r="67"
              fill="none"
              stroke={
                r.score >= 70
                  ? "#21664f"
                  : r.score >= 45
                    ? "#be853f"
                    : "#b7644d"
              }
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(r.score / 100) * 421} 421`}
              transform="rotate(-90 80 80)"
            />
          </svg>
          <div>
            <strong>{r.score}</strong>
            <span>out of 100</span>
          </div>
        </div>
        <div className="report-verdict">
          <div className="inline-labels">
            <span className="tag green">
              {r.mode === "ai"
                ? "AI-assisted assessment"
                : "Rule-based assessment"}
            </span>
            <span className="muted">
              {r.confidence === "low" ? "Limited" : "Moderate"} evidence
            </span>
          </div>
          <h2>{r.verdict}</h2>
          <p>{r.summary}</p>
          <span className="score-disclaimer">
            <Info size={13} />
            Content readiness, not a probability of going viral.
          </span>
          {previousScore !== undefined && (
            <div className="comparison">
              <TrendingUp size={15} />
              {r.score - previousScore >= 0 ? "+" : ""}
              {r.score - previousScore} points compared with your previous draft
            </div>
          )}
        </div>
      </div>
      <div className="report-tabs" role="tablist" aria-label="Report sections">
        {(["overview", "improvements", "publishing"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "overview"
              ? "Signal breakdown"
              : t === "improvements"
                ? `Improvements (${r.suggestions.length})`
                : "Publishing plan"}
            {t === "improvements" && <Sparkles size={13} />}
          </button>
        ))}
      </div>
      <div className="report-panel" role="tabpanel">
        {tab === "overview" && (
          <>
            <div className="dimensions">
              {r.dimensions.map((d, i) => (
                <article className="dimension" key={d.id}>
                  <div className="dimension-label">
                    <span>
                      <span className="dimension-number">0{i + 1}</span>
                      {d.label}
                    </span>
                    <strong>
                      {d.weight === 0 ? "—" : d.score}
                      <small>{d.weight === 0 ? "" : "/100"}</small>
                    </strong>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${d.score}%`,
                        background:
                          d.score >= 70
                            ? "#3d8569"
                            : d.score >= 45
                              ? "#c6a060"
                              : "#bf8571",
                      }}
                    />
                  </div>
                  <p>{d.explanation}</p>
                  <span className="dimension-weight">
                    {d.weight === 0
                      ? "Not assessed · excluded from score"
                      : `${Math.round(d.weight <= 1 ? d.weight * 100 : d.weight)}% of overall score`}
                  </span>
                </article>
              ))}
            </div>
            {r.strengths.length > 0 && (
              <div className="strengths">
                <h3>
                  <Check size={17} />
                  Keep doing this
                </h3>
                {r.strengths.map((s, i) => (
                  <p key={i}>
                    <Check size={14} />
                    {s}
                  </p>
                ))}
              </div>
            )}
            <div className="metrics-grid">
              {r.metrics.map((m) => (
                <div className="metric-mini" key={m.label}>
                  <span>{m.label}</span>
                  <strong>{m.value}</strong>
                  <p>{m.detail}</p>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "improvements" && (
          <>
            <div className="suggestions">
              {r.suggestions.map((s, i) => (
                <article className="suggestion" key={s.id}>
                  <span className="suggestion-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="suggestion-heading">
                      <h3>{s.title}</h3>
                      <span className={`priority ${s.priority}`}>
                        {s.priority} priority
                      </span>
                    </div>
                    <p>{s.detail}</p>
                    {s.example && <blockquote>{s.example}</blockquote>}
                  </div>
                </article>
              ))}
            </div>
            <div className="rewrite-box">
              <div className="section-heading">
                <h3>
                  <WandSparkles size={17} />A starting point for your next draft
                </h3>
                <button
                  className="icon-button"
                  title="Copy revised draft"
                  aria-label="Copy revised draft"
                  onClick={() => copy(r.optimizedText)}
                >
                  <Copy size={16} />
                </button>
              </div>
              <p className="rewritten-text">{r.optimizedText}</p>
              <div className="rewrite-bottom">
                <span>Review the wording and facts before publishing.</span>
                <button
                  className="button primary small-button"
                  onClick={() => onOptimize(r.optimizedText)}
                >
                  Use this draft
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
            <h3 className="subheading">Try a different opening</h3>
            <div className="hook-list">
              {r.hooks.map((h, i) => (
                <button key={i} onClick={() => copy(h)}>
                  <span>
                    <small>OPTION 0{i + 1}</small>
                    {h}
                  </span>
                  <Copy size={15} />
                </button>
              ))}
            </div>
            {r.hashtags.length > 0 && (
              <div className="hashtag-box">
                <h3>Topic tags to consider</h3>
                <div>
                  {r.hashtags.map((h) => (
                    <button key={h} onClick={() => copy(h)}>
                      {h.startsWith("#") ? h : `#${h}`}
                    </button>
                  ))}
                </div>
                <p>
                  Suggestions based on your content. Check relevance and current
                  usage on your platform.
                </p>
              </div>
            )}
          </>
        )}
        {tab === "publishing" && (
          <>
            <div className="publishing-intro">
              <div>
                <h3>Find your window.</h3>
                <p>Start with a hypothesis. Learn from your audience.</p>
              </div>
              <span className="tag">
                <Clock3 size={12} />
                {r.publishing.timezone.replace(/_/g, " ")}
              </span>
            </div>
            <Heatmap publishing={r.publishing} />
            <div className="slots">
              {r.publishing.slots.map((s, i) => (
                <div className="slot" key={i}>
                  <span className="slot-rank">0{i + 1}</span>
                  <div>
                    <h4>
                      {s.day} · {s.label}
                    </h4>
                    <p>{s.reason}</p>
                  </div>
                  <Clock3 size={16} />
                </div>
              ))}
            </div>
            <p className="evidence-note">
              <Info size={14} />
              {r.publishing.basis}
            </p>
            <button className="button primary" onClick={onSchedule}>
              <CalendarPlus size={17} />
              Add to publishing plan
            </button>
          </>
        )}
      </div>
      <button
        className="limitations-toggle"
        onClick={() => setDetails(!details)}
        aria-expanded={details}
      >
        <CircleHelp size={15} />
        How to read this assessment
        <ChevronDown size={15} className={details ? "rotate" : ""} />
      </button>
      {details && (
        <div className="limitations">
          <p>
            This is a content assessment, not a trained or calibrated prediction
            of future reach. Platform distribution, your existing audience, and
            timing all affect the outcome.
          </p>
          <ul>
            {r.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {record.input.media && (
            <p>
              Measured file: {record.input.media.name}
              {record.input.media.width
                ? ` · ${record.input.media.width} × ${record.input.media.height}`
                : ""}
              {record.input.media.duration
                ? ` · ${Math.round(record.input.media.duration)} seconds`
                : ""}
              .{" "}
              {record.input.media.transcript
                ? "Speech transcription was included."
                : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function EmptyInsights() {
  return (
    <aside className="insights-card">
      <div className="insights-heading">
        <span className="round-icon">
          <Sparkles size={19} />
        </span>
        <span>From idea to impact</span>
        <span className="tiny-stars">✧</span>
      </div>
      <div className="empty-gauge">
        <svg viewBox="0 0 200 114" aria-hidden="true">
          <path
            d="M24 98a76 76 0 0 1 152 0"
            fill="none"
            stroke="#e6ece6"
            strokeWidth="13"
            strokeLinecap="round"
          />
          <path
            d="M24 98a76 76 0 0 1 98-73"
            fill="none"
            stroke="#b8cdb6"
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray="5 9"
          />
          <path
            d="M122 25a76 76 0 0 1 54 73"
            fill="none"
            stroke="#36775b"
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray="5 9"
          />
        </svg>
        <div>
          <Sparkles size={26} />
          <span>Your next breakthrough?</span>
        </div>
      </div>
      <h3>
        A fresh perspective.
        <br />
        Before you hit publish.
      </h3>
      <p>Understand what’s landing, what’s missing, and what to try next.</p>
      <div className="insight-benefits">
        <div>
          <Target size={18} />
          <span>
            <strong>Understand your potential</strong>
            <small>Six signals. One clear assessment.</small>
          </span>
        </div>
        <div>
          <WandSparkles size={18} />
          <span>
            <strong>Make every word work harder</strong>
            <small>Specific feedback you can act on.</small>
          </span>
        </div>
        <div>
          <Clock3 size={18} />
          <span>
            <strong>Find your moment</strong>
            <small>Publishing windows worth testing.</small>
          </span>
        </div>
      </div>
      <div className="insight-footnote">
        <Lightbulb size={16} />
        <p>
          Virality isn’t a promise.
          <br />
          Better content is a practice.
        </p>
        <ArrowRight size={16} />
      </div>
    </aside>
  );
}
