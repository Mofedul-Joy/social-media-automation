import { NextResponse } from "next/server";
import { listTopics } from "@/lib/topics";

export const dynamic = "force-dynamic";

/**
 * The saved-topic list, newest-first. Read-only: topics are written by the
 * search itself (`/api/topic-search`), never by the browser, so there is no
 * POST here — nothing outside a real search may add a row.
 *
 * An unreachable store answers 200 with an empty list and `unavailable: true`
 * rather than an error status. This list is a convenience on top of the search
 * page; failing it loudly would put an error banner on a page whose actual job
 * — searching — still works perfectly. The flag exists so the failure is still
 * visible to anyone looking, and the real cause is in the function logs.
 */
export async function GET() {
  try {
    return NextResponse.json({ topics: await listTopics() });
  } catch (err) {
    console.error(`GET /api/topics: ${(err as Error).message}`);
    return NextResponse.json({ topics: [], unavailable: true });
  }
}
