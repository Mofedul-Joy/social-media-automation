import { NextResponse } from "next/server";
import { loadBusinessContext } from "@/lib/config";
import { discoverPosts } from "@/lib/discoverPosts";
import { recordTopic } from "@/lib/topics";
import { recordDiscoveryCounts } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fetch only. No AI, no credits beyond the one capped SocialAPIs call the
 * discovery lane may make. This exists so typing a topic is cheap: the user
 * sees the raw posts, and only the one they click costs an AI call, over on
 * /api/analyze-post.
 *
 * Full ScrapedPost objects go back, `body` included, because the browser posts
 * the chosen one straight to the analyze route rather than making the server
 * re-fetch a post it already had.
 */

const MAX_TOPIC_LEN = 200;
/** Wider than the legacy route's 5: listing is cheap, so show more to choose from. */
const MAX_RESULTS = 10;

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
  // Remembered before discovery runs, not after: the user searched this topic
  // whether or not anything came back, and a discovery failure is exactly the
  // search they are most likely to want to retry from the list. Awaited so it
  // cannot be cut off by the function freezing, and swallowed so a missing
  // `search_topics` table degrades to "no saved list" instead of breaking the
  // search itself.
  try {
    await recordTopic(q);
  } catch (err) {
    console.error(`POST /api/topic-search: could not record topic: ${(err as Error).message}`);
  }
  // A Supabase read can throw (see lib/config.ts); without a catch here Next
  // answers with a bare 500 and a zero-byte body, same failure /api/config had.
  try {
    const ctx = await loadBusinessContext();
    // Not a failure: "nothing live on this topic right now" is a normal answer,
    // so an empty list is a 200 and the UI renders its own empty state.
    const posts = await discoverPosts(q, ctx, { limit: MAX_RESULTS });
    // Recorded here because this is the only moment the numbers exist: the
    // posts go to the browser and are never persisted, so a count not taken now
    // can never be reconstructed. Awaited so it cannot be cut off by the
    // function freezing, and swallowed for the same reason recordTopic is — a
    // missing `discovery_counts` table or a failed foreign key must degrade to
    // "no analytics", never to a broken search.
    try {
      await recordDiscoveryCounts(q, posts);
    } catch (err) {
      console.error(
        `POST /api/topic-search: could not record discovery counts: ${(err as Error).message}`,
      );
    }
    return NextResponse.json({ topic: q, posts });
  } catch (err) {
    console.error(`POST /api/topic-search: ${(err as Error).message}`);
    return NextResponse.json(
      { error: `search unavailable: ${(err as Error).message}` },
      { status: 503 },
    );
  }
}
