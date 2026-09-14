import { NextResponse } from "next/server";
import { loadBusinessContext } from "@/lib/config";
import { discoverPosts } from "@/lib/discoverPosts";

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
  const ctx = await loadBusinessContext();

  // Not a failure: "nothing live on this topic right now" is a normal answer,
  // so an empty list is a 200 and the UI renders its own empty state.
  const posts = await discoverPosts(q, ctx, { limit: MAX_RESULTS });
  return NextResponse.json({ topic: q, posts });
}
