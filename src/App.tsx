import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Film,
  Globe2,
  Image as ImageIcon,
  Info,
  Layers3,
  Library as LibraryIcon,
  LoaderCircle,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import type {
  AnalysisInput,
  AnalysisRecord,
  Capabilities,
  ContentType,
  Goal,
  Platform,
} from "../shared/types";
import { api } from "./lib/api";
import { platforms, timezones } from "./lib/utils";
import { localDateTime, zonedDateTimeToIso } from "./lib/timezone";
import { Logo, PlatformIcon } from "./components/Brand";
import MediaUpload from "./components/MediaUpload";
import Modal from "./components/Modal";
import Results, { EmptyInsights } from "./components/Results";
import Library from "./components/Library";
import Planner from "./components/Planner";
import Learn from "./components/Learn";

type Page = "analyzer" | "library" | "planner" | "learn";
interface Preferences {
  name: string;
  timezone: string;
  platform: Platform;
  goal: Goal;
}
const defaultPreferences: Preferences = {
  name: "Creator",
  timezone: "Asia/Kolkata",
  platform: "instagram",
  goal: "reach",
};
function readPreferences(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("viralify.preferences") || "{}",
    );
    const next = { ...defaultPreferences, ...value };
    new Intl.DateTimeFormat("en", { timeZone: next.timezone });
    if (!platforms.some((p) => p.id === next.platform))
      next.platform = "instagram";
    if (
      !["reach", "engagement", "community", "conversions"].includes(next.goal)
    )
      next.goal = "reach";
    if (typeof next.name !== "string") next.name = "Creator";
    return next;
  } catch {
    return defaultPreferences;
  }
}
const navItems = [
  { id: "analyzer" as const, label: "Content analyzer", Icon: Sparkles },
  { id: "library" as const, label: "Content library", Icon: LibraryIcon },
  { id: "planner" as const, label: "Publishing planner", Icon: CalendarDays },
  { id: "learn" as const, label: "Learning loop", Icon: BarChart3 },
];
const contentTypes = [
  { id: "text" as const, label: "Text", Icon: FileText },
  { id: "image" as const, label: "Image", Icon: ImageIcon },
  { id: "audio" as const, label: "Audio", Icon: AudioLines },
  { id: "video" as const, label: "Video", Icon: Film },
];
const goals = [
  { id: "reach", label: "Reach more people" },
  { id: "engagement", label: "Start conversations" },
  { id: "community", label: "Build a community" },
  { id: "conversions", label: "Drive an action" },
];
const sample =
  "Feeling creatively stuck? Try this 10-minute reset.\n\n1. Put your phone in another room.\n2. Write down the one idea you keep postponing.\n3. Make the smallest possible version of it. A sketch. Three sentences. A 15-second clip.\n\nThe goal is to make something, not to make it perfect.\n\nWhat would you create with 10 minutes and zero pressure? Save this for your next creative block.\n\n#CreativeProcess #ContentCreation";

export default function App() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [page, setPage] = useState<Page>(
    () =>
      navItems.find((n) => n.id === location.hash.slice(1))?.id || "analyzer",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [records, setRecords] = useState<AnalysisRecord[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [type, setType] = useState<ContentType>("text");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>(preferences.platform);
  const [goal, setGoal] = useState<Goal>(preferences.goal);
  const [audience, setAudience] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [record, setRecord] = useState<AnalysisRecord | null>(null);
  const [previousScore, setPreviousScore] = useState<number>();
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [viewRecord, setViewRecord] = useState<AnalysisRecord | null>(null);
  const [scheduleRecord, setScheduleRecord] = useState<AnalysisRecord | null>(
    null,
  );
  const [trackRecord, setTrackRecord] = useState<AnalysisRecord | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<AnalysisRecord | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const navigate = useCallback((next: Page) => {
    setPage(next);
    location.hash = next;
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const refresh = useCallback(async () => {
    try {
      const [health, history] = await Promise.all([api.health(), api.list()]);
      setCapabilities(health);
      setRecords(history);
      setConnectionError("");
    } catch (error) {
      setConnectionError(
        error instanceof Error
          ? error.message
          : "Could not connect to the server.",
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const hash = () =>
      setPage(
        navItems.find((n) => n.id === location.hash.slice(1))?.id || "analyzer",
      );
    window.addEventListener("hashchange", hash);
    return () => {
      window.removeEventListener("hashchange", hash);
      clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  const updateRecord = (updated: AnalysisRecord) => {
    setRecords((old) => old.map((r) => (r.id === updated.id ? updated : r)));
    setRecord((old) => (old?.id === updated.id ? updated : old));
    setViewRecord((old) => (old?.id === updated.id ? updated : old));
  };
  const newAnalysis = () => {
    if (busy) {
      notify("An analysis is in progress. Please wait for it to finish.");
      return;
    }
    setPlatform(preferences.platform);
    setGoal(preferences.goal);
    setType("text");
    setText("");
    setTitle("");
    setFile(null);
    setRecord(null);
    setPreviousScore(undefined);
    setFormError("");
    setAudience("");
    navigate("analyzer");
  };
  const useExample = () => {
    if (busy) return;
    setType("text");
    setFile(null);
    setText(sample);
    setTitle("The 10-minute creative reset");
    setAudience("Creators and creative professionals");
    setRecord(null);
    setPreviousScore(undefined);
    setFormError("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    notify("Example loaded. Make it your own or run an analysis.");
  };
  const analyze = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setFormError("");
    if (type === "text" && text.trim().length < 20) {
      setFormError(
        "Add at least 20 characters so there is enough content to assess.",
      );
      return;
    }
    if (type !== "text" && !file) {
      setFormError(`Upload a ${type} file to continue.`);
      return;
    }
    setBusy(true);
    try {
      const input: AnalysisInput = {
        title,
        text,
        type,
        platform,
        goal,
        audience,
        timezone: preferences.timezone,
      };
      const next = await api.analyze(input, file);
      setRecord(next);
      setRecords((old) => [next, ...old]);
      setConnectionError("");
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        80,
      );
      notify("Analysis complete. Your report is saved to the library.");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Analysis failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const revise = (r: AnalysisRecord, optimized?: string) => {
    if (busy) {
      notify("An analysis is in progress. Please wait for it to finish.");
      return;
    }
    setType(r.input.type);
    setText(optimized ?? r.input.text);
    setTitle(r.input.title);
    setAudience(r.input.audience);
    setGoal(r.input.goal);
    setPlatform(r.input.platform);
    if (record?.id !== r.id) setFile(null);
    setPreviousScore(
      r.result.dimensions.some((d) => d.weight === 0)
        ? undefined
        : r.result.score,
    );
    setRecord(null);
    setViewRecord(null);
    navigate("analyzer");
    setFormError("");
    setTimeout(
      () => formRef.current?.scrollIntoView({ behavior: "smooth" }),
      70,
    );
    notify(
      r.input.type === "text"
        ? "Draft ready. Edit it, then analyze again."
        : "Draft ready. Reattach the original media if needed, then analyze again.",
    );
  };
  const openSchedule = (r: AnalysisRecord) => {
    setActionError("");
    setScheduleRecord(r);
  };
  const openTrack = (r: AnalysisRecord) => {
    setActionError("");
    setTrackRecord(r);
  };
  const unschedule = async (r: AnalysisRecord) => {
    try {
      updateRecord(
        await api.update(r.id, { scheduledAt: null, status: "analyzed" }),
      );
      notify("Removed from your publishing plan.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not update your plan.");
    }
  };
  const deleteAnalysis = async () => {
    if (!deleteRecord) return;
    setActionBusy(true);
    setActionError("");
    try {
      await api.remove(deleteRecord.id);
      setRecords((old) => old.filter((r) => r.id !== deleteRecord.id));
      if (record?.id === deleteRecord.id) setRecord(null);
      if (viewRecord?.id === deleteRecord.id) setViewRecord(null);
      setDeleteRecord(null);
      notify("Report deleted.");
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not delete report.",
      );
    } finally {
      setActionBusy(false);
    }
  };
  const submitSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scheduleRecord) return;
    setActionBusy(true);
    setActionError("");
    try {
      const data = new FormData(event.currentTarget);
      const iso = zonedDateTimeToIso(
        String(data.get("date")),
        preferences.timezone,
      );
      if (new Date(iso) <= new Date())
        throw new Error("Choose a time in the future.");
      updateRecord(
        await api.update(scheduleRecord.id, {
          scheduledAt: iso,
          status: "scheduled",
        }),
      );
      setScheduleRecord(null);
      notify(
        "Added to your publishing plan. Export the calendar for a reminder.",
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not schedule content.",
      );
    } finally {
      setActionBusy(false);
    }
  };
  const submitOutcomes = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trackRecord) return;
    setActionBusy(true);
    setActionError("");
    try {
      const data = new FormData(event.currentTarget);
      const outcomes = Object.fromEntries(
        ["views", "likes", "comments", "shares", "saves"].map((k) => [
          k,
          Number(data.get(k)),
        ]),
      );
      updateRecord(
        await api.update(trackRecord.id, { outcomes, status: "published" }),
      );
      setTrackRecord(null);
      notify("Results saved. Keep comparing similar posts over time.");
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not save results.",
      );
    } finally {
      setActionBusy(false);
    }
  };
  const savePreferences = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: Preferences = {
      name: String(form.get("name")).trim() || "Creator",
      timezone: String(form.get("timezone")),
      platform: String(form.get("platform")) as Platform,
      goal: String(form.get("goal")) as Goal,
    };
    try {
      localStorage.setItem("viralify.preferences", JSON.stringify(next));
      setPreferences(next);
      setSettingsOpen(false);
      notify("Workspace preferences saved.");
    } catch {
      notify(
        "Your browser could not save preferences. Check available storage.",
      );
    }
  };
  const pageTitle = navItems.find((n) => n.id === page)!.label;
  return (
    <div className="app-shell">
      <div
        className={`sidebar-scrim ${menuOpen ? "visible" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <button
          className="brand"
          onClick={() => navigate("analyzer")}
          aria-label="Viralify home"
        >
          <Logo />
          <span>
            viralify<span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-switch">
          <span className="workspace-icon">
            <Layers3 size={17} />
          </span>
          <span>
            <strong>Creator workspace</strong>
            <small>Your space to grow</small>
          </span>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={`nav-item ${page === id ? "active" : ""}`}
              aria-current={page === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "library" && records.length > 0 && (
                <span className="nav-count">{records.length}</span>
              )}
              {page === id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-grow" />
        <div className="sidebar-note">
          <span className="note-sparkles">✳</span>
          <h4>Your ideas have potential.</h4>
          <p>
            Let’s help them find
            <br />
            their people.
          </p>
          <button onClick={() => setGuideOpen(true)}>
            A quick look around
            <ArrowUpRight size={15} />
          </button>
          <span className="note-orbit" />
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={18} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => setGuideOpen(true)}>
            <CircleHelp size={18} />
            <span>How Viralify works</span>
            <ArrowUpRight size={14} />
          </button>
          <button className="profile" onClick={() => setSettingsOpen(true)}>
            <span className="avatar">
              {preferences.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{preferences.name}</strong>
              <small>Personal workspace</small>
            </span>
            <ChevronRight size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <ChevronRight size={13} />
            <span>{pageTitle}</span>
          </div>
          <div>
            <button
              className="connection-pill"
              onClick={() => setSettingsOpen(true)}
            >
              <i className={connectionError ? "offline" : ""} />
              {capabilities?.aiEnabled
                ? "AI connected"
                : connectionError
                  ? "Connection issue"
                  : capabilities?.storageMode === "browser"
                    ? "Private browser library"
                    : "Local workspace"}
            </button>
            <span className="header-divider" />
            <button
              className="icon-button"
              title="Quick guide"
              aria-label="Open quick guide"
              onClick={() => setGuideOpen(true)}
            >
              <BookOpen size={18} />
            </button>
            <button
              className="avatar avatar-small"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open profile settings"
            >
              {preferences.name.slice(0, 2).toUpperCase()}
            </button>
          </div>
        </header>
        <main>
          {connectionError && (
            <div className="connection-error" role="alert">
              <Info size={18} />
              <span>
                {connectionError} Make sure the Viralify server is available,
                then try again.
              </span>
              <button className="text-link" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {page === "analyzer" && (
            <>
              <div className="page-title">
                <div>
                  <div className="eyebrow">
                    A LITTLE INSIGHT. A LOT MORE POSSIBILITY.
                  </div>
                  <h1>
                    Make your next post count
                    <span className="title-dot">.</span>
                  </h1>
                  <p>
                    Bring your idea. Find your edge. Create with a little more
                    confidence.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setGuideOpen(true)}
                >
                  <CircleHelp size={16} />
                  How it works
                </button>
              </div>
              <section className="hero-banner">
                <div className="hero-copy">
                  <span className="hero-kicker">
                    <span />
                    GOOD IDEAS DESERVE TO BE SEEN
                  </span>
                  <h2>
                    You create the content.
                    <br />
                    We help it go further.
                  </h2>
                  <p>Turn your next “what if” into something worth sharing.</p>
                  <button onClick={useExample} disabled={busy}>
                    Try an example
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-orbit orbit-one" />
                  <div className="art-orbit orbit-two" />
                  <span className="art-spark spark-one">✳</span>
                  <span className="art-spark spark-two">✧</span>
                  <div className="floating-label">
                    <span className="label-dot" />
                    Made for your next big idea
                  </div>
                  <div className="art-card card-back">
                    <div className="mini-card-top">
                      <span className="mini-avatar" />
                      <span className="mini-line" />
                    </div>
                    <div className="abstract-photo">
                      <div className="photo-sun" />
                      <div className="photo-hill hill-one" />
                      <div className="photo-hill hill-two" />
                      <div className="photo-grain" />
                    </div>
                    <span className="mini-line bottom-line" />
                  </div>
                  <div className="art-card card-front">
                    <span className="mini-eyebrow">A LITTLE MOMENTUM</span>
                    <div className="art-chart">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <div className="mini-card-footer">
                      <span>Something good is growing.</span>
                      <TrendingUp size={17} />
                    </div>
                  </div>
                  <div className="floating-spark">
                    <Sparkles size={21} />
                  </div>
                </div>
              </section>
              <div className="analyzer-layout">
                <form
                  className="panel analyzer-form"
                  ref={formRef}
                  onSubmit={analyze}
                >
                  <div className="section-heading">
                    <div>
                      <h2>What are you working on?</h2>
                      <p>Give your content a fresh pair of eyes.</p>
                    </div>
                    <span className="step-label">01 / CREATE</span>
                  </div>
                  <div
                    className="content-type-tabs"
                    role="tablist"
                    aria-label="Content type"
                  >
                    {contentTypes.map(({ id, label, Icon }) => (
                      <button
                        type="button"
                        key={id}
                        disabled={busy}
                        role="tab"
                        aria-selected={type === id}
                        className={type === id ? "active" : ""}
                        onClick={() => {
                          if (id !== type) {
                            setType(id);
                            setFile(null);
                            setFormError("");
                          }
                        }}
                      >
                        <Icon size={17} />
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="field-label" htmlFor="content-title">
                    Give it a name<span>Optional</span>
                  </label>
                  <input
                    id="content-title"
                    className="text-input"
                    placeholder="A working title for your next great idea"
                    maxLength={150}
                    value={title}
                    disabled={busy}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  {type !== "text" && (
                    <MediaUpload
                      type={type}
                      file={file}
                      onChange={setFile}
                      disabled={busy}
                      maxUploadMb={capabilities?.maxUploadMb}
                      maxUploadBytes={capabilities?.maxUploadBytes}
                    />
                  )}
                  <div className="field-label">
                    <label htmlFor="content-text">
                      {type === "text"
                        ? "Your content"
                        : type === "image"
                          ? "Caption or context"
                          : "Caption, transcript, or context"}
                    </label>
                    <span>
                      {type === "text" ? "" : "Optional, but helpful"}
                    </span>
                    {type === "text" && (
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy}
                        onClick={useExample}
                      >
                        <Sparkles size={12} />
                        Load an example
                      </button>
                    )}
                  </div>
                  <div className="editor-wrap">
                    <textarea
                      id="content-text"
                      placeholder={
                        type === "text"
                          ? "Your next great post starts here…\n\nPaste a caption, script, thread, or the idea you can’t stop thinking about."
                          : type === "image"
                            ? "What’s the story behind this image? Add your caption or describe what you want your audience to take away."
                            : "Add a caption or transcript to help assess your message. With AI enabled, we can transcribe speech from your file."
                      }
                      maxLength={30000}
                      value={text}
                      disabled={busy}
                      onChange={(e) => setText(e.target.value)}
                    />
                    <div className="editor-footer">
                      <span>
                        <ShieldCheck size={13} />
                        {capabilities?.aiEnabled
                          ? "AI-assisted analysis enabled"
                          : capabilities?.storageMode === "browser"
                            ? "Private library · content sent for analysis"
                            : "Analyzed in your local workspace"}
                      </span>
                      <span>{text.length.toLocaleString()} / 30,000</span>
                    </div>
                  </div>
                  <div className="form-section-divider" />
                  <label className="field-label">Where will it live?</label>
                  <div
                    className="platform-options"
                    role="group"
                    aria-label="Target platform"
                  >
                    {platforms.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={busy}
                        aria-pressed={platform === p.id}
                        className={platform === p.id ? "selected" : ""}
                        onClick={() => setPlatform(p.id)}
                      >
                        <PlatformIcon platform={p.id} size={15} />
                        <span>{p.label}</span>
                        {platform === p.id && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                  <div className="two-fields">
                    <div>
                      <label className="field-label" htmlFor="goal">
                        Your goal
                      </label>
                      <div className="input-icon-wrap">
                        <Target size={15} />
                        <select
                          id="goal"
                          value={goal}
                          disabled={busy}
                          onChange={(e) => setGoal(e.target.value as Goal)}
                        >
                          {goals.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="audience">
                        Who’s it for?<span>Optional</span>
                      </label>
                      <input
                        id="audience"
                        className="text-input"
                        value={audience}
                        disabled={busy}
                        maxLength={300}
                        onChange={(e) => setAudience(e.target.value)}
                        placeholder="e.g. food lovers, new founders"
                      />
                    </div>
                  </div>
                  <div className="timezone-row">
                    <Globe2 size={14} />
                    <span>
                      Audience timezone:{" "}
                      <strong>{preferences.timezone.replace(/_/g, " ")}</strong>
                    </span>
                    <button
                      className="text-link"
                      type="button"
                      disabled={busy}
                      onClick={() => setSettingsOpen(true)}
                    >
                      Change
                    </button>
                  </div>
                  {formError && (
                    <p className="form-error" role="alert">
                      <Info size={16} />
                      {formError}
                    </p>
                  )}
                  <button
                    className="button primary analyze-button"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle className="spinning" size={19} />
                        {type === "text"
                          ? "Assessing your content…"
                          : "Processing and assessing your media…"}
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} />
                        Analyze my content
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  <p className="analyze-note">
                    {busy
                      ? "Media processing can take a moment. You can leave this tab open."
                      : capabilities?.aiEnabled
                        ? "Your content is sent to OpenAI for AI-assisted analysis."
                        : "No API key needed. Clear signals, actionable next steps."}
                  </p>
                </form>
                <div className="analyzer-side">
                  <EmptyInsights />
                  <div className="formats-note">
                    <span className="round-icon">
                      <Layers3 size={17} />
                    </span>
                    <div>
                      <strong>Every format. One workspace.</strong>
                      <p>
                        From a single sentence to your next video.
                        <br />
                        There’s room for every kind of creator.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              {record && (
                <div ref={resultRef} className="result-anchor">
                  <Results
                    record={record}
                    previousScore={previousScore}
                    onOptimize={(draft) => revise(record, draft)}
                    onSchedule={() => openSchedule(record)}
                    notify={notify}
                  />
                </div>
              )}
              <div className="page-footnote">
                <ShieldCheck size={14} />
                Your ideas stay yours.<span>·</span>Content quality is a signal.
                Virality is never guaranteed.
              </div>
            </>
          )}
          {page === "library" && (
            <Library
              records={records}
              onOpen={setViewRecord}
              onNew={newAnalysis}
              onDelete={(r) => {
                setActionError("");
                setDeleteRecord(r);
              }}
              onSchedule={openSchedule}
              onDuplicate={(r) => revise(r)}
              storageMode={capabilities?.storageMode}
            />
          )}
          {page === "planner" && (
            <Planner
              records={records}
              timezone={preferences.timezone}
              onOpen={setViewRecord}
              onNew={newAnalysis}
              onSchedule={openSchedule}
              onTrack={openTrack}
              onUnschedule={(r) => void unschedule(r)}
            />
          )}
          {page === "learn" && (
            <Learn records={records} onTrack={openTrack} onNew={newAnalysis} />
          )}
          <footer className="main-footer">
            <span>
              <Logo small />
              Thoughtful content. Meaningful connections.
            </span>
            <span>Made for the creative process.</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {settingsOpen && (
        <Modal
          title="Make yourself at home."
          description="A few details to personalize your creative workspace."
          onClose={() => setSettingsOpen(false)}
        >
          <form onSubmit={savePreferences}>
            <label className="field-label" htmlFor="profile-name">
              Your name
            </label>
            <input
              className="text-input"
              id="profile-name"
              name="name"
              maxLength={40}
              defaultValue={preferences.name}
            />
            <label className="field-label" htmlFor="profile-timezone">
              Audience timezone
            </label>
            <select
              id="profile-timezone"
              name="timezone"
              defaultValue={preferences.timezone}
            >
              {Array.from(new Set([...timezones, preferences.timezone])).map(
                (t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ),
              )}
            </select>
            <p className="field-help">
              Publishing suggestions and your planner use this timezone.
            </p>
            <div className="two-fields">
              <div>
                <label className="field-label" htmlFor="profile-platform">
                  Default platform
                </label>
                <select
                  name="platform"
                  id="profile-platform"
                  defaultValue={preferences.platform}
                >
                  {platforms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="profile-goal">
                  Default goal
                </label>
                <select
                  name="goal"
                  id="profile-goal"
                  defaultValue={preferences.goal}
                >
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="connection-settings">
              <div>
                <span className="round-icon">
                  <Sparkles size={18} />
                </span>
                <div>
                  <strong>
                    {capabilities?.aiEnabled
                      ? "AI is connected"
                      : "Content analysis is ready"}
                  </strong>
                  <p>
                    {capabilities?.aiEnabled
                      ? `Model: ${capabilities.model}`
                      : "Content and media signals, without an API key."}
                  </p>
                </div>
                <span className="status-dot" />
              </div>
              {!capabilities?.aiEnabled && (
                <p>
                  For semantic image feedback and speech transcription,
                  configure the server environment. Add{" "}
                  <code>OPENAI_API_KEY</code> to the server environment
                  (locally, use <code>.env</code>) and restart or redeploy. AI
                  analysis sends content to OpenAI; your key stays on the
                  server.
                </p>
              )}
              <div className="capability-list">
                <span>
                  <Check size={13} />
                  Text assessment
                </span>
                <span>
                  <Check size={13} />
                  Image metadata
                </span>
                <span>
                  {capabilities?.mediaEnabled ? (
                    <Check size={13} />
                  ) : (
                    <Info size={13} />
                  )}
                  Audio & video{" "}
                  {capabilities?.mediaEnabled
                    ? "processing"
                    : "processor unavailable"}
                </span>
              </div>
            </div>
            <button className="button primary full-width" type="submit">
              Save preferences
              <Check size={16} />
            </button>
          </form>
        </Modal>
      )}
      {guideOpen && (
        <Modal
          title="A little clarity goes a long way."
          description="Meet your creative feedback loop."
          onClose={() => setGuideOpen(false)}
        >
          <div className="guide-steps">
            {[
              {
                Icon: Upload,
                title: "Bring an idea in any format.",
                text: "Paste text or upload an image, audio, or video file. Choose the platform, audience, and goal.",
              },
              {
                Icon: WandSparkles,
                title: "Find the next useful improvement.",
                text: "Review six content signals, prioritize specific suggestions, and try a revised draft. Local analysis uses observable patterns and media measurements; optional AI adds semantic feedback.",
              },
              {
                Icon: CalendarDays,
                title: "Give it a time and a place.",
                text: "Use suggested time windows as experiments. Save your plan and export a calendar event, then publish directly on your platform.",
              },
              {
                Icon: TrendingUp,
                title: "Learn from what actually happens.",
                text: "Log real views and engagement. Compare similar posts, refine your ideas, and keep the creative loop going.",
              },
            ].map(({ Icon, title, text }, i) => (
              <div key={title}>
                <span className="guide-step-icon">
                  <Icon size={21} />
                </span>
                <div>
                  <small>STEP 0{i + 1}</small>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="evidence-note">
            <Info size={17} />
            <span>
              A readiness score describes content signals. It is not a
              calibrated prediction of viral success. Suggested times are
              hypotheses until you test them against your own audience data.
            </span>
          </div>
          <button
            className="button primary full-width"
            onClick={() => setGuideOpen(false)}
          >
            Let’s make something count
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {viewRecord && !scheduleRecord && !trackRecord && (
        <Modal
          title={viewRecord.input.title || "Your content report"}
          description={`${viewRecord.input.platform} · ${viewRecord.input.type}`}
          wide
          onClose={() => setViewRecord(null)}
        >
          <Results
            record={viewRecord}
            onOptimize={(draft) => revise(viewRecord, draft)}
            onSchedule={() => openSchedule(viewRecord)}
            notify={notify}
          />
          <div className="report-modal-footer">
            <button
              className="button secondary"
              onClick={() => revise(viewRecord)}
            >
              Revise original draft
              <WandSparkles size={15} />
            </button>
            <button
              className="button secondary"
              onClick={() => openTrack(viewRecord)}
            >
              Log published results
              <BarChart3 size={15} />
            </button>
          </div>
        </Modal>
      )}
      {scheduleRecord && (
        <Modal
          title="Give your content a moment."
          description={scheduleRecord.input.title || "Plan your next post"}
          onClose={() => {
            if (!actionBusy) setScheduleRecord(null);
          }}
        >
          <form onSubmit={submitSchedule}>
            <label className="field-label" htmlFor="schedule-date">
              Date & time
            </label>
            <input
              className="text-input"
              type="datetime-local"
              id="schedule-date"
              name="date"
              required
              defaultValue={localDateTime(
                scheduleRecord.scheduledAt
                  ? new Date(scheduleRecord.scheduledAt)
                  : new Date(Date.now() + 86400000),
                preferences.timezone,
              )}
            />
            <p className="field-help">
              <Globe2 size={13} />
              All times in {preferences.timezone.replace(/_/g, " ")}.
            </p>
            <div className="schedule-suggestions">
              <strong>
                Suggested experiments ·{" "}
                {scheduleRecord.result.publishing.timezone.replace(/_/g, " ")}
              </strong>
              {scheduleRecord.result.publishing.slots.map((s, i) => (
                <div key={i}>
                  <Clock3 size={14} />
                  {s.day} · {s.label}
                </div>
              ))}
            </div>
            <div className="evidence-note">
              <Info size={15} />
              <span>
                This adds a planned post to Viralify. Export your calendar for a
                reminder, then publish on{" "}
                {
                  platforms.find((p) => p.id === scheduleRecord.input.platform)
                    ?.label
                }{" "}
                yourself.
              </span>
            </div>
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <button
              className="button primary full-width"
              type="submit"
              disabled={actionBusy}
            >
              {actionBusy ? (
                <LoaderCircle size={17} className="spinning" />
              ) : (
                <CalendarDays size={17} />
              )}
              Save to publishing plan
            </button>
          </form>
        </Modal>
      )}
      {trackRecord && (
        <Modal
          title="How did your content do?"
          description={trackRecord.input.title || "Record your post results"}
          onClose={() => {
            if (!actionBusy) setTrackRecord(null);
          }}
        >
          <form onSubmit={submitOutcomes}>
            <p className="modal-copy">
              Enter results from your platform analytics. Use the same time
              after publishing for each post to make comparisons useful.
            </p>
            <div className="outcome-fields">
              {["views", "likes", "comments", "shares", "saves"].map((k) => (
                <div key={k}>
                  <label className="field-label" htmlFor={`outcome-${k}`}>
                    {k.charAt(0).toUpperCase() + k.slice(1)}
                  </label>
                  <input
                    className="text-input"
                    id={`outcome-${k}`}
                    name={k}
                    type="number"
                    min="0"
                    max="10000000000"
                    step="1"
                    required
                    defaultValue={
                      trackRecord.outcomes?.[
                        k as keyof NonNullable<AnalysisRecord["outcomes"]>
                      ] ?? 0
                    }
                  />
                </div>
              ))}
            </div>
            <p className="field-help">
              Saving results marks this content as published.
            </p>
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <button
              className="button primary full-width"
              type="submit"
              disabled={actionBusy}
            >
              {actionBusy ? (
                <LoaderCircle size={17} className="spinning" />
              ) : (
                <Check size={17} />
              )}
              Save results
            </button>
          </form>
        </Modal>
      )}
      {deleteRecord && (
        <Modal
          title="Delete this report?"
          description={deleteRecord.input.title || "Untitled content"}
          onClose={() => {
            if (!actionBusy) setDeleteRecord(null);
          }}
        >
          <p className="modal-copy">
            This removes the saved analysis, publishing plan, and any recorded
            results for this item.
          </p>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={actionBusy}
              onClick={() => setDeleteRecord(null)}
            >
              Keep report
            </button>
            <button
              className="button danger"
              disabled={actionBusy}
              onClick={() => void deleteAnalysis()}
            >
              {actionBusy ? "Deleting…" : "Delete report"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
