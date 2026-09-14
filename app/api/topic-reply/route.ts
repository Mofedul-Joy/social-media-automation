import { NextResponse } from "next/server";
import { loadBusinessContext } from "@/lib/config";
import { analyzePost } from "@/lib/analyzeClient";
import { discoverPosts } from "@/lib/discoverPosts";
import type { ScrapedPost } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Legacy one-shot lookup: a typed topic in, a handful of drafted comments back,
 * inside a 60s budget. Results are ephemeral — nothing is persisted. The analyze
 * calls run in parallel (each one a round trip to the VPS worker), so total
 * latency is roughly one call (~14s), not MAX_RESULTS of them.
 *
 * Superseded by topic-search + analyze-post, which only spend an AI call on the
 * post the human actually picks. Nothing in the UI calls this any more, but the
 * response contract is kept exactly as it was for anything still pointed at it.
 */

const MAX_TOPIC_LEN = 200;
/** Posts analyzed per lookup. Each is a concurrent `claude` CLI child process. */
const MAX_RESULTS = 5;

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

  const posts = await discoverPosts(q, ctx, { limit: MAX_RESULTS });

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
