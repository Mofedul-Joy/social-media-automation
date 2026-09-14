import { NextResponse } from "next/server";
import { loadBusinessContext } from "@/lib/config";
import { analyzePost } from "@/lib/analyzeClient";
import { searchReddit } from "@/lib/sources/arcticshift";
import { searchHackerNews } from "@/lib/sources/hackernews";
import { searchStackOverflow } from "@/lib/sources/stackexchange";
import { groupPosts } from "@/lib/sources/socialapis";
import { isFresh } from "@/lib/sources/http";
import type { ScrapedPost, SourceResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Live one-off lookup: a typed topic in, a handful of drafted comments back,
 * inside a 60s budget. Results are ephemeral — nothing is persisted. The analyze
 * calls run in parallel (each one a round trip to the VPS worker), so total
 * latency is roughly one call (~14s), not MAX_RESULTS of them.
 */

const MAX_POST_AGE_DAYS = Number(process.env.MAX_POST_AGE_DAYS ?? 14);
const MAX_TOPIC_LEN = 200;
/** Posts analyzed per lookup. Each is a concurrent `claude` CLI child process. */
const MAX_RESULTS = 5;
/**
 * Arctic Shift full-text search measures ~13s per subreddit and searchReddit
 * walks them serially with a deliberate 1.5s gap between each (free
 * volunteer-run archive, and burst load is not ours to add). The full
 * configured list is ~3 minutes on its own, so a live lookup takes the first
 * couple and abandons the source entirely if even that overruns.
 */
const MAX_LIVE_SUBREDDITS = 2;
const REDDIT_BUDGET_MS = 20_000;
/**
 * Facebook has no keyword search (`socialapis.ts`'s `searchPosts` is for
 * locating groups, not routine polling — expensive, no timestamps). The only
 * usable call, `groupPosts`, returns a group's recent posts unfiltered and
 * costs real SocialAPIs credits (~1 per 3 posts) every time it's called — so
 * a live lookup caps how many groups it burns credits on per request, and
 * applies the same time budget as Reddit.
 */
const MAX_LIVE_GROUPS = 3;
const FACEBOOK_BUDGET_MS = 20_000;

/** One source, never fatal: a dead source must not take the other two down. */
async function safeSearch(
  label: string,
  run: () => Promise<SourceResult>,
): Promise<ScrapedPost[]> {
  try {
    return (await run()).posts;
  } catch (err) {
    console.error(`topic-reply ${label}: ${(err as Error).message}`);
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
        console.log(`topic-reply facebook ${group}: ${res.unitsCharged} SocialAPIs credit(s)`);
        return res.posts;
      } catch (err) {
        console.error(`topic-reply facebook ${group}: ${(err as Error).message}`);
        return [];
      }
    }),
  );
  return results.flat();
}

/** Body: { topic: string } */
export async function POST(req: Request) {
  const { topic } = await req.json().catch(() => ({ topic: null }));
  if (typeof topic !== "string" || !topic.trim() || topic.length > MAX_TOPIC_LEN) {
    return NextResponse.json(
      { error: `topic must be a non-empty string up to ${MAX_TOPIC_LEN} characters` },
      { status: 400 },
    );
  }
  const q = topic.trim();
  const ctx = await loadBusinessContext();

  // Only sources with real free-text keyword search reach the AI without a
  // local topic filter. Arctic Shift's `query` needs a subreddit to scope to;
  // Facebook has no query at all, so its posts are filtered by matchesTopic
  // below instead of by the vendor.
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
  if (facebook?.enabled && (facebook.groups?.length ?? 0) > 0) {
    searches.push(
      Promise.race([
        fetchFacebookGroups(facebook.groups!, after).then((posts) =>
          posts.filter((p) => matchesTopic(p, q)),
        ),
        new Promise<ScrapedPost[]>((r) => setTimeout(() => r([]), FACEBOOK_BUDGET_MS)),
      ]),
    );
  }

  // Most recent fresh posts across all sources. Undated posts sort last.
  const posts = (await Promise.all(searches))
    .flat()
    .filter((p) => isFresh(p.posted_at, MAX_POST_AGE_DAYS))
    .sort((a, b) => Date.parse(b.posted_at ?? "") - Date.parse(a.posted_at ?? "") || 0)
    .slice(0, MAX_RESULTS);

  // Not a failure: "nothing live on this topic right now" is a normal answer.
  if (posts.length === 0) return NextResponse.json({ found: false, topic: q, results: [] });

  const settled = await Promise.all(
    posts.map(async (post) => {
      try {
        return { post, analysis: await analyzePost(ctx, post) };
      } catch (err) {
        // One bad analyze drops its own card; the rest of the request stands.
        console.error(`topic-reply ai ${post.url}: ${(err as Error).message}`);
        return null;
      }
    }),
  );

  // Intent floor, so sellers and other high-relevance/low-intent noise never
  // show as "worth replying to."
  const intentFloor = ctx.intent_threshold ?? 0.6;
  const results = settled
    .filter((r): r is { post: ScrapedPost; analysis: Awaited<ReturnType<typeof analyzePost>> } =>
      r !== null &&
      r.analysis.relevant &&
      r.analysis.relevance >= ctx.relevance_threshold &&
      r.analysis.intent >= intentFloor,
    )
    .map(({ post, analysis }) => ({
      post: {
        platform: post.platform,
        url: post.url,
        title: post.title ?? null,
        author: post.author ?? null,
        posted_at: post.posted_at ?? null,
      },
      analysis,
    }));

  return NextResponse.json({ found: true, topic: q, results });
}
