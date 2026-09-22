import { NextResponse } from "next/server";
import { loadAnalytics, EMPTY_ANALYTICS } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/**
 * Everything the dashboard shows, in one response: the totals, the category
 * breakdown, the platform breakdown, and the per-topic leaderboard. Read-only —
 * counts are written by the search itself (`/api/topic-search`), never by the
 * browser, so there is no POST here.
 *
 * Every figure is computed in SQL by the views in
 * `migrations/005_discovery_counts.sql`. Nothing is summed here and nothing is
 * summed in the browser.
 *
 * An unreachable store answers 200 with zeroed totals, empty lists and
 * `unavailable: true`, exactly like /api/topics and /api/saved. The flag is the
 * point: the dashboard must be able to tell "nothing has happened yet" apart
 * from "the store is down", because the two look identical in the numbers and
 * showing the second as the first would be a fabricated zero. The real cause is
 * in the function logs.
 */
export async function GET() {
  try {
    return NextResponse.json(await loadAnalytics());
  } catch (err) {
    console.error(`GET /api/analytics: ${(err as Error).message}`);
    return NextResponse.json({ ...EMPTY_ANALYTICS, unavailable: true });
  }
}
