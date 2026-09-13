import { loadBusinessContext } from "./config";
import { queriesFor } from "./intent";
import { analyzePost } from "./ai";
import { alreadySeen, insertCandidate, getCandidate } from "./store";
import { logActivity, ensureHeader } from "./sheets";
import { searchReddit } from "./sources/arcticshift";
import { groupPosts } from "./sources/socialapis";
import { searchHackerNews } from "./sources/hackernews";
import { searchStackOverflow } from "./sources/stackexchange";
import { isFresh } from "./sources/http";
import { DISCOVERY_PLATFORMS } from "./types";
import type { BusinessContext, Platform, ScrapedPost } from "./types";

/**
 * The discovery lane.
 *
 * Read-only, off-account, third-party APIs over public data. The client's own
 * logged-in accounts are never used here: a previous build got an account
 * banned by reading from it, and a block on this lane costs a vendor credit
 * rather than the asset the whole engagement lane depends on.
 *
 * Queries come from the intent matrix, not topic nouns. See lib/intent.ts for
 * why: nouns return the businesses selling the thing.
 */

export interface DiscoverResult {
  fetched: number;
  stale: number;
  skippedDuplicate: number;
  analyzed: number;
  queued: number;
  belowThreshold: number;
  byPlatform: Record<string, number>;
  /** Vendor units spent, keyed by vendor, for the per-client cost model. */
  unitsCharged: Record<string, number>;
  errors: string[];
}

const MAX_POST_AGE_DAYS = Number(process.env.MAX_POST_AGE_DAYS ?? 14);
/** Hard ceiling on AI calls per pass so a bad config cannot run up a bill. */
const MAX_ANALYZE = Number(process.env.MAX_ANALYZE_PER_RUN ?? 120);

function emptyResult(): DiscoverResult {
  return {
    fetched: 0,
    stale: 0,
    skippedDuplicate: 0,
    analyzed: 0,
    queued: 0,
    belowThreshold: 0,
    byPlatform: {},
    unitsCharged: {},
    errors: [],
  };
}

function spend(r: DiscoverResult, vendor: string, units: number): void {
  r.unitsCharged[vendor] = (r.unitsCharged[vendor] ?? 0) + units;
}

// ---------------------------------------------------------------------------
// Fetch stage: one function per platform, all off-account
// ---------------------------------------------------------------------------

/** Reddit via Arctic Shift, a free unauthenticated archive. See sources/arcticshift.ts. */
async function fetchReddit(ctx: BusinessContext, r: DiscoverResult): Promise<ScrapedPost[]> {
  const cfg = ctx.platforms.reddit;
  const out: ScrapedPost[] = [];
  for (const query of queriesFor(ctx, "reddit")) {
    const res = await searchReddit(query, { subreddits: cfg.subreddits ?? [] });
    spend(r, "arcticshift", res.unitsCharged);
    out.push(...res.posts);
    r.errors.push(...res.errors.map((e) => `reddit ${e}`));
  }
  return out;
}

/**
 * Facebook is polled group by group. Group URLs are found once, offline, with
 * `npm run fb-groups`; keyword search is far too expensive to run every pass.
 */
async function fetchFacebook(ctx: BusinessContext, r: DiscoverResult): Promise<ScrapedPost[]> {
  const groups = ctx.platforms.facebook.groups ?? [];
  if (groups.length === 0) {
    r.errors.push("facebook enabled but no groups configured — run `npm run fb-groups` first");
    return [];
  }
  const after = new Date(Date.now() - MAX_POST_AGE_DAYS * 86400_000);
  const out: ScrapedPost[] = [];
  for (const group of groups) {
    try {
      const res = await groupPosts(group, { limit: 9, afterTime: after });
      spend(r, "socialapis", res.unitsCharged);
      out.push(...res.posts);
    } catch (err) {
      r.errors.push(`facebook group ${group}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Free, unmetered, no daily quota — Algolia's public HN search index. */
async function fetchHackerNews(ctx: BusinessContext, r: DiscoverResult): Promise<ScrapedPost[]> {
  const out: ScrapedPost[] = [];
  for (const query of queriesFor(ctx, "hackernews")) {
    try {
      const res = await searchHackerNews(query);
      spend(r, "hackernews", res.unitsCharged);
      out.push(...res.posts);
    } catch (err) {
      r.errors.push(`hackernews "${query}": ${(err as Error).message}`);
    }
  }
  return out;
}

/** Free, unmetered — the public Stack Exchange API. */
async function fetchStackExchange(ctx: BusinessContext, r: DiscoverResult): Promise<ScrapedPost[]> {
  const out: ScrapedPost[] = [];
  for (const query of queriesFor(ctx, "stackexchange")) {
    try {
      const res = await searchStackOverflow(query);
      spend(r, "stackexchange", res.unitsCharged);
      out.push(...res.posts);
    } catch (err) {
      r.errors.push(`stackexchange "${query}": ${(err as Error).message}`);
    }
  }
  return out;
}

async function fetchPlatform(
  platform: Platform,
  ctx: BusinessContext,
  r: DiscoverResult,
): Promise<ScrapedPost[]> {
  switch (platform) {
    case "reddit":
      return fetchReddit(ctx, r);
    case "facebook":
      return fetchFacebook(ctx, r);
    case "hackernews":
      return fetchHackerNews(ctx, r);
    case "stackexchange":
      return fetchStackExchange(ctx, r);
    default:
      return []; // instagram is engagement-only, threads has no working source
  }
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

/**
 * One discovery pass: pull candidate posts from every enabled discovery
 * platform, drop the stale and the already-seen, score the rest on relevance
 * AND intent, and queue only what clears both thresholds for human approval.
 */
export async function runDiscovery(
  opts: { platforms?: Platform[] } = {},
): Promise<DiscoverResult> {
  const ctx = loadBusinessContext();
  const r = emptyResult();
  await ensureHeader();

  const intentFloor = ctx.intent_threshold ?? 0.6;
  const enabled = (opts.platforms ?? DISCOVERY_PLATFORMS).filter(
    (p) => ctx.platforms[p]?.enabled,
  );

  for (const platform of enabled) {
    if (r.analyzed >= MAX_ANALYZE) {
      r.errors.push(`hit MAX_ANALYZE_PER_RUN (${MAX_ANALYZE}); skipping remaining platforms`);
      break;
    }

    const posts = await fetchPlatform(platform, ctx, r);
    r.fetched += posts.length;

    for (const post of posts) {
      if (!isFresh(post.posted_at, MAX_POST_AGE_DAYS)) {
        r.stale++;
        continue;
      }
      if (alreadySeen(post.platform, post.external_id)) {
        r.skippedDuplicate++;
        continue;
      }
      if (r.analyzed >= MAX_ANALYZE) {
        r.errors.push(`hit MAX_ANALYZE_PER_RUN (${MAX_ANALYZE}); remaining posts deferred`);
        break;
      }

      let ai;
      try {
        ai = await analyzePost(ctx, post);
      } catch (err) {
        r.errors.push(`ai ${post.url}: ${(err as Error).message}`);
        continue;
      }
      r.analyzed++;

      // Both axes must clear. A seller posting perfectly on-topic content is
      // the exact failure this gate exists to catch.
      if (
        !ai.relevant ||
        ai.relevance < ctx.relevance_threshold ||
        ai.intent < intentFloor ||
        ai.actor === "seller"
      ) {
        r.belowThreshold++;
        continue;
      }

      const id = insertCandidate(post, ai);
      if (id) {
        r.queued++;
        r.byPlatform[platform] = (r.byPlatform[platform] ?? 0) + 1;
        const cand = getCandidate(id);
        if (cand) await logActivity(cand, "discovered");
      }
    }
  }

  return r;
}
