import { getSupabase } from "./supabaseClient";
import { fetchReplies as redditReplies } from "@/lib/sources/arcticshift";
import { fetchReplies as hnReplies } from "@/lib/sources/hackernews";
import { fetchReplies as seReplies } from "@/lib/sources/stackexchange";
import { fetchReplies as fbReplies } from "@/lib/sources/socialapis";
import { externalIdFromUrl, sleep } from "@/lib/sources/http";
import type { Platform, ScrapedPost } from "@/lib/types";

/**
 * Reply notifications: the memory of which replies on a saved post have
 * already been seen, so the next poll can tell a NEW reply from one that was
 * already there. Schema and the reasoning behind every column are in
 * `migrations/004_saved_post_replies.sql`.
 *
 * Server-side only. `getSupabase()` holds the SERVICE ROLE key, so nothing in
 * here may ever be imported from a client component — the browser reaches it
 * through `/api/notifications` and `/api/notifications/poll`.
 *
 * READ-ONLY, OFF-ACCOUNT, NO AI. This module reaches exactly the same public
 * per-source reply endpoints discovery already uses, and nothing else. It must
 * NEVER import or call `discoverPosts` or any `search*` function: discovery is
 * a search over the whole platform and costs credits per query, while this is
 * "what happened on threads we already hold URLs for". Only `fetchReplies`.
 * There is also no auto-posting, no write to any platform, no browser
 * automation and no model call anywhere in this path.
 */

export interface ReplyNotification {
  id: string;
  platform: string;
  post_title: string | null;
  post_url: string;
  author: string | null;
  snippet: string;
  url: string;
  posted_at: string | null;
  first_seen_at: string;
  seen_by_user: boolean;
}

export interface PollStats {
  /** Posts actually fetched from a source. */
  polled: number;
  /** Eligible posts left unpolled this run: cooldown, or over a per-run cap. */
  skipped: number;
  /** Saved posts on a platform with no reply source at all. */
  unsupported: number;
  /** Genuinely new rows stored unseen — this is what the bell counts. */
  inserted: number;
  /** Rows stored already-seen because it was the post's first poll. */
  baselined: number;
  /** Source calls ATTEMPTED per platform, counted before each call goes out. */
  calls: Record<string, number>;
  /**
   * Credits SocialAPIs reported back. A call that timed out reports nothing,
   * so on a bad vendor day this reads lower than the real bill — read it
   * alongside `calls.facebook`, which is the attempt count and the ceiling.
   */
  facebookCredits: number;
  errors: string[];
}

/**
 * Polling is triggered by a page open (and a manual refresh button), so a
 * reload loop would otherwise re-hit every source on every render — and on
 * Facebook re-spend a credit each time. Ten minutes is far shorter than the
 * pace replies actually arrive at and far longer than a human's reload finger.
 */
export const POLL_COOLDOWN_MS = 10 * 60_000;
/**
 * Facebook is the only source that charges (1 SocialAPIs credit per call), so
 * a run buys at most this many. The eligible list is ordered oldest-polled
 * first, so the cap walks through the whole saved list across runs instead of
 * pinning the same few posts forever.
 */
export const MAX_FACEBOOK_POLLS_PER_RUN = 10;
/**
 * Reddit / HN / Stack Exchange are free, but they are not instant: a saved
 * list of 400 Reddit threads would hold the request open for minutes. A per-
 * platform ceiling bounds the run; the same oldest-first ordering means the
 * remainder is picked up by the next one.
 */
export const MAX_FREE_POLLS_PER_RUN = 50;
/** Same courtesy gap the discovery reply pass uses — Arctic Shift is a free volunteer archive. */
const REDDIT_COURTESY_MS = 1500;

const MAX_SNIPPET_LEN = 400;
const MAX_AUTHOR_LEN = 200;
const MAX_URL_LEN = 2000;
/** PostgREST takes the whole payload in one request body; chunk so it stays sane. */
const INSERT_CHUNK = 500;

const NOTIFICATION_COLUMNS =
  "id,reply_id,author,snippet,url,posted_at,first_seen_at,seen_by_user," +
  "saved_posts(platform,title,url)";

/** The platforms that have a reply source. `instagram`/`threads` are saveable but have none. */
const POLLABLE = ["reddit", "hackernews", "stackexchange", "facebook"] as const;
type Pollable = (typeof POLLABLE)[number];

interface SavedRow {
  id: string;
  platform: string;
  url: string;
  title: string | null;
  last_polled_at: string | null;
  baselined_at: string | null;
}

/** Row shape PostgREST hands back for the embed above. */
interface NotificationRow {
  id: string;
  author: string | null;
  snippet: string;
  url: string;
  posted_at: string | null;
  first_seen_at: string;
  seen_by_user: boolean;
  saved_posts: { platform: string; title: string | null; url: string } | null;
}

/**
 * The feed: unseen first, then newest-first-seen first. Ordering on
 * `first_seen_at` rather than `posted_at` because Facebook comments arrive
 * with no timestamp at all (see the migration), and "when we first saw it" is
 * the one clock every row has.
 *
 * The parent post is joined in over the FK so a card can say which thread it
 * belongs to without a second round trip. Throws on a store failure; the route
 * decides what an unreachable store looks like to the user, not this.
 */
export async function listNotifications(limit = 50): Promise<ReplyNotification[]> {
  const { data, error } = await getSupabase()
    .from("saved_post_replies")
    .select(NOTIFICATION_COLUMNS)
    .order("seen_by_user", { ascending: true })
    .order("first_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  // Flattened here rather than in the UI: the embed is a storage detail, and
  // a nested `saved_posts` object on a notification DTO reads like the reply
  // owns the post.
  return ((data ?? []) as unknown as NotificationRow[]).map((r) => ({
    id: r.id,
    platform: r.saved_posts?.platform ?? "",
    post_title: r.saved_posts?.title ?? null,
    post_url: r.saved_posts?.url ?? "",
    author: r.author,
    snippet: r.snippet,
    url: r.url,
    posted_at: r.posted_at,
    first_seen_at: r.first_seen_at,
    seen_by_user: r.seen_by_user,
  }));
}

/** The bell badge. `head: true` so the rows themselves are never shipped. */
export async function unreadCount(): Promise<number> {
  const { count, error } = await getSupabase()
    .from("saved_post_replies")
    .select("id", { count: "exact", head: true })
    .eq("seen_by_user", false);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Mark replies read. With ids, only those; with none (or an empty array),
 * every unseen row — that is the "mark all read" case, and it filters on
 * `seen_by_user = false` rather than updating the whole table so an old feed
 * is not rewritten on every click.
 */
export async function markSeen(ids?: string[]): Promise<void> {
  const q = getSupabase().from("saved_post_replies").update({ seen_by_user: true });
  const { error } = ids && ids.length > 0 ? await q.in("id", ids) : await q.eq("seen_by_user", false);
  if (error) throw error;
}

/**
 * The per-source reply endpoints only read `url`, `external_id`, `platform`
 * and `source_query` off the post they are handed, so a synthetic minimal post
 * built from the saved row is all they need — the body and timestamps of the
 * parent are irrelevant to fetching its comments.
 */
function syntheticPost(row: SavedRow): ScrapedPost {
  return {
    platform: row.platform as Platform,
    external_id: externalIdFromUrl(row.url),
    url: row.url,
    title: row.title ?? undefined,
    body: "",
    scraped_at: new Date().toISOString(),
  };
}

/**
 * `replyPost()` builds `external_id` as `${parent.external_id}#${replyId}`, so
 * everything after the FIRST `#` is the source's own comment id. Split on the
 * first one only: a parent id could contain one, a comment id could too, and
 * the parent half is the prefix either way.
 */
function replyIdOf(externalId: string): string {
  const i = externalId.indexOf("#");
  return i === -1 ? externalId : externalId.slice(i + 1);
}

/**
 * Reddit leaves a tombstone behind when a comment is deleted by its author or
 * removed by a moderator: the comment still comes back in the tree, with a
 * body of `[removed]` or `[deleted]` and nothing else. Seen live — three of
 * the first four rows in the first real feed were these. They are not replies
 * to anything, so they are not notifications. Matched only when the tombstone
 * IS the whole body, so a real comment that happens to quote the word is kept.
 */
const TOMBSTONE = /^\[\s*(removed|deleted)(\s+by\s+[^\]]+)?\s*\]$/i;

function optional(value: string | undefined, max: number): string | null {
  const v = (value ?? "").trim();
  return v ? v.slice(0, max) : null;
}

interface ReplyRow {
  saved_post_id: string;
  reply_id: string;
  author: string | null;
  snippet: string;
  url: string;
  posted_at: string | null;
  seen_by_user: boolean;
}

/**
 * Normalize one source's replies into rows, deduped on `reply_id`.
 *
 * The dedupe is not cosmetic: a single insert payload holding two rows with
 * the same conflict target makes Postgres raise "ON CONFLICT DO UPDATE command
 * cannot affect row a second time", and it defeats `ignoreDuplicates` besides.
 * Facebook in particular falls back to the array index as a comment id when
 * the vendor gives none, so collisions inside one batch are real.
 */
function toRows(savedPostId: string, replies: ScrapedPost[], baseline: boolean): ReplyRow[] {
  const byReplyId = new Map<string, ReplyRow>();
  for (const r of replies) {
    const body = r.body.trim();
    // A comment with no text, or one the platform has already taken down, is
    // not a notification.
    if (!body || TOMBSTONE.test(body)) continue;
    const snippet = body.slice(0, MAX_SNIPPET_LEN);
    const reply_id = replyIdOf(r.external_id);
    if (!reply_id || byReplyId.has(reply_id)) continue;
    byReplyId.set(reply_id, {
      saved_post_id: savedPostId,
      reply_id,
      author: optional(r.author, MAX_AUTHOR_LEN),
      snippet,
      url: (r.url ?? "").slice(0, MAX_URL_LEN),
      posted_at: r.posted_at ?? null,
      seen_by_user: baseline,
    });
  }
  return Array.from(byReplyId.values());
}

/**
 * Store a batch and return how many rows were genuinely NEW.
 *
 * `ignoreDuplicates: true` makes PostgREST emit ON CONFLICT DO NOTHING, so an
 * already-stored reply is a no-op — and, crucially, is not returned by the
 * `.select()`, which is what makes the returned length an exact count of new
 * replies rather than of replies seen.
 */
async function insertRows(rows: ReplyRow[]): Promise<number> {
  let stored = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { data, error } = await getSupabase()
      .from("saved_post_replies")
      .upsert(rows.slice(i, i + INSERT_CHUNK), {
        onConflict: "saved_post_id,reply_id",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw error;
    stored += (data ?? []).length;
  }
  return stored;
}

/**
 * Stamp a post as polled. `last_polled_at` moves on every attempt, success or
 * failure, because it is the cooldown clock and a post whose source is broken
 * must not be re-called on every page open. `baselined_at` moves only when the
 * comment tree was actually stored, so an outage cannot silently consume a
 * post's one baseline and leave the next successful poll treating the whole
 * pre-existing tree as new.
 */
async function markPolled(id: string, baselined: boolean): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("saved_posts")
    .update(baselined ? { last_polled_at: now, baselined_at: now } : { last_polled_at: now })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Fetch one post's replies and store them. Never throws: a dead thread, a
 * rate-limited source or an unreachable store must cost that one post and not
 * the rest of the run.
 */
async function pollOne(row: SavedRow, stats: PollStats): Promise<void> {
  const platform = row.platform as Pollable;
  try {
    const post = syntheticPost(row);
    // Counted BEFORE the call, not after. This number exists so Facebook spend
    // is readable, and a SocialAPIs call that is abandoned at the timeout has
    // still been made and can still be charged — counting only the ones that
    // came back would under-report the bill exactly when it matters.
    stats.calls[platform] = (stats.calls[platform] ?? 0) + 1;
    let replies: ScrapedPost[];
    if (platform === "facebook") {
      const res = await fbReplies(post);
      // Per-call credit line, matching lib/discoverPosts.ts — Facebook spend
      // has to be readable straight out of the function logs.
      console.log(`poll facebook ${row.url}: ${res.unitsCharged} SocialAPIs credit(s)`);
      stats.facebookCredits += res.unitsCharged;
      replies = res.posts;
    } else if (platform === "reddit") {
      replies = await redditReplies(post);
    } else if (platform === "hackernews") {
      replies = await hnReplies(post);
    } else {
      replies = await seReplies(post);
    }
    stats.polled += 1;

    // First successful poll baselines: the whole existing comment tree is
    // stored already-seen, because a reply is only news if it appeared after
    // we started watching. Without it, saving one busy Reddit thread would put
    // a 155-unread badge on the bell for comments that predate the save
    // (measured: one real r/smallbusiness thread + one HN item + one Stack
    // Overflow question baselined 155 rows between them).
    const baseline = row.baselined_at === null;
    const rows = toRows(row.id, replies, baseline);
    const stored = rows.length > 0 ? await insertRows(rows) : 0;
    if (baseline) stats.baselined += stored;
    else stats.inserted += stored;

    await markPolled(row.id, true);
  } catch (err) {
    stats.errors.push(`${row.platform} ${row.url}: ${(err as Error).message}`.replace(/\s+/g, " "));
    // The post still enters the cooldown. A source that is down or a URL the
    // vendor cannot read would otherwise be retried on EVERY page open with no
    // backoff — and on Facebook an abandoned in-flight call still charges its
    // credit, so that is a bill, not just noise. `baselined_at` is left alone,
    // so the first poll that actually stores something still baselines.
    // Measured 2026-09-22: a real saved Facebook group post was aborting at
    // the vendor's 5s cap and was re-called on every single reload.
    await markPolled(row.id, false).catch((e) => {
      stats.errors.push(`${row.platform} ${row.url}: could not record the attempt: ${(e as Error).message}`);
    });
  }
}

/** Poll one platform's posts serially, in the order they were handed over. */
async function pollLane(rows: SavedRow[], stats: PollStats, gapMs = 0): Promise<void> {
  for (const row of rows) {
    await pollOne(row, stats);
    if (gapMs) await sleep(gapMs);
  }
}

/**
 * Check every saved post for new replies. Returns what it did rather than
 * throwing for a source failure — an empty run with errors listed is a normal
 * answer. Only a store failure on the initial read escapes.
 */
export async function pollSavedPosts({ force = false }: { force?: boolean } = {}): Promise<PollStats> {
  const stats: PollStats = {
    polled: 0,
    skipped: 0,
    unsupported: 0,
    inserted: 0,
    baselined: 0,
    calls: {},
    facebookCredits: 0,
    errors: [],
  };

  // Oldest-polled first, never-polled first. That ordering is what makes the
  // per-run caps below rotate through the whole saved list across runs.
  const { data, error } = await getSupabase()
    .from("saved_posts")
    .select("id,platform,url,title,last_polled_at,baselined_at")
    .order("last_polled_at", { ascending: true, nullsFirst: true });
  if (error) throw error;

  const cutoff = Date.now() - POLL_COOLDOWN_MS;
  const lanes: Record<Pollable, SavedRow[]> = {
    reddit: [],
    hackernews: [],
    stackexchange: [],
    facebook: [],
  };
  for (const row of (data ?? []) as SavedRow[]) {
    if (!(POLLABLE as readonly string[]).includes(row.platform)) {
      // instagram/threads are saveable but have no source client. Counted, and
      // deliberately NOT given a `last_polled_at` — nothing was polled, and
      // stamping one would make them look fresh forever.
      stats.unsupported += 1;
      continue;
    }
    const last = row.last_polled_at ? Date.parse(row.last_polled_at) : NaN;
    if (!force && !Number.isNaN(last) && last > cutoff) {
      stats.skipped += 1;
      continue;
    }
    const lane = lanes[row.platform as Pollable];
    const cap = row.platform === "facebook" ? MAX_FACEBOOK_POLLS_PER_RUN : MAX_FREE_POLLS_PER_RUN;
    if (lane.length >= cap) stats.skipped += 1;
    else lane.push(row);
  }

  // Same shape as the discovery reply pass: serial inside a lane, lanes
  // concurrent. Reddit keeps its 1.5s courtesy gap; Facebook is serial so a
  // run can never have more than one billable call in flight at a time.
  await Promise.all([
    pollLane(lanes.reddit, stats, REDDIT_COURTESY_MS),
    pollLane(lanes.hackernews, stats),
    pollLane(lanes.stackexchange, stats),
    pollLane(lanes.facebook, stats),
  ]);

  const calls = POLLABLE.filter((p) => p !== "facebook")
    .map((p) => `${p}=${stats.calls[p] ?? 0} calls`)
    .join(", ");
  console.log(
    `poll replies: ${calls}, facebook=${stats.calls.facebook ?? 0} calls / ` +
      `${stats.facebookCredits} credit(s); new=${stats.inserted} baselined=${stats.baselined} ` +
      `skipped=${stats.skipped} errors=${stats.errors.length}`,
  );
  return stats;
}
