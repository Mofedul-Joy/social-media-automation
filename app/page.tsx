"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Loader2,
  ArrowLeft,
  Radio,
  Sparkles,
  Check,
  RotateCcw,
  UserRound,
  PenLine,
  Bookmark,
  BarChart3,
} from "lucide-react";
import type { BusinessContext, Platform, ScrapedPost } from "@/lib/types";
import { CATEGORY_BUYER, CATEGORY_GENERAL } from "@/lib/types";
// Type-only, and `import type` is erased before bundling — lib/topics.ts and
// lib/savedPosts.ts hold the service-role Supabase client and must never reach
// the browser.
import type { SearchTopic } from "@/lib/topics";
import type { SavedPost } from "@/lib/savedPosts";
import { splitDescription, joinDescription } from "@/lib/businessNarrative";
import { toCsv, downloadCsv, csvFilename } from "@/lib/csv";
import { decodeEntities } from "@/lib/text";
import { PlatformIcon, PLATFORM_COLOR } from "./components/PlatformIcon";
import { InfoTip } from "./components/InfoTip";
import { PostRow } from "./components/PostRow";
import { ResultsSidebar, type SidebarFilters } from "./components/ResultsSidebar";
import { NotificationBell } from "./components/NotificationBell";

/** One shared look for every text control on this page, so the context inputs and the search box read as one family. */
const FIELD_CLASS =
  "w-full text-[15px] leading-relaxed rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] " +
  "focus:border-[color:var(--primary)] focus:shadow-[0_0_0_3px_rgba(225,29,72,0.28)] outline-none px-4 py-3 text-[color:var(--text)] " +
  "placeholder:text-[color:var(--faint)] [color-scheme:dark]";

function Field({ id, label, tip, children }: { id: string; label: string; tip: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="relative flex items-center gap-2 mb-2">
        <label htmlFor={id} className="text-[15px] font-semibold whitespace-nowrap">
          {label}
        </label>
        <InfoTip text={tip} />
      </div>
      {children}
    </div>
  );
}

/** Short enough to sit at the end of a one-line list row without wrapping it. */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = ms / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Fixed order for the platform filters, so ticking one never reshuffles the
 * list under the cursor. Only the platforms actually present are rendered.
 */
const PLATFORM_ORDER: Platform[] = [
  "reddit",
  "facebook",
  "instagram",
  "threads",
  "hackernews",
  "stackexchange",
];

/** Same idea for the type filters: the two discovery buckets, always this way round. */
const CATEGORY_ORDER = [CATEGORY_BUYER, CATEGORY_GENERAL];

/**
 * A saved link with no matching live result, dressed as a post so the one row
 * component renders it. `saved_posts` stores the address and nothing else
 * (issue 05), so `body` is genuinely empty and the row is marked `linkOnly` —
 * it says the text was never stored rather than showing a blank post.
 */
function savedAsPost(s: SavedPost): ScrapedPost {
  return {
    platform: s.platform as Platform,
    external_id: s.url,
    url: s.url,
    author: s.author ?? undefined,
    title: s.title ?? undefined,
    body: "",
    scraped_at: s.saved_at,
  };
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [view, setView] = useState<"input" | "results">("input");
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState<ScrapedPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ctx, setCtx] = useState<BusinessContext | null>(null);

  // --- the three context inputs -------------------------------------------
  // `company` is BusinessContext.business_name; `about` and `purpose` are the
  // two halves of BusinessContext.description (see lib/businessNarrative.ts).
  const [company, setCompany] = useState("");
  const [about, setAbout] = useState("");
  const [purpose, setPurpose] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ctxUnavailable, setCtxUnavailable] = useState(false);

  const [topics, setTopics] = useState<SearchTopic[]>([]);

  // --- saved links + sidebar filters (issues 05, 06) ------------------------
  const [saved, setSaved] = useState<SavedPost[]>([]);
  /** True once the store has answered that it cannot be reached. Hides the Saved filter. */
  const [savedUnavailable, setSavedUnavailable] = useState(false);
  const [filters, setFilters] = useState<SidebarFilters>({
    platforms: [],
    categories: [],
    savedOnly: false,
  });

  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const loaded = (d.context ?? null) as BusinessContext | null;
        setCtx(loaded);
        if (!loaded) {
          setCtxUnavailable(true);
          return;
        }
        const parts = splitDescription(loaded.description);
        setCompany(loaded.business_name ?? "");
        setAbout(parts.about);
        setPurpose(parts.purpose);
      })
      .catch(() => setCtxUnavailable(true));
  }, []);

  // Separate request from /api/config on purpose: the saved-topic list is a
  // convenience, and it must not be able to stop the context inputs loading.
  useEffect(() => {
    refreshTopics();
  }, []);

  /**
   * The saved links, loaded once. `/api/saved` answers 200 with
   * `unavailable: true` when the store is unreachable rather than an error
   * status, so a missing `saved_posts` table costs the Saved filter and
   * nothing else — searching, filtering and exporting all still work.
   */
  useEffect(() => {
    fetch("/api/saved")
      .then((r) => r.json())
      .then((d) => {
        setSaved((d.saved ?? []) as SavedPost[]);
        setSavedUnavailable(d.unavailable === true);
      })
      .catch(() => setSavedUnavailable(true));
  }, []);

  const enabledPlatforms = (Object.entries(ctx?.platforms ?? {}) as [Platform, { enabled: boolean }][])
    .filter(([, c]) => c.enabled)
    .map(([p]) => p);
  const suggestions = (ctx?.keywords ?? []).slice(0, 6);

  // What is currently in Supabase, re-derived the same way it was read in, so
  // "unsaved changes" means a real difference and not a formatting artefact.
  const savedParts = ctx ? splitDescription(ctx.description) : null;
  const dirty =
    !!ctx &&
    !!savedParts &&
    (company.trim() !== (ctx.business_name ?? "").trim() ||
      about.trim() !== savedParts.about ||
      purpose.trim() !== savedParts.purpose);

  /**
   * Server truth, and the only thing allowed to decide what the list shows for
   * good. An unreachable `search_topics` answers with an empty list, and that
   * empty list stands: the alternative is leaving an optimistic row on screen
   * under a heading that claims it was saved when nothing was written.
   */
  function refreshTopics() {
    fetch("/api/topics")
      .then((r) => r.json())
      .then((d) => setTopics((d.topics ?? []) as SearchTopic[]))
      .catch(() => {});
  }

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }

  async function saveContext() {
    if (!ctx || !dirty) return;
    setSaveState("saving");
    setSaveError(null);
    // The whole context object goes back, not just the three fields:
    // /api/config replaces the row wholesale, so posting a partial object
    // would silently wipe keywords, platforms and tone.
    const next: BusinessContext = {
      ...ctx,
      business_name: company.trim(),
      description: joinDescription(about, purpose),
    };
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setSaveError(data.error ?? `Could not save (${res.status}). Nothing was changed.`);
        setSaveState("error");
        return;
      }
      // Only now: until the store has it, the form is still dirty.
      setCtx(next);
      // Show back exactly what was stored. Saving trims, and may indent a line
      // that collides with a section label (lib/businessNarrative.ts), so
      // leaving the raw typed text in the boxes would leave the form reading
      // "Unsaved changes" forever against a save that in fact succeeded.
      const stored = splitDescription(next.description);
      setCompany(next.business_name);
      setAbout(stored.about);
      setPurpose(stored.purpose);
      setSaveState("saved");
      window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2800);
    } catch {
      setSaveError("Could not reach the server. Nothing was changed.");
      setSaveState("error");
    }
  }

  // --- saved links ---------------------------------------------------------
  const savedUrls = useMemo(() => new Set(saved.map((s) => s.url)), [saved]);

  /**
   * The page owns saved state so the bookmark on a row and the count in the
   * sidebar are the same fact. Returns the message to show in the row on
   * failure, null on success — the row never assumes a click worked.
   */
  async function toggleSave(post: ScrapedPost): Promise<string | null> {
    const isSaved = savedUrls.has(post.url);
    try {
      if (isSaved) {
        const res = await fetch(`/api/saved?url=${encodeURIComponent(post.url)}`, { method: "DELETE" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.ok === false) {
          return d.error ?? `Could not unsave (${res.status}). Nothing was removed.`;
        }
        setSaved((prev) => prev.filter((s) => s.url !== post.url));
        return null;
      }
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: post.platform,
          url: post.url,
          title: post.title ?? null,
          author: post.author ?? null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.ok === false) {
        return d.error ?? `Could not save (${res.status}). Nothing was saved.`;
      }
      // Re-saving upserts on url server-side, so filtering the old entry out
      // keeps that a no-op here too rather than a second row in the list.
      setSaved((prev) => [d.saved as SavedPost, ...prev.filter((s) => s.url !== post.url)]);
      setSavedUnavailable(false);
      return null;
    } catch {
      return isSaved
        ? "Could not reach the server. Nothing was removed."
        : "Could not reach the server. Nothing was saved.";
    }
  }

  /**
   * Generating a comment is the only time a human reads a post, so the AI's
   * own label replaces the regex bucket on the post itself — otherwise the
   * chip on the row and the count in the sidebar would disagree about it.
   */
  function applyCategory(url: string, category: string) {
    setPosts((prev) => prev.map((p) => (p.url === url ? { ...p, category } : p)));
  }

  // --- what the stack shows ------------------------------------------------
  /**
   * Saved off, the pool is the live results. Saved on, it is the saved library
   * instead, with the live result merged in wherever one matches — that is what
   * makes a link saved during an earlier search still reachable, which is the
   * entire point of persisting it. An entry with no live match has no body to
   * show and is marked `linkOnly`.
   */
  const pool = useMemo(() => {
    if (!filters.savedOnly) {
      return posts.map((p) => ({ post: p, linkOnly: false, savedAt: null as string | null }));
    }
    const live = new Map(posts.map((p) => [p.url, p]));
    return saved.map((s) => {
      const match = live.get(s.url);
      return match
        ? { post: match, linkOnly: false, savedAt: s.saved_at }
        : { post: savedAsPost(s), linkOnly: true, savedAt: s.saved_at };
    });
  }, [filters.savedOnly, posts, saved]);

  // AND logic across the three dimensions (issue 06). A link-only saved entry
  // carries no category, so it correctly matches no category filter.
  const okPlatform = (p: ScrapedPost) =>
    filters.platforms.length === 0 || filters.platforms.includes(p.platform);
  const okCategory = (p: ScrapedPost) =>
    filters.categories.length === 0 || (!!p.category && filters.categories.includes(p.category));

  const visible = pool.filter((r) => okPlatform(r.post) && okCategory(r.post));

  /**
   * Counts are computed here, against rows the page already holds — no extra
   * API call (issue 06). Each dimension counts with the OTHER filters applied
   * but not its own, so a platform's number answers "how many would I get if I
   * ticked this", not "how many are showing".
   */
  const platformCounts = PLATFORM_ORDER.filter(
    (p) => pool.some((r) => r.post.platform === p) || filters.platforms.includes(p),
  ).map((platform) => ({
    platform,
    count: pool.filter((r) => r.post.platform === platform && okCategory(r.post)).length,
  }));

  const categoryCounts = CATEGORY_ORDER.concat(
    // Anything the AI named that is not one of the two discovery buckets.
    Array.from(new Set(pool.map((r) => r.post.category).filter((c): c is string => !!c))).filter(
      (c) => !CATEGORY_ORDER.includes(c),
    ),
  )
    .filter((c) => pool.some((r) => r.post.category === c) || filters.categories.includes(c))
    .map((category) => ({
      category,
      count: pool.filter((r) => r.post.category === category && okPlatform(r.post)).length,
    }));

  /**
   * What ticking Saved would show, counted the same way. Null hides the filter
   * outright, which is what an unreachable store gets.
   */
  const savedCount = savedUnavailable
    ? null
    : (() => {
        const live = new Map(posts.map((p) => [p.url, p]));
        return saved
          .map((s) => live.get(s.url) ?? savedAsPost(s))
          .filter((p) => okPlatform(p) && okCategory(p)).length;
      })();

  /** Exports exactly the rows on screen, with that view's visible columns (issue 09). */
  function exportCsv() {
    const headers = [
      "Platform",
      "Type",
      "Author",
      "Title",
      "Posted at",
      "URL",
      "Reply to",
      ...(filters.savedOnly ? ["Saved at"] : []),
      "Body",
    ];
    const rows = visible.map((r) => [
      r.post.platform,
      r.post.category ?? "",
      decodeEntities(r.post.author ?? ""),
      decodeEntities(r.post.title ?? ""),
      r.post.posted_at ?? "",
      r.post.url,
      r.post.parent_url ?? "",
      ...(filters.savedOnly ? [r.savedAt ?? ""] : []),
      r.linkOnly ? "" : decodeEntities(r.post.body),
    ]);
    downloadCsv(csvFilename(filters.savedOnly ? "saved" : topic), toCsv(headers, rows));
  }

  const canSearch = topic.trim().length > 0 && !loading;

  /**
   * Takes the topic explicitly so a saved-topic row can run its own text
   * immediately, instead of setting state and racing the re-render for it.
   */
  async function search(raw?: string) {
    const q = (raw ?? topic).trim();
    if (!q || loading) return;
    setTopic(q);
    setLoading(true);
    setView("results");
    setPosts([]);
    setError(null);
    // A filter left over from the last topic would silently hide the new
    // results, and the empty state would blame the search for it.
    setFilters({ platforms: [], categories: [], savedOnly: false });
    // Optimistic only so the row is there the instant you come back from the
    // results, never as the final word: the write really happens server-side
    // inside /api/topic-search, and refreshTopics() below replaces this guess
    // with what was actually stored.
    setTopics((prev) => {
      const existing = prev.find((t) => t.topic === q);
      return [
        { topic: q, last_used_at: new Date().toISOString(), use_count: (existing?.use_count ?? 0) + 1 },
        ...prev.filter((t) => t.topic !== q),
      ];
    });
    try {
      const res = await fetch("/api/topic-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: q }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "search failed");
      else setPosts(data.posts ?? []);
    } catch {
      setError("Something went wrong fetching posts.");
    } finally {
      setLoading(false);
      // The search route records the topic before it fetches anything, so by
      // now the row either exists or the write failed — either way this is the
      // first moment the list can be told the truth.
      refreshTopics();
    }
  }

  return (
    // The results view needs the width: a row is a readable post body plus a
    // fixed Control Center, and at max-w-6xl the body column is narrower than
    // the card grid it replaced. The input view keeps its original measure.
    <main
      className={
        "relative z-10 mx-auto px-5 sm:px-8 py-10 " +
        (view === "results" ? "max-w-[1400px]" : "max-w-6xl")
      }
    >
      {/* top brand */}
      <header className="flex items-center justify-between mb-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl grid place-items-center btn-primary">
            <Radio className="w-[18px] h-[18px]" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-bold tracking-tight">Pulse</div>
            <div className="text-[11px] text-[color:var(--faint)] -mt-0.5">Engagement Studio</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/*
            Saved links are reachable from the sidebar, but only once a search
            has been run — and after a reload there is no search. Without this
            the one thing persisting them is for would need a search first.
          */}
          {!savedUnavailable && (
            <button
              onClick={() => {
                setFilters({ platforms: [], categories: [], savedOnly: true });
                setView("results");
              }}
              className="btn inline-flex items-center gap-2 text-sm font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] glass rounded-full px-4 py-2"
            >
              <Bookmark className="w-4 h-4" strokeWidth={2.2} />
              Saved
              <span className="tabular-nums text-[color:var(--text)]">{saved.length}</span>
            </button>
          )}
          {/*
            New replies on the posts above. Checks when this page opens and
            when Hon presses refresh inside it — never on a schedule, because
            each check spends a Facebook credit per saved Facebook post.
          */}
          <NotificationBell />
          <a
            href="/analytics"
            className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] glass rounded-full px-4 py-2 transition-colors"
          >
            <BarChart3 className="w-4 h-4" strokeWidth={2.2} />
            Counts
          </a>
          <a
            href="/compose"
            className="inline-flex items-center gap-2 text-sm font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] glass rounded-full px-4 py-2 transition-colors"
          >
            <PenLine className="w-4 h-4" strokeWidth={2.2} />
            Compose
          </a>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {view === "input" ? (
          <motion.section
            key="input"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
          >
            {/* hero */}
            <div className="max-w-2xl mb-10">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-[color:var(--muted)] glass rounded-full px-3 py-1.5 mb-5">
                <Sparkles className="w-3.5 h-3.5 text-[color:var(--primary-2)]" />
                Find real posts, draft a comment, engage yourself
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05] mb-4">
                Turn trending posts into <span className="gradient-text">real conversations</span>.
              </h1>
              <p className="text-[color:var(--muted)] text-base sm:text-lg leading-relaxed">
                Type a topic. Pulse finds the most recent matching posts across your configured
                sources, then drafts a comment only for the ones you choose — no auto-poster, you
                paste it yourself.
              </p>
            </div>

            {/* input card */}
            <div className="glass rounded-3xl p-6 sm:p-8 max-w-3xl">
              <label className="block text-[15px] font-semibold mb-2" htmlFor="topic">Search phrase or topic</label>
              <p className="text-[13px] text-[color:var(--muted)] mb-3">
                One AI call is spent only when you click Generate comment on a specific post, not on every search.
              </p>
              <div className="flex gap-2 mb-4 flex-wrap">
                <input
                  id="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                  placeholder="e.g. people deciding between two tools, or complaining about a problem you solve"
                  className={FIELD_CLASS + " flex-1 min-w-[240px]"}
                />
              </div>
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-7">
                  <span className="text-xs text-[color:var(--muted)] py-1">Try:</span>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => setTopic(s)}
                      className="btn text-xs text-[color:var(--muted)] hover:text-[color:var(--text)] rounded-md px-2 py-1 border border-[color:var(--border)] hover:border-[color:var(--border-strong)]"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              )}

              {enabledPlatforms.length > 0 && (
                <div className="flex items-center gap-2 mb-6 flex-wrap">
                  <span className="text-xs text-[color:var(--muted)]">Searching:</span>
                  {enabledPlatforms.map((p) => (
                    <span
                      key={p}
                      className="w-6 h-6 rounded-lg grid place-items-center"
                      style={{ background: `${PLATFORM_COLOR[p]}1f`, color: PLATFORM_COLOR[p] }}
                      title={p}
                    >
                      <PlatformIcon platform={p} className="w-3.5 h-3.5" />
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() => search()}
                disabled={!canSearch}
                className="btn btn-primary w-full py-3.5 rounded-2xl font-semibold text-[15px] inline-flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                Find recent posts
              </button>

              {/* saved topics — every topic ever searched, newest first, uncapped */}
              {topics.length > 0 && (
                <div className="mt-7 pt-6 border-t border-[color:var(--border)]">
                  <div className="flex items-baseline justify-between gap-3 mb-3">
                    <h2 className="text-[15px] font-semibold">Your past searches</h2>
                    <span className="text-xs text-[color:var(--muted)]">
                      {topics.length} saved · click to run again
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
                    {topics.map((t) => (
                      <li key={t.topic}>
                        <button
                          onClick={() => search(t.topic)}
                          disabled={loading}
                          className="btn w-full text-left flex items-center gap-3 rounded-xl px-3 py-2.5 border border-transparent hover:border-[color:var(--border-strong)] hover:bg-[rgba(255,255,255,0.06)]"
                        >
                          <RotateCcw className="w-4 h-4 shrink-0 text-[color:var(--muted)]" />
                          <span className="flex-1 min-w-0 truncate text-[15px] text-[color:var(--text)]">
                            {t.topic}
                          </span>
                          {t.use_count > 1 && (
                            <span className="shrink-0 text-xs font-medium text-[color:var(--muted)] rounded-md px-1.5 py-0.5 bg-[rgba(255,255,255,0.08)]">
                              ×{t.use_count}
                            </span>
                          )}
                          <span className="shrink-0 text-xs text-[color:var(--muted)] whitespace-nowrap">
                            {ago(t.last_used_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* context card — filled once, used by every search */}
            <section className="glass rounded-3xl p-6 sm:p-8 max-w-3xl mt-6">
              <div className="flex items-center gap-2 mb-1.5">
                <UserRound className="w-[18px] h-[18px] text-[color:var(--primary-2)]" strokeWidth={2.2} />
                <h2 className="text-lg font-semibold tracking-tight">Your context</h2>
              </div>
              <p className="text-[15px] text-[color:var(--muted)] leading-relaxed mb-6">
                Fill this in once and it sticks. Every search and every drafted comment is written
                from it, so replies sound like you instead of a stranger.
              </p>

              {ctxUnavailable && (
                <p className="text-sm text-[color:var(--red)] mb-5">
                  Your saved context could not be loaded, so it cannot be edited right now. Searching still works.
                </p>
              )}

              <div className="flex flex-col gap-5">
                <Field
                  id="ctx-company"
                  label="Your company"
                  tip="The business name the AI writes on behalf of. It appears nowhere automatically — it just tells the AI whose voice a drafted comment is in."
                >
                  <input
                    id="ctx-company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Northwind Fitness"
                    className={FIELD_CLASS}
                  />
                </Field>

                <Field
                  id="ctx-about"
                  label="Describe yourself"
                  tip="Who you are and what you actually do. This is the main thing the AI uses to judge whether a post is worth replying to, and to keep a drafted comment truthful about you."
                >
                  <textarea
                    id="ctx-about"
                    value={about}
                    onChange={(e) => setAbout(e.target.value)}
                    rows={3}
                    placeholder="e.g. I run a small studio that builds custom home gyms for people short on space."
                    className={FIELD_CLASS + " resize-y"}
                  />
                </Field>

                <Field
                  id="ctx-purpose"
                  label="Why you are using this tool"
                  tip="What a good outcome looks like for you. It steers which conversations count as worth your time and what a drafted comment is trying to achieve."
                >
                  <textarea
                    id="ctx-purpose"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    rows={3}
                    placeholder="e.g. To find people weighing up a home gym and be genuinely useful before they buy."
                    className={FIELD_CLASS + " resize-y"}
                  />
                </Field>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={saveContext}
                  disabled={!ctx || !dirty || saveState === "saving"}
                  className="btn btn-primary rounded-xl px-5 py-3 font-semibold text-[15px] inline-flex items-center gap-2"
                >
                  {saveState === "saving" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" strokeWidth={2.6} />
                  )}
                  Save context
                </button>
                <span className="text-sm" role="status" aria-live="polite">
                  {saveState === "saving" ? (
                    <span className="text-[color:var(--muted)]">Saving…</span>
                  ) : saveState === "saved" ? (
                    <span className="text-[color:var(--green)] font-medium">Saved. Every search uses this now.</span>
                  ) : dirty ? (
                    <span className="text-[color:var(--muted)]">Unsaved changes</span>
                  ) : ctx ? (
                    <span className="text-[color:var(--muted)]">Everything saved</span>
                  ) : null}
                </span>
              </div>

              {saveState === "error" && saveError && (
                <p className="mt-3 text-sm text-[color:var(--red)]">{saveError}</p>
              )}
            </section>
          </motion.section>
        ) : (
          <motion.section
            key="results"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            {/* results header */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 mb-6">
              <button
                onClick={() => setView("input")}
                className="btn inline-flex items-center gap-1.5 text-[15px] font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] self-center"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={2.2} /> New search
              </button>
              <div className="h-4 w-px bg-[color:var(--border-strong)] self-center" />
              <h2 className="text-[17px] font-semibold text-[color:var(--text)]">
                {filters.savedOnly ? "Saved links" : <>Recent posts for “{topic}”</>}
              </h2>
              {!loading && (
                <span className="text-[15px] text-[color:var(--muted)] tabular-nums">
                  {visible.length === pool.length
                    ? `${pool.length} ${pool.length === 1 ? "result" : "results"}`
                    : `${visible.length} of ${pool.length} showing`}
                </span>
              )}
            </div>

            {error && (
              <div className="glass rounded-2xl p-6 mb-4 text-[15px] text-[color:var(--red)]">{error}</div>
            )}

            <div className="flex flex-col lg:flex-row gap-6 items-start">
              <ResultsSidebar
                platformCounts={platformCounts}
                categoryCounts={categoryCounts}
                savedCount={savedCount}
                filters={filters}
                onChange={setFilters}
                onExport={exportCsv}
                exportLabel={`Export ${visible.length} ${visible.length === 1 ? "row" : "rows"} to CSV`}
                exportDisabled={visible.length === 0}
              />

              <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="glass rounded-2xl h-56 skeleton" />
                  ))
                ) : visible.length === 0 ? (
                  <div className="glass rounded-2xl p-12 sm:p-16 text-[color:var(--muted)]">
                    <p className="text-[17px] text-[color:var(--text)] font-semibold mb-2">
                      {pool.length > 0
                        ? "Nothing matches those filters."
                        : filters.savedOnly
                          ? "You have not saved any links yet."
                          : topic
                            ? "No fresh posts on that topic right now."
                            : "Nothing searched yet."}
                    </p>
                    <p className="text-[15px] leading-relaxed">
                      {pool.length > 0
                        ? "Untick a filter on the left, or clear them all."
                        : filters.savedOnly
                          ? "Use Save as link on a result and it will be here next time, from any search."
                          : topic
                            ? "Try a broader phrase, or one that sounds more like how someone would ask for help."
                            : "Start a new search, or tick Saved links only to see what you have kept."}
                    </p>
                  </div>
                ) : (
                  visible.map((r, i) => (
                    <PostRow
                      key={r.post.external_id}
                      post={r.post}
                      index={i}
                      saved={savedUrls.has(r.post.url)}
                      onToggleSave={toggleSave}
                      onAnalyzed={applyCategory}
                      linkOnly={r.linkOnly}
                      savedAgo={r.savedAt ? ago(r.savedAt) : null}
                      onToast={flash}
                    />
                  ))
                )}
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 shadow-2xl"
            role="status"
            aria-live="polite"
          >
            <span className="w-5 h-5 rounded-full grid place-items-center btn-primary">
              <Sparkles className="w-3 h-3" />
            </span>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
