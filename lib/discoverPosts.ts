import { searchReddit, fetchReplies as redditReplies } from "@/lib/sources/arcticshift";
import { searchHackerNews, fetchReplies as hnReplies } from "@/lib/sources/hackernews";
import { searchStackOverflow, fetchReplies as seReplies } from "@/lib/sources/stackexchange";
import { groupPosts, searchPosts, fetchReplies as fbReplies } from "@/lib/sources/socialapis";
import { isFresh, sleep } from "@/lib/sources/http";
import { intentQueriesFor, primaryIntentQuery } from "@/lib/intent";
import { isPromotionalPost, hasBuyerSignal, categorize } from "@/lib/sellerFilter";
import { CATEGORY_BUYER } from "@/lib/types";
import type { BusinessContext, Platform, ScrapedPost, SourceResult } from "@/lib/types";

/**
 * The fetch half of a live lookup, shared by the legacy analyze-everything
 * route and the new fetch-only route. Deliberately contains no AI: pulling
 * posts is cheap (and free on three of the four sources), analyzing them is
 * not, so the two halves are separated and the AI call is paid for per click.
 */

// Diagnostic logging (65018db) measured raw=41-103 candidates for real topics
// ("lead generation", "marketing automation") with fresh=0 -- every single
// one died at this cutoff, not at the seller/buyer-signal filters below it.
// HN's search is already date-sorted (see hackernews.ts), so those 30 hits
// per query genuinely are the most recent HN has, and they're still >14 days
// old: this topic space just doesn't post that often. 14 was too tight for
// the actual posting frequency; widened to 30.
const MAX_POST_AGE_DAYS = Number(process.env.MAX_POST_AGE_DAYS ?? 30);
/** Default page size. One `claude` CLI child process each for the legacy route. */
export const MAX_RESULTS = 5;
/**
 * Arctic Shift full-text search measures ~13s per subreddit and searchReddit
 * walks them serially with a deliberate 1.5s gap between each (free
 * volunteer-run archive, and burst load is not ours to add). The full
 * configured list is ~3 minutes on its own, so a live lookup takes the first
 * couple and abandons the source entirely if even that overruns.
 */
// Arctic Shift measures ~13s/subreddit, so 2 subreddits is 27-32s measured.
// Widened back to 2 (raw supply was the bottleneck, not the timeout) with the
// budget raised to match, plus margin — still well inside the route's 60s
// maxDuration since sources run concurrently, not added end to end.
const MAX_LIVE_SUBREDDITS = 2;
const REDDIT_BUDGET_MS = 40_000;
/**
 * Facebook has two sources, and which one runs depends only on whether any
 * group URLs are configured:
 *
 *   groups configured  `groupPosts` — cheaper per post (~1 credit per 3),
 *                      real timestamps, but a group's whole unfiltered feed,
 *                      so `matchesTopic` has to do the topic filtering.
 *   no groups          `searchPosts` — keyword search, so the topic filter is
 *                      the vendor's; worse per credit and no timestamps, but
 *                      the alternative is Facebook returning nothing at all.
 *
 * Either way one SocialAPIs HTTP call per search is a hard cost ceiling, not a
 * tuning knob: one group (MAX_LIVE_GROUPS) or one search, and both pass
 * `retries: 0` to getJson so a misbehaving vendor cannot triple the bill. The
 * same time budget as Reddit applies on top.
 */
const MAX_LIVE_GROUPS = 1;
const FACEBOOK_BUDGET_MS = 20_000;

/**
 * Deep-reply surfacing (second pass). Hon's case is a thread whose 11th reply,
 * not the parent post, is the one worth answering — so each shortlisted post's
 * comments are fetched and filtered individually.
 *
 * This runs ONLY on the shortlist that already survived
 * isFresh -> isPromotionalPost -> hasBuyerSignal. The raw pool is 41-103
 * candidates per topic (see the diagnostic above); one extra round trip for
 * each of those would blow every budget on every source, and on Facebook would
 * bill a credit for each. Per-platform caps below bound it further, hardest on
 * the only source that charges.
 */
const REPLY_BUDGET_MS = 12_000;
const REDDIT_COURTESY_MS = 1500;
const MAX_REPLY_POSTS: Record<Platform, number> = {
  hackernews: 5, // one free call, whole tree
  stackexchange: 5, // one free call, but shared 300/day anonymous quota
  reddit: 3, // free, but 1.5s courtesy gap each
  // 1 SocialAPIs credit each — the only source that charges. The deadline
  // below is only checked BEFORE a call, and an abandoned in-flight call still
  // bills, so socialapis.ts's own comment timeout is set so that this many
  // back-to-back calls still fit inside REPLY_BUDGET_MS. Raising this number
  // means lowering that timeout to match.
  facebook: 2,
  instagram: 0, // discovery-excluded
  threads: 0, // no working discovery source
};

/** One source, never fatal: a dead source must not take the other two down. */
async function safeSearch(
  label: string,
  run: () => Promise<SourceResult>,
): Promise<ScrapedPost[]> {
  try {
    return (await run()).posts;
  } catch (err) {
    console.error(`discover ${label}: ${(err as Error).message}`);
    return [];
  }
}

/**
 * groupPosts has no query param, so this is the only topic filter Facebook
 * results get. Same crude substring approach the other sources' own keyword
 * search already relies on — good enough not to burn an AI call, and a
 * credit, on a post about something else entirely.
 */
function matchesTopic(post: ScrapedPost, topic: string): boolean {
  const text = `${post.title ?? ""} ${post.body}`.toLowerCase();
  const t = topic.toLowerCase().trim();
  const words = t.split(/\s+/).filter((w) => w.length >= 3);
  // Short topics ("AI", "SEO") have no word ≥3 chars — fall back to matching
  // the raw topic instead of letting every post through unfiltered.
  return words.length === 0 ? text.includes(t) : words.some((w) => text.includes(w));
}

/** Recent posts from the first few configured Facebook groups, cost-logged. */
async function fetchFacebookGroups(groups: string[], after: Date): Promise<ScrapedPost[]> {
  const results = await Promise.all(
    groups.slice(0, MAX_LIVE_GROUPS).map(async (group) => {
      try {
        const res = await groupPosts(group, { limit: 9, afterTime: after });
        console.log(`discover facebook ${group}: ${res.unitsCharged} SocialAPIs credit(s)`);
        return res.posts;
      } catch (err) {
        console.error(`discover facebook ${group}: ${(err as Error).message}`);
        return [];
      }
    }),
  );
  return results.flat();
}

/**
 * Keyword search, for when no group is configured. `q` already went to the
 * vendor as the query, so no matchesTopic pass. Runs each query as its own
 * billable call (SocialAPIs charges ~1 credit/call) in parallel, so 2 queries
 * costs 2x credits but not 2x time.
 */
async function fetchFacebookSearch(queries: string[]): Promise<ScrapedPost[]> {
  const results = await Promise.all(
    queries.map(async (q) => {
      try {
        const res = await searchPosts(q);
        console.log(`discover facebook search:${q}: ${res.unitsCharged} SocialAPIs credit(s)`);
        return res.posts;
      } catch (err) {
        console.error(`discover facebook search:${q}: ${(err as Error).message}`);
        return [];
      }
    }),
  );
  return results.flat();
}

/**
 * Comments/answers on the shortlisted posts, normalized to ScrapedPost and run
 * back through the same deterministic gates the parent posts passed. A parent
 * passing says nothing about its replies: the signal Hon is after may live only
 * in one comment, so every gate is re-applied per reply rather than inherited.
 *
 * No AI here either. Same regex filters, nothing else.
 */
async function surfaceReplies(shortlist: ScrapedPost[], topic: string): Promise<ScrapedPost[]> {
  const deadline = Date.now() + REPLY_BUDGET_MS;
  const byPlatform = new Map<Platform, ScrapedPost[]>();
  for (const p of shortlist) {
    const bucket = byPlatform.get(p.platform) ?? [];
    if (bucket.length < MAX_REPLY_POSTS[p.platform]) bucket.push(p);
    byPlatform.set(p.platform, bucket);
  }

  /** One post's replies, never fatal: a dead thread must not kill the pass. */
  const safe = async (p: ScrapedPost, run: () => Promise<ScrapedPost[]>) => {
    try {
      return await run();
    } catch (err) {
      console.error(`replies ${p.platform} ${p.url}: ${(err as Error).message}`);
      return [];
    }
  };

  const lanes: Promise<ScrapedPost[]>[] = [];
  // Free, one call each, no rate courtesy owed — run them all at once.
  for (const p of byPlatform.get("hackernews") ?? []) lanes.push(safe(p, () => hnReplies(p)));
  for (const p of byPlatform.get("stackexchange") ?? []) lanes.push(safe(p, () => seReplies(p)));
  // Reddit: serial, keeping the same 1.5s courtesy gap the search path uses.
  // This is a free volunteer-run archive; burst load is not ours to add.
  lanes.push(
    (async () => {
      const out: ScrapedPost[] = [];
      for (const p of byPlatform.get("reddit") ?? []) {
        if (Date.now() > deadline) break;
        out.push(...(await safe(p, () => redditReplies(p))));
        await sleep(REDDIT_COURTESY_MS);
      }
      return out;
    })(),
  );
  // Facebook last and capped hardest: serial, so a run that overruns the
  // deadline stops buying credits instead of firing the rest in parallel.
  lanes.push(
    (async () => {
      const out: ScrapedPost[] = [];
      for (const p of byPlatform.get("facebook") ?? []) {
        if (Date.now() > deadline) break;
        out.push(
          ...(await safe(p, async () => {
            const res = await fbReplies(p);
            console.log(`replies facebook ${p.url}: ${res.unitsCharged} SocialAPIs credit(s)`);
            return res.posts;
          })),
        );
      }
      return out;
    })(),
  );

  // Cap each lane rather than the whole pass, so one hung source costs its own
  // replies and not everyone else's. Losing replies is survivable; the parent
  // posts are already in hand either way.
  const replies = (
    await Promise.all(
      lanes.map((l) => Promise.race([l, sleep(REPLY_BUDGET_MS).then(() => [] as ScrapedPost[])])),
    )
  ).flat();

  const kept = replies.filter(
    (r) =>
      isFresh(r.posted_at, MAX_POST_AGE_DAYS) &&
      matchesTopic(r, topic) &&
      !isPromotionalPost(r) &&
      hasBuyerSignal(r),
  );
  console.log(`discover replies "${topic}": fetched=${replies.length} kept=${kept.length}`);
  return kept;
}

/**
 * Fresh posts on `topic` across every enabled discovery source, newest first.
 * Never throws for a source failure: an empty array is a normal answer.
 */
export async function discoverPosts(
  topic: string,
  ctx: BusinessContext,
  { limit = MAX_RESULTS }: { limit?: number } = {},
): Promise<ScrapedPost[]> {
  const q = topic.trim();

  // The literal topic surfaces whoever publishes about it, which is
  // overwhelmingly sellers/marketers SEO'd around that exact phrase, not
  // buyers -- so it is never sent to any source, not even alongside better
  // phrasing (an earlier version kept it for HN/Stack Exchange "for volume";
  // dropped after client feedback that literal-keyword results still leaked
  // through). `primaryIntentQuery` wraps the topic in the single best
  // struggling/recommendation-seeking phrasing for the sources that can only
  // afford one query (Reddit's rate courtesy, Facebook's paid credit); the
  // free, fast sources (HN, Stack Exchange) get six buyer-phrased variants
  // instead of one, since there's no cost reason to hold back there. Raw
  // supply per topic was the bottleneck (2-4 candidates before filtering, so
  // 5354769's buyer-signal filter often had nothing left to keep) -- more
  // query variants is the direct fix. See lib/intent.ts.
  const buyerQuery = primaryIntentQuery(q, ctx);
  const hnSeQueries = intentQueriesFor(q, ctx, 6);
  const fbQueries = intentQueriesFor(q, ctx, 2);

  // Only sources with real free-text keyword search reach the caller without a
  // local topic filter. Arctic Shift's `query` needs a subreddit to scope to;
  // Facebook's group feed has no query at all, so those posts are filtered by
  // matchesTopic below instead of by the vendor.
  const reddit = ctx.platforms?.reddit;
  const facebook = ctx.platforms?.facebook;
  const after = new Date(Date.now() - MAX_POST_AGE_DAYS * 86400_000);
  const hackernews = ctx.platforms?.hackernews;
  const stackexchange = ctx.platforms?.stackexchange;
  const searches: Promise<ScrapedPost[]>[] = [];
  if (hackernews?.enabled) {
    searches.push(
      ...hnSeQueries.map((hq) => safeSearch(`hackernews:${hq}`, () => searchHackerNews(hq))),
    );
  }
  if (stackexchange?.enabled) {
    searches.push(
      ...hnSeQueries.map((hq) => safeSearch(`stackexchange:${hq}`, () => searchStackOverflow(hq))),
    );
  }
  if (reddit?.enabled && (reddit.subreddits?.length ?? 0) > 0) {
    searches.push(
      Promise.race([
        safeSearch("reddit", () =>
          searchReddit(buyerQuery, { subreddits: reddit.subreddits!.slice(0, MAX_LIVE_SUBREDDITS) }),
        ),
        new Promise<ScrapedPost[]>((r) => setTimeout(() => r([]), REDDIT_BUDGET_MS)),
      ]),
    );
  }
  if (facebook?.enabled) {
    const fb =
      (facebook.groups?.length ?? 0) > 0
        ? fetchFacebookGroups(facebook.groups!, after).then((posts) =>
            posts.filter((p) => matchesTopic(p, q)),
          )
        : fetchFacebookSearch(fbQueries);
    searches.push(
      Promise.race([
        fb,
        new Promise<ScrapedPost[]>((r) => setTimeout(() => r([]), FACEBOOK_BUDGET_MS)),
      ]),
    );
  }

  // Logged at each stage so a thin result set can be diagnosed (raw supply vs
  // filter loss, and which source it came from) from function logs instead of
  // guessed at.
  const raw = (await Promise.all(searches)).flat();
  const byPlatform: Record<string, number> = {};
  for (const p of raw) byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1;
  const isFreshOnly = raw.filter((p) => isFresh(p.posted_at, MAX_POST_AGE_DAYS));
  const notPromo = isFreshOnly.filter((p) => !isPromotionalPost(p));

  // Dedupe on external_id. Two sources can surface the same thread (an HN story
  // whose URL is a Reddit post, a group post reposted), and the caller renders
  // one card per post, so a duplicate is visible to the user. Deduping BEFORE
  // the reply pass also stops the same thread's comments being fetched twice.
  //
  // Results are everything non-promotional, not just the buyer-signal subset
  // the old version returned. Hon asked for two buckets on the page — people
  // asking for something, and people merely talking about the topic — so the
  // no-buyer-signal half has to reach the page to be labelled at all. The
  // buyer-signal subset is still what the reply pass and the sort prioritise,
  // so nothing that used to surface stops surfacing.
  const byId = new Map<string, ScrapedPost>();
  for (const p of notPromo) {
    if (!byId.has(p.external_id)) byId.set(p.external_id, { ...p, category: categorize(p) });
  }

  // Second pass: comments on the posts that carry a buyer signal, which is the
  // isFresh -> isPromotionalPost -> hasBuyerSignal survivors and nothing else.
  const shortlist = Array.from(byId.values()).filter((p) => p.category === CATEGORY_BUYER);
  console.log(
    `discover "${q}": raw=${raw.length} (${JSON.stringify(byPlatform)}) fresh=${isFreshOnly.length} notPromo=${notPromo.length} buyerSignal=${shortlist.length}`,
  );
  for (const r of await surfaceReplies(shortlist, q)) {
    if (!byId.has(r.external_id)) byId.set(r.external_id, { ...r, category: categorize(r) });
  }

  // Dated posts sort newest first, buyer signal ahead of general conversation
  // so widening the pool cannot push a lead off the page. Undated posts
  // (Facebook search results and Facebook comments, which the vendor returns
  // with no timestamp) get a reserved share of the slice instead of being
  // sorted as "equal" to everything: a stable sort leaves them stranded behind
  // any full page of dated results, so Facebook could bill a credit and still
  // render zero cards.
  const deduped = Array.from(byId.values());
  const rank = (p: ScrapedPost) => (p.category === CATEGORY_BUYER ? 0 : 1);
  const dated = deduped
    .filter((p) => p.posted_at !== undefined)
    .sort((a, b) => rank(a) - rank(b) || Date.parse(b.posted_at!) - Date.parse(a.posted_at!));
  const undated = deduped
    .filter((p) => p.posted_at === undefined)
    .sort((a, b) => rank(a) - rank(b));
  const reserved = Math.min(undated.length, 2, limit);
  return [...dated.slice(0, limit - reserved), ...undated.slice(0, reserved)];
}
