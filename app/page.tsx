"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2, ArrowLeft, Radio, Sparkles, Info, Check, RotateCcw, UserRound } from "lucide-react";
import type { BusinessContext, Platform, ScrapedPost } from "@/lib/types";
// Type-only, and `import type` is erased before bundling — lib/topics.ts holds
// the service-role Supabase client and must never reach the browser.
import type { SearchTopic } from "@/lib/topics";
import { splitDescription, joinDescription } from "@/lib/businessNarrative";
import { PlatformIcon, PLATFORM_COLOR } from "./components/PlatformIcon";
import { PostCard } from "./components/PostCard";

/** One shared look for every text control on this page, so the context inputs and the search box read as one family. */
const FIELD_CLASS =
  "w-full text-[15px] leading-relaxed rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] " +
  "focus:border-[color:var(--primary)] focus:shadow-[0_0_0_3px_rgba(225,29,72,0.28)] outline-none px-4 py-3 text-[color:var(--text)] " +
  "placeholder:text-[color:var(--faint)] [color-scheme:dark]";

/**
 * The "i" beside each context label. The tooltip text is carried by the
 * button's aria-label and the bubble itself is aria-hidden, so a screen reader
 * gets it once rather than twice. It opens on hover AND on keyboard focus
 * (`group-focus-within`), so it is not a mouse-only affordance.
 *
 * Solid `--bg-2` rather than the page's `.glass`: a translucent bubble over a
 * translucent card puts the same hue behind the same hue, which is the one
 * thing this UI must never do.
 */
function InfoTip({ text }: { text: string }) {
  return (
    // Deliberately NOT `relative`: the bubble resolves against the label row
    // instead, so its width is capped at the row's width. Anchored to the
    // 18px icon it would hang off the right edge on a phone and give the whole
    // page a horizontal scrollbar even while invisible.
    <span className="group inline-flex">
      <button
        type="button"
        aria-label={text}
        className="btn relative after:absolute after:content-[''] after:-inset-2.5 w-6 h-6 rounded-full grid place-items-center border border-[color:var(--border-strong)] text-[color:var(--muted)] hover:text-[color:var(--text)] hover:border-[color:var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary-2)]"
      >
        <Info className="w-3.5 h-3.5" strokeWidth={2.4} />
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-full mt-2 z-30 w-[min(22rem,92%)] rounded-xl px-3.5 py-2.5 text-[13px] leading-snug text-left opacity-0 translate-y-1 transition-[opacity,transform] duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0"
        // Lighter than the card and narrower than the field it covers. A
        // bubble darker than its surroundings reads as a hole rather than as
        // something floating, and at phone width it lands exactly on the
        // textarea — where, matched in width and tone, it looks like typed
        // content instead of a tip.
        style={{
          background: "#1b1b27",
          color: "var(--text)",
          border: "1px solid rgba(255,255,255,0.22)",
          boxShadow: "0 20px 44px -14px rgba(0,0,0,0.9)",
        }}
      >
        {text}
      </span>
    </span>
  );
}

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
    <main className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-10">
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
            <div className="flex flex-wrap items-center gap-4 mb-6">
              <button
                onClick={() => setView("input")}
                className="btn inline-flex items-center gap-1.5 text-sm font-medium text-[color:var(--muted)] hover:text-[color:var(--text)]"
              >
                <ArrowLeft className="w-4 h-4" /> New search
              </button>
              <div className="h-4 w-px bg-[color:var(--border-strong)]" />
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-[color:var(--faint)]">Recent posts for</span>
                <span className="font-medium text-[color:var(--text)]">{topic}</span>
              </div>
            </div>

            {error && (
              <div className="glass rounded-2xl p-6 mb-4 text-sm text-[color:var(--red)]">{error}</div>
            )}

            {loading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="glass rounded-2xl p-5 h-64 skeleton" />
                ))}
              </div>
            ) : !error && posts.length === 0 ? (
              <div className="glass rounded-2xl p-16 text-center text-[color:var(--muted)]">
                No fresh posts on that topic right now. Try a broader phrase.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {posts.map((post, i) => (
                  <PostCard key={post.external_id} post={post} index={i} onToast={flash} />
                ))}
              </div>
            )}
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
