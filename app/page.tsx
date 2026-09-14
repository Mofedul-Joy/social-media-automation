"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2, ArrowLeft, Radio, Sparkles } from "lucide-react";
import type { BusinessContext, Platform, ScrapedPost } from "@/lib/types";
import { PlatformIcon, PLATFORM_COLOR } from "./components/PlatformIcon";
import { PostCard } from "./components/PostCard";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [view, setView] = useState<"input" | "results">("input");
  const [loading, setLoading] = useState(false);
  const [posts, setPosts] = useState<ScrapedPost[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ctx, setCtx] = useState<BusinessContext | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => setCtx(d.context ?? null))
      .catch(() => {});
  }, []);

  const enabledPlatforms = (Object.entries(ctx?.platforms ?? {}) as [Platform, { enabled: boolean }][])
    .filter(([, c]) => c.enabled)
    .map(([p]) => p);
  const suggestions = (ctx?.keywords ?? []).slice(0, 6);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }

  const canSearch = topic.trim().length > 0 && !loading;

  async function search() {
    if (!canSearch) return;
    setLoading(true);
    setView("results");
    setPosts([]);
    setError(null);
    try {
      const res = await fetch("/api/topic-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "search failed");
      else setPosts(data.posts ?? []);
    } catch {
      setError("Something went wrong fetching posts.");
    } finally {
      setLoading(false);
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
              <label className="block text-sm font-semibold mb-2" htmlFor="topic">Search phrase or topic</label>
              <p className="text-xs text-[color:var(--faint)] mb-3">
                One AI call is spent only when you click Generate comment on a specific post, not on every search.
              </p>
              <div className="flex gap-2 mb-4 flex-wrap">
                <input
                  id="topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && search()}
                  placeholder="e.g. people deciding between two tools, or complaining about a problem you solve"
                  className="flex-1 min-w-[240px] text-sm rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] focus:border-[color:var(--primary)] outline-none px-4 py-3 text-[color:var(--text)] placeholder:text-[color:var(--faint)]"
                />
              </div>
              {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-7">
                  <span className="text-xs text-[color:var(--faint)] py-1">Try:</span>
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
                  <span className="text-xs text-[color:var(--faint)]">Searching:</span>
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
                onClick={search}
                disabled={!canSearch}
                className="btn btn-primary w-full py-3.5 rounded-2xl font-semibold text-[15px] inline-flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                Find recent posts
              </button>
            </div>
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
