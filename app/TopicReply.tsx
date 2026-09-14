"use client";

import { useState } from "react";
import type { AiAnalysis, ScrapedPost } from "@/lib/types";

/**
 * Live topic lookup, in two steps.
 *
 * Step 1 is cheap: /api/topic-search lists the raw posts the sources return, no
 * AI involved. Step 2 is the expensive one and is per post: clicking Generate
 * comment sends that single post to /api/analyze-post, which is one call to the
 * VPS worker. Before this split, one search analyzed every match up front and
 * burned an AI call on posts nobody ever looked at.
 *
 * Same engagement lane as before: copy the comment, open the post, paste it
 * yourself. Nothing here is queued or written to the DB, and there is no
 * auto-poster.
 */

type GenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; analysis: AiAnalysis }
  | { status: "error"; message: string };

const IDLE: GenState = { status: "idle" };

/** Compact relative age, so a card shows freshness without a full timestamp. */
function age(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function TopicReply({ onFlash }: { onFlash: (m: string) => void }) {
  const [topic, setTopic] = useState("");
  const [searching, setSearching] = useState(false);
  const [posts, setPosts] = useState<ScrapedPost[] | null>(null);
  const [gen, setGen] = useState<Record<string, GenState>>({});
  const [error, setError] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || searching) return;
    setSearching(true);
    setError(null);
    setPosts(null);
    setGen({});
    try {
      const res = await fetch("/api/topic-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "search failed");
      else setPosts(data.posts ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const generate = async (post: ScrapedPost) => {
    const key = post.external_id;
    if (gen[key]?.status === "loading") return;
    setGen((g) => ({ ...g, [key]: { status: "loading" } }));
    try {
      const res = await fetch("/api/analyze-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "could not draft a comment");
      setGen((g) => ({ ...g, [key]: { status: "done", analysis: data.analysis } }));
    } catch (err) {
      setGen((g) => ({ ...g, [key]: { status: "error", message: (err as Error).message } }));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onFlash("Comment copied to clipboard");
    } catch {
      onFlash("Could not copy, select the comment and copy manually");
    }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <form className="row" onSubmit={search}>
        <input
          className="comment"
          style={{ flex: 1, minHeight: 0, height: 36, resize: "none" }}
          placeholder="Find live posts on a topic, e.g. “AI agent frameworks”"
          maxLength={200}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={searching || !topic.trim()}>
          {searching ? "Searching…" : "Find posts"}
        </button>
      </form>

      {searching && <p className="query">Searching live posts. No comments are drafted yet.</p>}
      {error && (
        <p className="query" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      {posts && posts.length === 0 && !searching && (
        <p className="query">No fresh posts on that topic right now.</p>
      )}
      {posts && posts.length > 0 && (
        <p className="query">
          {posts.length} live {posts.length === 1 ? "post" : "posts"}. Draft a comment only for the
          ones worth your time.
        </p>
      )}

      {posts?.map((post) => {
        const state = gen[post.external_id] ?? IDLE;
        const done = state.status === "done" ? state.analysis : null;
        // The classifier returns an empty comment for posts it reads as sellers
        // or otherwise not worth replying to. The old route filtered those out
        // before the UI ever saw them; now the human sees the verdict instead,
        // so an empty draft has to be a real state, not an empty pair of quotes
        // over a Copy button that copies nothing.
        const draft = done?.comment.trim() ?? "";
        const posted = age(post.posted_at);
        return (
          <div className="card" key={post.external_id}>
            <div className="meta">
              <span className={`pill ${post.platform}`}>{post.platform}</span>
              {done && <span className="pill cat">{done.category}</span>}
              {posted && (
                <span className="query" style={{ margin: 0 }}>
                  {posted}
                </span>
              )}
              {done && (
                <>
                  <span className="rel">intent {(done.intent * 100).toFixed(0)}%</span>
                  <span className="rel dim">relevance {(done.relevance * 100).toFixed(0)}%</span>
                </>
              )}
            </div>

            {post.title && <h3>{post.title}</h3>}
            {post.author && <p className="query">by {post.author}</p>}

            {done ? (
              <p className="summary">{done.summary}</p>
            ) : (
              <p className="summary excerpt">{post.body}</p>
            )}

            {state.status === "loading" && (
              <div className="skeleton-block" aria-live="polite" aria-label="Drafting a comment">
                <span className="skeleton" style={{ width: "92%" }} />
                <span className="skeleton" style={{ width: "78%" }} />
                <span className="skeleton" style={{ width: "45%" }} />
              </div>
            )}

            {done && draft && <p className="summary drafted">“{draft}”</p>}
            {done && !draft && (
              <p className="summary">
                No comment drafted. The AI read the author as a {done.actor} on this one, so there
                is nothing useful to reply with.
              </p>
            )}

            {state.status === "error" && (
              <p className="query" style={{ color: "var(--red)" }}>
                {state.message}
              </p>
            )}

            <div className="actions">
              {done && draft ? (
                <button className="btn approve" onClick={() => copy(draft)}>
                  Copy comment
                </button>
              ) : done ? null : (
                <button
                  className={`btn primary${state.status === "loading" ? " working" : ""}`}
                  onClick={() => generate(post)}
                  disabled={state.status === "loading"}
                  title="Reads this one post with AI and drafts a comment for it. Costs one AI call, and only for this post."
                >
                  {state.status === "loading" ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      Drafting…
                    </>
                  ) : state.status === "error" ? (
                    "Try again"
                  ) : (
                    "Generate comment"
                  )}
                </button>
              )}
              <a
                className="btn"
                href={post.url}
                target="_blank"
                rel="noreferrer"
                title="Opens the real post in a new tab, where your own login already applies. Paste the comment there yourself."
              >
                Open post ↗
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
