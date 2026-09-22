import { getSupabase } from "./supabaseClient";
import { CATEGORY_GENERAL, type ScrapedPost } from "@/lib/types";

/**
 * The counts behind /analytics. Schema and the four read views are in
 * `migrations/005_discovery_counts.sql`.
 *
 * WHY COUNTS ARE WRITTEN AT SEARCH TIME: discovery results are never persisted
 * anywhere — `/api/topic-search` hands the ScrapedPost objects to the browser
 * and forgets them. The only moment the numbers exist is the instant a search
 * returns, so that is the only place they can be recorded. Nothing here can
 * reconstruct a count after the fact, which is exactly why a number that was
 * never recorded is reported as 0 and never estimated.
 *
 * ALL AGGREGATION HAPPENS IN SQL, in the views. Nothing in this file sums an
 * array: the database can see every row, a page of PostgREST results cannot,
 * and a total computed from a truncated read is a wrong number that looks right.
 *
 * Server-side only. `getSupabase()` holds the SERVICE ROLE key, so nothing in
 * here may ever be imported from a client component — the browser reaches it
 * through `/api/analytics`.
 */

/** Same ceiling lib/topics.ts enforces, so the FK to `search_topics.topic` can always match. */
const MAX_TOPIC_LEN = 200;

/** One row, always, even against an empty database — the views coalesce to 0. */
export interface TotalsRow {
  searches_run: number;
  results_found: number;
  buyer_results: number;
  posts_saved: number;
  drafts_composed: number;
}

export interface CategoryRow {
  category: string;
  results: number;
}

export interface PlatformRow {
  platform: string;
  results: number;
  buyer_results: number;
  saved: number;
}

export interface TopicRow {
  topic: string;
  buyer_hits: number;
  total_hits: number;
  use_count: number;
  last_used_at: string;
}

export interface Analytics {
  totals: TotalsRow;
  byCategory: CategoryRow[];
  byPlatform: PlatformRow[];
  byTopic: TopicRow[];
}

/**
 * Real zeroes and empty lists, not placeholders: every figure here is a true
 * statement about a database nothing has been written to yet. Exported so the
 * route and the page can start from one shape instead of each inventing their
 * own, and so an unreachable store answers with zeroes it also labels
 * `unavailable` rather than zeroes that read as counts.
 */
export const EMPTY_ANALYTICS: Analytics = {
  totals: { searches_run: 0, results_found: 0, buyer_results: 0, posts_saved: 0, drafts_composed: 0 },
  byCategory: [],
  byPlatform: [],
  byTopic: [],
};

/**
 * Records what one search actually returned, bucketed by (platform, category).
 * `hits` on the row is a running total, so this reads the current value and
 * writes existing + n.
 *
 * Read-then-upsert rather than an atomic SQL increment, for the same reason
 * `recordTopic()` does it: an atomic increment would need a stored function,
 * and this app has exactly one user — two searches landing in the same
 * millisecond, the only case a lost update needs, cannot happen here. The cost
 * of being wrong is a counter reading low, on a dashboard, once.
 *
 * A post with no category is counted as CATEGORY_GENERAL rather than skipped:
 * it was still a result, and dropping it would make `results_found` disagree
 * with the number of posts the user was actually shown.
 *
 * Throws on a store failure. The caller swallows it — analytics must never be
 * able to break a search.
 */
export async function recordDiscoveryCounts(topic: string, posts: ScrapedPost[]): Promise<void> {
  const t = topic.trim();
  if (!t || t.length > MAX_TOPIC_LEN) return;
  if (!posts.length) return;

  // Keyed on the pair, because that pair plus the topic is the table's grain.
  const buckets = new Map<string, { platform: string; category: string; n: number }>();
  for (const p of posts) {
    const category = p.category?.trim() || CATEGORY_GENERAL;
    const key = `${p.platform}\u0000${category}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.n += 1;
    else buckets.set(key, { platform: p.platform, category, n: 1 });
  }

  const sb = getSupabase();
  // One read for the whole topic rather than one per bucket: the row count here
  // is bounded by however many platforms and categories that topic has ever
  // produced, which is small.
  const { data, error: readErr } = await sb
    .from("discovery_counts")
    .select("platform,category,hits")
    .eq("topic", t);
  if (readErr) throw readErr;

  const existing = new Map<string, number>();
  for (const row of data ?? []) {
    existing.set(`${row.platform}\u0000${row.category}`, (row.hits as number | null) ?? 0);
  }

  const { error } = await sb.from("discovery_counts").upsert(
    [...buckets.entries()].map(([key, b]) => ({
      topic: t,
      platform: b.platform,
      category: b.category,
      hits: (existing.get(key) ?? 0) + b.n,
    })),
    { onConflict: "topic,platform,category" },
  );
  if (error) throw error;
}

/**
 * All four payloads in one round trip. Throws on a store failure; the route
 * decides what an unreachable store should look like to the user, not this.
 *
 * The ORDER BY inside each view is restated here as an explicit `.order()`.
 * That is not belt-and-braces: PostgREST issues its own SELECT against the
 * view, and a sort that only lives inside the view is a planner convenience,
 * not a promise. The leaderboard's whole job is the order it is in, so the
 * order is asked for out loud. Same columns, same direction, on purpose.
 */
export async function loadAnalytics(): Promise<Analytics> {
  const sb = getSupabase();
  const [totals, byCategory, byPlatform, byTopic] = await Promise.all([
    // maybeSingle, not single: the view always yields exactly one row, but a
    // single() against a view that somehow returned none is an error rather
    // than the honest zeroes the dashboard can still render.
    sb.from("analytics_totals").select("*").maybeSingle(),
    sb
      .from("analytics_by_category")
      .select("*")
      .order("results", { ascending: false })
      .order("category", { ascending: true }),
    sb
      .from("analytics_by_platform")
      .select("*")
      .order("results", { ascending: false })
      .order("platform", { ascending: true }),
    sb
      .from("analytics_by_topic")
      .select("*")
      .order("buyer_hits", { ascending: false })
      .order("last_used_at", { ascending: false }),
  ]);
  for (const r of [totals, byCategory, byPlatform, byTopic]) {
    if (r.error) throw r.error;
  }

  return {
    totals: (totals.data as TotalsRow | null) ?? EMPTY_ANALYTICS.totals,
    byCategory: (byCategory.data ?? []) as unknown as CategoryRow[],
    byPlatform: (byPlatform.data ?? []) as unknown as PlatformRow[],
    byTopic: (byTopic.data ?? []) as unknown as TopicRow[],
  };
}
