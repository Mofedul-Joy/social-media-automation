import type { ScrapedPost, SourceResult } from "../types";
import { getJson, externalIdFromUrl, sleep, SourceError } from "./http";

/**
 * Arctic Shift: free, unauthenticated Reddit archive.
 * https://github.com/ArthurHeitmann/arctic_shift
 *
 * Replaces EnsembleData for Reddit (that vendor's token needs a paid renewal;
 * this is Reddit-derived data with no vendor cost). Reddit itself hard-blocks
 * direct requests from this environment ("whoa there, pardner!"), so this
 * archive — which does its own Reddit access server-side — is the route in.
 *
 * The `query` param only works alongside `author` or `subreddit` (no global
 * full-text search), so this loops the configured subreddit list per query,
 * same shape the config already has from the EnsembleData era.
 */

const BASE = "https://arctic-shift.photon-reddit.com/api";
const HEADERS = { "User-Agent": "hon-sma-discovery/1.0" };

interface ArcticPost {
  id: string;
  permalink?: string;
  subreddit: string;
  author: string;
  title?: string;
  selftext?: string;
  created_utc: number;
  removal_type?: string | null;
}

function toPost(d: ArcticPost, query: string): ScrapedPost | null {
  if (!d?.permalink || d.removal_type) return null; // removed/mod-deleted posts have no real body
  const url = `https://www.reddit.com${d.permalink}`;
  const body = (d.selftext || "").trim();
  if (!body && !d.title) return null;
  return {
    platform: "reddit",
    external_id: externalIdFromUrl(url),
    url,
    author: d.author,
    title: d.title,
    body: body || d.title || "",
    scraped_at: new Date().toISOString(),
    posted_at: new Date(d.created_utc * 1000).toISOString(),
    source_query: query,
  };
}

/**
 * One subreddit, one query. Arctic Shift's rate limiting is dynamic and
 * responds to burst load with 422 ("Timeout. Maybe slow down a bit") as
 * often as 429 — both mean the same thing: back off and retry, not a bad
 * request. getJson's own retry only covers 429/5xx, so 422 is handled here.
 */
async function searchOne(query: string, subreddit: string): Promise<ScrapedPost[]> {
  const url =
    `${BASE}/posts/search?subreddit=${encodeURIComponent(subreddit)}` +
    `&query=${encodeURIComponent(query)}&sort=desc&limit=25`;
  for (let attempt = 0; ; attempt++) {
    try {
      const json = await getJson(url, { headers: HEADERS });
      const rows: ArcticPost[] = json?.data ?? [];
      return rows.map((d) => toPost(d, query)).filter((p): p is ScrapedPost => p !== null);
    } catch (err) {
      const rateLimited = err instanceof SourceError && (err.status === 422 || err.status === 429);
      if (!rateLimited || attempt >= 2) throw err;
      await sleep(3000 * 2 ** attempt);
    }
  }
}

/**
 * Same call shape as the old EnsembleData `searchReddit`, so `discover.ts`
 * only needed an import swap. Free, so `unitsCharged` is always 0.
 *
 * This is a free, volunteer-run archive, not a paid vendor with dedicated
 * capacity — the 1.5s gap between calls is deliberate goodwill, not just
 * throughput tuning.
 */
export async function searchReddit(
  query: string,
  { subreddits = [] }: { subreddits?: string[] } = {},
): Promise<SourceResult> {
  if (subreddits.length === 0) {
    return { posts: [], unitsCharged: 0, errors: ["arctic shift needs at least one configured subreddit"] };
  }
  const posts: ScrapedPost[] = [];
  const errors: string[] = [];
  for (const sub of subreddits) {
    try {
      posts.push(...(await searchOne(query, sub)));
    } catch (err) {
      errors.push(`r/${sub} "${query}": ${(err as Error).message}`);
    }
    await sleep(1500);
  }
  return { posts, unitsCharged: 0, errors };
}
