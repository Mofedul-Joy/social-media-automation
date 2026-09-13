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
      intent_score REAL NOT NULL DEFAULT 0,
      category     TEXT NOT NULL DEFAULT '',
      ai_summary   TEXT NOT NULL DEFAULT '',
      draft_comment TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TEXT NOT NULL,
      decided_at   TEXT,
      posted_at    TEXT,
      error        TEXT,
      source_query TEXT,
      UNIQUE(platform, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_status ON candidates(status);
  `);
  migrate(d);
  _db = d;
  return d;
}

/**
 * Additive column migrations for databases created before the intent lane.
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so check the table info first.
 */
function migrate(d: Database.Database): void {
  const cols = new Set(
    (d.prepare("PRAGMA table_info(candidates)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("intent_score")) {
    d.exec("ALTER TABLE candidates ADD COLUMN intent_score REAL NOT NULL DEFAULT 0");
  }
  if (!cols.has("source_query")) {
    d.exec("ALTER TABLE candidates ADD COLUMN source_query TEXT");
  }
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
      (platform, external_id, url, author, title, body, relevance, intent_score, category,
       ai_summary, draft_comment, source_query, status, created_at)
    VALUES
      (@platform, @external_id, @url, @author, @title, @body, @relevance, @intent_score, @category,
       @ai_summary, @draft_comment, @source_query, 'pending', @created_at)
  `);
  const info = stmt.run({
    platform: post.platform,
    external_id: post.external_id,
    url: post.url,
    author: post.author ?? null,
    title: post.title ?? null,
    body: post.body,
    relevance: ai.relevance,
    intent_score: ai.intent,
    category: ai.category,
    ai_summary: ai.summary,
    draft_comment: ai.comment,
    source_query: post.source_query ?? null,
    created_at: new Date().toISOString(),
  });
  return info.changes > 0 ? Number(info.lastInsertRowid) : null;
}

export function listCandidates(status?: PostStatus): Candidate[] {
  const q = status
    ? db().prepare(
        "SELECT * FROM candidates WHERE status = ? ORDER BY intent_score DESC, relevance DESC, created_at DESC",
      )
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

/** The human posted the comment themselves after opening it from the dashboard. */
export function markPosted(id: number): void {
  db().prepare("UPDATE candidates SET status = 'posted', posted_at = ?, error = NULL WHERE id = ?")
    .run(new Date().toISOString(), id);
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
