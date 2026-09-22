import { NextResponse } from "next/server";
import { listNotifications, markSeen, unreadCount } from "@/lib/replies";

export const dynamic = "force-dynamic";

/**
 * The reply-notification feed behind the bell.
 *
 * Same contract as /api/saved: a GET against an unreachable store answers 200
 * with an empty feed and `unavailable: true`, because the bell sits in the
 * chrome of every page and a dead store must not put an error banner on a page
 * whose actual job still works. A write that cannot land answers 503 with an
 * honest message instead — silently dropping "mark as read" would be a lie,
 * and the badge would just come back.
 *
 * Every branch returns JSON and nothing throws out of a handler: Next answers
 * an uncaught throw with a bare 500 and a zero-byte body, which the browser
 * then fails to parse.
 */

const MARK_UNAVAILABLE =
  "Could not mark as read — the notification store is unreachable. Nothing was changed.";

/** GET -> { unread, replies } | { unread: 0, replies: [], unavailable: true } */
export async function GET() {
  try {
    const [unread, replies] = await Promise.all([unreadCount(), listNotifications()]);
    return NextResponse.json({ unread, replies });
  } catch (err) {
    console.error(`GET /api/notifications: ${(err as Error).message}`);
    return NextResponse.json({ unread: 0, replies: [], unavailable: true });
  }
}

/** PATCH body: { ids?: string[] } — no ids (or an empty array) marks everything unseen as read. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Validated here rather than left to lib/replies so a bad body is a 400 and
  // an unreachable store is a 503; the store cannot tell us which it was.
  let ids: string[] | undefined;
  if (body.ids !== undefined && body.ids !== null) {
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== "string")) {
      return NextResponse.json(
        { ok: false, error: "ids must be an array of strings" },
        { status: 400 },
      );
    }
    ids = body.ids as string[];
  }

  try {
    await markSeen(ids);
    return NextResponse.json({ ok: true, unread: await unreadCount() });
  } catch (err) {
    console.error(`PATCH /api/notifications: ${(err as Error).message}`);
    return NextResponse.json(
      { ok: false, unavailable: true, error: MARK_UNAVAILABLE },
      { status: 503 },
    );
  }
}
