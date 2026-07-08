import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import type { Candidate, Platform, PostStatus, ScrapedPost, AiAnalysis } from "./types";

// The dashboard, discovery pass, and posting worker must all point at the SAME
// database file. On the VPS they run from the same directory so the default
// works; set DATABASE_PATH (absolute) to be explicit for cron jobs / services.
const DB_PATH = process.env.DATABASE_PATH
  ? (path.isAbsolute(process.env.DATABASE_PATH)
      ? process.env.DATABASE_PATH
      : path.join(process.cwd(), process.env.DATABASE_PATH))
  : path.join(process.cwd(), "data", "engagement.db");
const DATA_DIR = path.dirname(DB_PATH);

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      platform     TEXT NOT NULL,
      external_id  TEXT NOT NULL,
      url          TEXT NOT NULL,
      author       TEXT,
      title        TEXT,
      body         TEXT NOT NULL,
      relevance    REAL NOT NULL DEFAULT 0,
      category     TEXT NOT NULL DEFAULT '',
      ai_summary   TEXT NOT NULL DEFAULT '',
      draft_comment TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TEXT NOT NULL,
      decided_at   TEXT,
      posted_at    TEXT,
      error        TEXT,
      UNIQUE(platform, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_status ON candidates(status);
  `);
  _db = d;
  return d;
}

/** Returns true if this post has already been seen (any status). */
export function alreadySeen(platform: Platform, externalId: string): boolean {
  const row = db()
    .prepare("SELECT 1 FROM candidates WHERE platform = ? AND external_id = ?")
    .get(platform, externalId);
  return !!row;
}

/** Insert an analyzed post into the queue. Ignores duplicates. Returns row id or null. */
export function insertCandidate(post: ScrapedPost, ai: AiAnalysis): number | null {
  const stmt = db().prepare(`
    INSERT OR IGNORE INTO candidates
      (platform, external_id, url, author, title, body, relevance, category, ai_summary, draft_comment, status, created_at)
    VALUES
      (@platform, @external_id, @url, @author, @title, @body, @relevance, @category, @ai_summary, @draft_comment, 'pending', @created_at)
  `);
  const info = stmt.run({
    platform: post.platform,
    external_id: post.external_id,
    url: post.url,
    author: post.author ?? null,
    title: post.title ?? null,
    body: post.body,
    relevance: ai.relevance,
    category: ai.category,
    ai_summary: ai.summary,
    draft_comment: ai.comment,
    created_at: new Date().toISOString(),
  });
  return info.changes > 0 ? Number(info.lastInsertRowid) : null;
}

export function listCandidates(status?: PostStatus): Candidate[] {
  const q = status
    ? db().prepare("SELECT * FROM candidates WHERE status = ? ORDER BY relevance DESC, created_at DESC")
    : db().prepare("SELECT * FROM candidates ORDER BY created_at DESC");
  return (status ? q.all(status) : q.all()) as Candidate[];
}

export function getCandidate(id: number): Candidate | undefined {
  return db().prepare("SELECT * FROM candidates WHERE id = ?").get(id) as Candidate | undefined;
}

export function setDecision(id: number, status: "approved" | "skipped", editedComment?: string): void {
  if (editedComment !== undefined) {
    db().prepare("UPDATE candidates SET status = ?, draft_comment = ?, decided_at = ? WHERE id = ?")
      .run(status, editedComment, new Date().toISOString(), id);
  } else {
    db().prepare("UPDATE candidates SET status = ?, decided_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id);
  }
}

export function markPosted(id: number): void {
  db().prepare("UPDATE candidates SET status = 'posted', posted_at = ?, error = NULL WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function markFailed(id: number, error: string): void {
  db().prepare("UPDATE candidates SET status = 'failed', error = ? WHERE id = ?").run(error, id);
}

/** Approved posts waiting to be published, optionally filtered by platform. */
export function nextApproved(platform?: Platform, limit = 50): Candidate[] {
  const q = platform
    ? db().prepare("SELECT * FROM candidates WHERE status = 'approved' AND platform = ? ORDER BY decided_at ASC LIMIT ?")
    : db().prepare("SELECT * FROM candidates WHERE status = 'approved' ORDER BY decided_at ASC LIMIT ?");
  return (platform ? q.all(platform, limit) : q.all(limit)) as Candidate[];
}

/** Count posts published today for a platform (for daily-cap enforcement). */
export function postedTodayCount(platform: Platform): number {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = db()
    .prepare("SELECT COUNT(*) as n FROM candidates WHERE platform = ? AND status = 'posted' AND posted_at >= ?")
    .get(platform, startOfDay.toISOString()) as { n: number };
  return row.n;
}

export function stats(): Record<PostStatus | "total", number> {
  const rows = db().prepare("SELECT status, COUNT(*) as n FROM candidates GROUP BY status").all() as {
    status: PostStatus;
    n: number;
  }[];
  const out = { pending: 0, approved: 0, skipped: 0, posted: 0, failed: 0, total: 0 } as Record<
    PostStatus | "total",
    number
  >;
  for (const r of rows) {
    out[r.status] = r.n;
    out.total += r.n;
  }
  return out;
}
