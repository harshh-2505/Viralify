import {
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Sparkles,
  Target,
} from "lucide-react";
import type { AnalysisRecord } from "../../shared/types";

export default function Learn({
  records,
  onTrack,
  onNew,
}: {
  records: AnalysisRecord[];
  onTrack: (r: AnalysisRecord) => void;
  onNew: () => void;
}) {
  const published = records.filter((r) => r.outcomes);
  const totals = published.reduce(
    (a, r) => ({
      views: a.views + r.outcomes!.views,
      likes: a.likes + r.outcomes!.likes,
      comments: a.comments + r.outcomes!.comments,
      shares: a.shares + r.outcomes!.shares,
      saves: a.saves + r.outcomes!.saves,
    }),
    { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 },
  );
  const metricCards = [
    { label: "Views", value: totals.views, Icon: Eye },
    { label: "Likes", value: totals.likes, Icon: Heart },
    { label: "Comments", value: totals.comments, Icon: MessageCircle },
    { label: "Shares", value: totals.shares, Icon: Share2 },
    { label: "Saves", value: totals.saves, Icon: Bookmark },
  ];
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">LESS GUESSING. MORE LEARNING.</div>
          <h1>
            Your learning loop<span className="title-dot">.</span>
          </h1>
          <p>Connect your content decisions to what actually happened.</p>
        </div>
        <span className="tag">Manually recorded results</span>
      </div>
      <div className="outcome-metrics">
        {metricCards.map(({ label, value, Icon }) => (
          <div className="panel" key={label}>
            <span>
              <Icon size={17} />
              {label}
            </span>
            <strong>{published.length ? value.toLocaleString() : "—"}</strong>
          </div>
        ))}
      </div>
      <section className="panel learning-results">
        <div className="section-heading">
          <div>
            <h3>From signals to real outcomes</h3>
            <p>
              Log results after a consistent observation period, such as 7 days.
            </p>
          </div>
          <BarChart3 size={22} />
        </div>
        {records.length ? (
          <div className="outcomes-table">
            <div className="outcome-row outcome-header">
              <span>CONTENT</span>
              <span>READINESS</span>
              <span>VIEWS</span>
              <span>ENGAGEMENT*</span>
              <span />
            </div>
            {records.map((r) => {
              const o = r.outcomes;
              const engagement =
                o && o.views > 0
                  ? ((o.likes + o.comments + o.shares + o.saves) / o.views) *
                    100
                  : null;
              return (
                <div className="outcome-row" key={r.id}>
                  <div>
                    <strong>{r.input.title || "Untitled content"}</strong>
                    <small>
                      {r.input.platform} · {r.input.type}
                    </small>
                  </div>
                  <span>
                    {r.result.score}
                    <small>/100</small>
                  </span>
                  <span>{o ? o.views.toLocaleString() : "—"}</span>
                  <span>
                    {engagement !== null ? `${engagement.toFixed(1)}%` : "—"}
                  </span>
                  <button
                    className="button secondary small-button"
                    onClick={() => onTrack(r)}
                  >
                    {o ? "Edit results" : "Log results"}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <BarChart3 size={30} />
            </span>
            <h3>Every post can teach you something.</h3>
            <p>Analyze content, publish it, then log the results here.</p>
            <button className="button primary" onClick={onNew}>
              Start with an idea
              <ArrowUpRight size={16} />
            </button>
          </div>
        )}
        <p className="table-note">
          * (Likes + comments + shares + saves) ÷ views. Interactions can
          overlap; this is not a unique-person rate. Compare the same platform,
          format, and observation period.
        </p>
      </section>
      <div className="learning-cards">
        <article className="panel">
          <span className="learning-icon">
            <Target size={24} />
          </span>
          <span className="eyebrow">01 · CHANGE ONE THING</span>
          <h3>Give your experiment a focus.</h3>
          <p>
            Try a new opening, a tighter edit, or a different posting time.
            Keeping other choices similar makes the result easier to understand.
          </p>
        </article>
        <article className="panel">
          <span className="learning-icon peach">
            <Sparkles size={24} />
          </span>
          <span className="eyebrow">02 · LET YOUR AUDIENCE SPEAK</span>
          <h3>Look beyond the view count.</h3>
          <p>
            Saves can indicate lasting usefulness. Shares can indicate
            resonance. Retention can show where attention drops. Choose the
            signal that fits your goal.
          </p>
        </article>
        <article className="panel">
          <span className="learning-icon lavender">
            <BarChart3 size={24} />
          </span>
          <span className="eyebrow">03 · BUILD YOUR OWN BASELINE</span>
          <h3>Look for patterns over time.</h3>
          <p>
            Several comparable posts tell you more than one outlier. Use your
            platform’s audience analytics to refine the suggested publishing
            windows.
          </p>
          <a
            className="text-link"
            href="https://support.google.com/youtube/answer/9314416?hl=en"
            target="_blank"
            rel="noreferrer"
          >
            YouTube’s audience guide
            <ArrowUpRight size={14} />
          </a>
        </article>
      </div>
    </>
  );
}
