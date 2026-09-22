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
  /**
   * Eligible posts left unpolled this run: inside the cooldown, over a per-run
   * cap, past the wall-clock budget, or claimed by a concurrent run.
   */
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
/**
 * Wall-clock budget for a whole run, in the same shape as the discovery reply
 * pass. The caps alone do not bound the time: 50 Reddit posts at the courtesy
 * gap above is 75s of sleeping before a single fetch is counted, which is
 * already past the route's own `maxDuration = 60`. A lane stops STARTING new
 * posts once this passes and reports the rest as skipped; the oldest-first
 * ordering means the next run picks them up. 45s leaves room for the route's
 * follow-up count and feed read.
 */
const POLL_BUDGET_MS = 45_000;
/**
 * A forced (manual refresh) run ignores the ten-minute cooldown, but not this.
 * Two runs overlapping — two tabs, or a reload while a slow Facebook lane is
 * still going — would otherwise each claim the same posts and each pay for
 * them. Thirty seconds is long enough that a second trigger cannot double the
 * bill and short enough that pressing refresh still means refresh.
 */
const FORCE_CLAIM_FLOOR_MS = 30_000;

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
 * Mark replies read. `undefined` means ALL — the "mark all read" case, which
 * filters on `seen_by_user = false` rather than rewriting the whole table on
 * every click. An explicitly EMPTY array means nothing, and does nothing: a
 * caller that computed a list and got none back is asking for no change, and
 * silently upgrading that to "clear everything" is the kind of landmine that
 * only goes off once.
 */
export async function markSeen(ids?: string[]): Promise<void> {
  if (ids && ids.length === 0) return;
  const q = getSupabase().from("saved_post_replies").update({ seen_by_user: true });
  const { error } = ids ? await q.in("id", ids) : await q.eq("seen_by_user", false);
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
 * The dedupe is in memory because the collisions are real: Facebook falls back
 * to the array index as a comment id when the vendor gives none
 * (lib/sources/socialapis.ts), so one batch can carry the same `reply_id`
 * twice.
 *
 * It is NOT load-bearing for correctness, and the usual claim about it is
 * wrong — tested against this database: an `ignoreDuplicates` upsert carrying
 * two rows with the same conflict target inserts one and raises nothing,
 * because PostgREST emits ON CONFLICT DO NOTHING and only DO UPDATE has the
 * "cannot affect row a second time" restriction. What the dedupe buys is a
 * smaller payload, an accurate `stored` count, and safety if this ever moves
 * to DO UPDATE.
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
 * Claim a post for this run, atomically, immediately before it is fetched.
 *
 * This is the only thing standing between Hon and a doubled Facebook bill.
 * Two overlapping runs — two tabs, or a reload while a slow Facebook lane is
 * still going — each do their own eligibility read, and without a claim they
 * both see the same oldest-eligible posts and both pay for them; the per-run
 * cap is an in-memory counter and cannot see the other run at all. Here the
 * stamp IS the claim: `last_polled_at` moves before the call goes out, under a
 * WHERE that still requires the row to be eligible, so whichever run's UPDATE
 * commits first is the only one that gets the row back. The loser is told
 * nothing was updated and skips it.
 *
 * Claiming before the fetch also means a post whose source is down or whose
 * URL the vendor cannot read enters the cooldown like any other — it is not
 * re-called on every page open with no backoff, which on Facebook is a bill
 * rather than just noise (measured 2026-09-22 on a real saved group post
 * aborting at the vendor's 5s cap).
 *
 * Returns false when another run already had it.
 */
async function claimPost(id: string, claimCutoffIso: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("saved_posts")
    .update({ last_polled_at: new Date().toISOString() })
    .eq("id", id)
    .or(`last_polled_at.is.null,last_polled_at.lt.${claimCutoffIso}`)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Record that this post's existing comment tree has been stored, so the next
 * poll treats what it finds as NEW rather than baselining a second time.
 *
 * Retried once, and loud when it still fails, because this is the one write
 * whose loss is silent: the tree is already in the table marked seen, so a
 * lost stamp makes the next run baseline again and quietly file every reply
 * that arrived in between as already-read. Nobody would ever notice.
 */
async function stampBaselined(id: string, stats: PollStats, label: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await getSupabase()
      .from("saved_posts")
      .update({ baselined_at: new Date().toISOString() })
      .eq("id", id);
    if (!error) return;
    if (attempt === 1) {
      stats.errors.push(
        `${label}: stored the existing replies but could not record the baseline (${error.message}). ` +
          `The next check will baseline this post again, so replies arriving before then may not be flagged as new.`,
      );
    }
  }
}

/**
 * Fetch one post's replies and store them. Never throws: a dead thread, a
 * rate-limited source or an unreachable store must cost that one post and not
 * the rest of the run.
 */
async function pollOne(row: SavedRow, stats: PollStats, claimCutoffIso: string): Promise<void> {
  const platform = row.platform as Pollable;
  const label = `${row.platform} ${row.url}`;
  try {
    // Claim first, call second. Nothing below may run for a post another
    // concurrent run already took — on Facebook that is a second credit for
    // the same comments.
    if (!(await claimPost(row.id, claimCutoffIso))) {
      stats.skipped += 1;
      return;
    }
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

    // Only after the rows are actually in the table. Stamping before the
    // insert would, on a failed insert, leave a post marked baselined with
    // nothing stored — and the next run would then file its entire
    // pre-existing comment tree as unread.
    if (baseline) await stampBaselined(row.id, stats, label);
  } catch (err) {
    // `last_polled_at` was already moved by the claim, so a post whose source
    // is failing sits out the cooldown instead of being retried on every page
    // open. `baselined_at` is untouched, so the first run that actually stores
    // something still baselines it.
    stats.errors.push(`${label}: ${(err as Error).message}`.replace(/\s+/g, " "));
  }
}

/**
 * Poll one platform's posts serially, in the order they were handed over,
 * until the run's wall-clock budget is gone.
 *
 * The deadline is checked BEFORE starting a post, never during one, so a call
 * already in flight is allowed to finish — abandoning a SocialAPIs call does
 * not refund its credit, so cutting one off mid-flight would buy comments
 * nobody ever sees. The courtesy gap is skipped after the last post, which is
 * where the old version spent a pointless 1.5s per lane.
 */
async function pollLane(
  rows: SavedRow[],
  stats: PollStats,
  deadline: number,
  claimCutoffIso: string,
  gapMs = 0,
): Promise<void> {
  for (let i = 0; i < rows.length; i++) {
    if (Date.now() >= deadline) {
      // Nothing was claimed for these, so their `last_polled_at` is untouched
      // and the next run finds them at the front of the oldest-first order.
      stats.skipped += rows.length - i;
      return;
    }
    await pollOne(rows[i], stats, claimCutoffIso);
    if (gapMs && i < rows.length - 1) await sleep(gapMs);
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

  // Two cutoffs, on purpose. `cutoff` is the ordinary cooldown, applied in
  // memory so a run does not attempt a claim on every saved post. The claim
  // cutoff is what the per-post UPDATE actually enforces, and a forced run
  // relaxes it only as far as FORCE_CLAIM_FLOOR_MS — "refresh" may ignore the
  // ten-minute cooldown, but it may not let two overlapping runs pay twice.
  const cutoff = Date.now() - POLL_COOLDOWN_MS;
  const claimCutoffIso = new Date(
    Date.now() - (force ? FORCE_CLAIM_FLOOR_MS : POLL_COOLDOWN_MS),
  ).toISOString();
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
  // concurrent. Reddit keeps its 1.5s courtesy gap. Facebook is serial, so
  // THIS run never has more than one billable call in flight; a CONCURRENT run
  // is held off by the per-post claim in `pollOne`, not by this.
  const deadline = Date.now() + POLL_BUDGET_MS;
  await Promise.all([
    pollLane(lanes.reddit, stats, deadline, claimCutoffIso, REDDIT_COURTESY_MS),
    pollLane(lanes.hackernews, stats, deadline, claimCutoffIso),
    pollLane(lanes.stackexchange, stats, deadline, claimCutoffIso),
    pollLane(lanes.facebook, stats, deadline, claimCutoffIso),
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
