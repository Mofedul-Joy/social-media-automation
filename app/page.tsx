"use client";

import { useCallback, useEffect, useState } from "react";

type Platform = "reddit" | "facebook" | "instagram";
type Status = "pending" | "approved" | "skipped" | "posted" | "failed";

interface Candidate {
  id: number;
  platform: Platform;
  url: string;
  title: string | null;
  author: string | null;
  relevance: number;
  category: string;
  ai_summary: string;
  draft_comment: string;
  status: Status;
  error: string | null;
}

interface Stats {
  pending: number;
  approved: number;
  skipped: number;
  posted: number;
  failed: number;
  total: number;
}

const TABS: Status[] = ["pending", "approved", "posted", "skipped", "failed"];

export default function Page() {
  const [status, setStatus] = useState<Status>("pending");
  const [items, setItems] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/posts?status=${status}`, { cache: "no-store" });
      const data = await res.json();
      setItems(data.candidates);
      setStats(data.stats);
      const d: Record<number, string> = {};
      for (const c of data.candidates as Candidate[]) d[c.id] = c.draft_comment;
      setDrafts(d);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: number, decision: "approved" | "skipped") => {
    setBusy(id);
    try {
      await fetch("/api/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, comment: drafts[id] }),
      });
      flash(decision === "approved" ? "Approved — queued for posting" : "Skipped");
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Engagement Console</h1>
          <div className="sub">Review AI-drafted comments. Nothing posts without your approval.</div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`tab ${status === t ? "active" : ""}`}
            onClick={() => setStatus(t)}
          >
            {t}
            {stats && <span className="count">{stats[t]}</span>}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          {loading ? "Loading…" : `No ${status} posts. Discovery runs on a schedule (npm run discover) and fills this queue.`}
        </div>
      ) : (
        items.map((c) => (
          <div className="card" key={c.id}>
            <div className="meta">
              <span className={`pill ${c.platform}`}>{c.platform}</span>
              <span className="pill cat">{c.category}</span>
              <span className="rel">relevance {(c.relevance * 100).toFixed(0)}%</span>
            </div>
            {c.title && <h3>{c.title}</h3>}
            <p className="summary">{c.ai_summary}</p>

            {status === "pending" ? (
              <textarea
                className="comment"
                value={drafts[c.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
              />
            ) : (
              <p className="summary" style={{ color: "var(--text)" }}>
                “{c.draft_comment}”
              </p>
            )}

            {c.error && <p className="summary" style={{ color: "var(--red)" }}>Error: {c.error}</p>}

            <div className="actions">
              {status === "pending" && (
                <>
                  <button
                    className="btn approve"
                    disabled={busy === c.id}
                    onClick={() => decide(c.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    className="btn skip"
                    disabled={busy === c.id}
                    onClick={() => decide(c.id, "skipped")}
                  >
                    Skip
                  </button>
                </>
              )}
              <a className="src" href={c.url} target="_blank" rel="noreferrer">
                View original ↗
              </a>
            </div>
          </div>
        ))
      )}

      {stats && (
        <div className="statbar" style={{ marginTop: 20 }}>
          {stats.total} total · {stats.pending} pending · {stats.approved} approved ·{" "}
          {stats.posted} posted · {stats.failed} failed
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
