import { NextResponse } from "next/server";
import { listNotifications, pollSavedPosts, unreadCount } from "@/lib/replies";

export const dynamic = "force-dynamic";
/** Outbound HTTP to up to four sources, serial within each — the default 10s is not enough. */
export const maxDuration = 60;

/**
 * Check every saved post for new replies, then hand back the fresh feed.
 *
 * Triggered by a page open and by a manual refresh button, and by nothing
 * else: there is deliberately no cron and no VPS worker for this. The cooldown
 * inside `pollSavedPosts` is what keeps a reload loop from re-hitting every
 * source (and re-spending Facebook credits), so a caller may fire this freely.
 *
 * The response carries `stats`, the unread count AND the feed, so the client
 * needs one round trip rather than three. A source that failed is reported in
 * `stats.errors` with a 200 — the run still did the rest of its work. Only an
 * unreachable store is a 503.
 */

const POLL_UNAVAILABLE =
  "Could not check for replies — the notification store is unreachable. Nothing was changed.";

/** POST body: { force?: boolean } — force bypasses the per-post poll cooldown. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const force = body.force === true;

  try {
    const stats = await pollSavedPosts({ force });
    const [unread, replies] = await Promise.all([unreadCount(), listNotifications()]);
    return NextResponse.json({ ok: true, stats, unread, replies });
  } catch (err) {
    console.error(`POST /api/notifications/poll: ${(err as Error).message}`);
    return NextResponse.json(
      { ok: false, unavailable: true, error: POLL_UNAVAILABLE },
      { status: 503 },
    );
  }
}
