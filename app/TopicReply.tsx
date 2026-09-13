"use client";

import { useState } from "react";

/**
 * Live topic lookup: type a topic, get drafted comments for posts that are up
 * right now. Same engagement lane as the queue — copy the comment, open the
 * post, paste it yourself. Nothing here is queued or written to the DB.
 */

interface Result {
  post: {
    platform: string;
    url: string;
    title: string | null;
    author: string | null;
    posted_at: string | null;
  };
  analysis: {
    relevance: number;
    intent: number;
    category: string;
    summary: string;
    comment: string;
  };
}

export default function TopicReply({ onFlash }: { onFlash: (m: string) => void }) {
  const [topic, setTopic] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || searching) return;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/topic-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "search failed");
      else setResults(data.results ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onFlash("Comment copied to clipboard");
    } catch {
      onFlash("Could not copy — select the comment and copy manually");
    }
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <form className="row" onSubmit={search}>
        <input
          className="comment"
          style={{ flex: 1, minHeight: 0, height: 36, resize: "none" }}
          placeholder="Draft comments for a topic right now, e.g. “AI agent frameworks”"
          maxLength={200}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={searching || !topic.trim()}>
          {searching ? "Searching…" : "Find posts"}
        </button>
      </form>

      {searching && (
        <p className="query">Searching live posts and drafting comments — up to a minute.</p>
      )}
      {error && <p className="query" style={{ color: "var(--red)" }}>{error}</p>}
      {results && results.length === 0 && !searching && (
        <p className="query">No fresh posts worth replying to on that topic right now.</p>
      )}

      {results?.map((r) => (
        <div className="card" key={r.post.url}>
          <div className="meta">
            <span className={`pill ${r.post.platform}`}>{r.post.platform}</span>
            <span className="pill cat">{r.analysis.category}</span>
            <span className="rel">intent {(r.analysis.intent * 100).toFixed(0)}%</span>
            <span className="rel dim">relevance {(r.analysis.relevance * 100).toFixed(0)}%</span>
          </div>
          {r.post.title && <h3>{r.post.title}</h3>}
          <p className="summary">{r.analysis.summary}</p>
          {r.post.author && <p className="query">by {r.post.author}</p>}
          <p className="summary" style={{ color: "var(--text)" }}>“{r.analysis.comment}”</p>
          <div className="actions">
            <button className="btn approve" onClick={() => copy(r.analysis.comment)}>
              Copy comment
            </button>
            <a className="btn" href={r.post.url} target="_blank" rel="noreferrer">
              Open post ↗
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
