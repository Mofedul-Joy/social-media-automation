import { searchReddit } from "@/lib/sources/arcticshift";
import { searchHackerNews } from "@/lib/sources/hackernews";
import { searchStackOverflow } from "@/lib/sources/stackexchange";
import { groupPosts, searchPosts } from "@/lib/sources/socialapis";
import { isFresh } from "@/lib/sources/http";
import type { BusinessContext, ScrapedPost, SourceResult } from "@/lib/types";

/**
 * The fetch half of a live lookup, shared by the legacy analyze-everything
 * route and the new fetch-only route. Deliberately contains no AI: pulling
 * posts is cheap (and free on three of the four sources), analyzing them is
 * not, so the two halves are separated and the AI call is paid for per click.
 */

const MAX_POST_AGE_DAYS = Number(process.env.MAX_POST_AGE_DAYS ?? 14);
/** Default page size. One `claude` CLI child process each for the legacy route. */
export const MAX_RESULTS = 5;
/**
 * Arctic Shift full-text search measures ~13s per subreddit and searchReddit
 * walks them serially with a deliberate 1.5s gap between each (free
 * volunteer-run archive, and burst load is not ours to add). The full
 * configured list is ~3 minutes on its own, so a live lookup takes the first
 * couple and abandons the source entirely if even that overruns.
 */
// Arctic Shift measures ~13s/subreddit; 2 subreddits (27-32s measured) blows
// the 20s budget below almost every time, so the race's timeout branch wins
// and Reddit silently returns []. 1 subreddit fits inside the budget.
const MAX_LIVE_SUBREDDITS = 1;
const REDDIT_BUDGET_MS = 20_000;
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
 * Keyword search, for when no group is configured. Exactly one call, so no
 * matchesTopic pass: `q` already went to the vendor as the query.
 */
async function fetchFacebookSearch(q: string): Promise<ScrapedPost[]> {
  try {
    const res = await searchPosts(q);
    console.log(`discover facebook search:${q}: ${res.unitsCharged} SocialAPIs credit(s)`);
    return res.posts;
  } catch (err) {
    console.error(`discover facebook search:${q}: ${(err as Error).message}`);
    return [];
  }
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

  // Only sources with real free-text keyword search reach the caller without a
  // local topic filter. Arctic Shift's `query` needs a subreddit to scope to;
  // Facebook's group feed has no query at all, so those posts are filtered by
  // matchesTopic below instead of by the vendor.
  const reddit = ctx.platforms?.reddit;
  const facebook = ctx.platforms?.facebook;
  const after = new Date(Date.now() - MAX_POST_AGE_DAYS * 86400_000);
  const searches = [
    safeSearch("hackernews", () => searchHackerNews(q)),
    safeSearch("stackexchange", () => searchStackOverflow(q)),
  ];
  if (reddit?.enabled && (reddit.subreddits?.length ?? 0) > 0) {
    searches.push(
      Promise.race([
        safeSearch("reddit", () =>
          searchReddit(q, { subreddits: reddit.subreddits!.slice(0, MAX_LIVE_SUBREDDITS) }),
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
        : fetchFacebookSearch(q);
    searches.push(
      Promise.race([
        fb,
        new Promise<ScrapedPost[]>((r) => setTimeout(() => r([]), FACEBOOK_BUDGET_MS)),
      ]),
    );
  }

  const fresh = (await Promise.all(searches))
    .flat()
    .filter((p) => isFresh(p.posted_at, MAX_POST_AGE_DAYS));

  // Dedupe on external_id. Two sources can surface the same thread (an HN story
  // whose URL is a Reddit post, a group post reposted), and the caller now
  // renders one card per post, so a duplicate is visible to the user.
  const byId = new Map<string, ScrapedPost>();
  for (const p of fresh) if (!byId.has(p.external_id)) byId.set(p.external_id, p);

  // Dated posts sort newest first. Undated posts (Facebook search results,
  // which the vendor returns with no timestamp) get a reserved share of the
  // slice instead of being sorted as "equal" to everything: a stable sort
  // leaves them stranded behind any full page of dated results, so Facebook
  // could bill a credit and still render zero cards.
  const deduped = Array.from(byId.values());
  const dated = deduped
    .filter((p) => p.posted_at !== undefined)
    .sort((a, b) => Date.parse(b.posted_at!) - Date.parse(a.posted_at!));
  const undated = deduped.filter((p) => p.posted_at === undefined);
  const reserved = Math.min(undated.length, 2, limit);
  return [...dated.slice(0, limit - reserved), ...undated.slice(0, reserved)];
}
