import { NextResponse } from "next/server";
import type { Platform } from "@/lib/types";
import {
  listSaved,
  savePost,
  unsavePost,
  SAVEABLE_PLATFORMS,
  MAX_URL_LEN,
} from "@/lib/savedPosts";

export const dynamic = "force-dynamic";

/**
 * The saved-post list: bookmarks a human made on the search results page.
 *
 * Nothing here may ever break that page. A GET against an unreachable store
 * answers 200 with an empty list and `unavailable: true`, exactly like
 * /api/topics — saving is a convenience on top of searching, and failing it
 * loudly would put an error banner on a page whose actual job still works. A
 * write that cannot land is different: it answers 503 with an honest message,
 * because silently dropping a save would be a lie.
 *
 * Every branch returns JSON and nothing throws out of a handler. Next answers
 * an uncaught throw with a bare 500 and a zero-byte body, which the browser
 * then fails to parse — the same failure /api/config and /api/topic-search
 * were already bitten by.
 */

const SAVE_UNAVAILABLE = "Could not save — the saved-posts store is unreachable. Nothing was saved.";
const DELETE_UNAVAILABLE =
  "Could not unsave — the saved-posts store is unreachable. Nothing was removed.";

/** GET -> { saved: SavedPost[] } | { saved: [], unavailable: true } */
export async function GET() {
  try {
    return NextResponse.json({ saved: await listSaved() });
  } catch (err) {
    console.error(`GET /api/saved: ${(err as Error).message}`);
    return NextResponse.json({ saved: [], unavailable: true });
  }
}

/** Body: { platform, url, title?, author? } */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Validated here rather than left to lib/savedPosts so a bad body is a 400
  // and an unreachable store is a 503; the store cannot tell us which it was.
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || url.length > MAX_URL_LEN) {
    return NextResponse.json(
      { ok: false, error: `url must be a non-empty string up to ${MAX_URL_LEN} characters` },
      { status: 400 },
    );
  }
  const platform = typeof body.platform === "string" ? body.platform.trim() : "";
  if (!SAVEABLE_PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json(
      { ok: false, error: `platform must be one of: ${SAVEABLE_PLATFORMS.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const saved = await savePost({
      platform,
      url,
      title: typeof body.title === "string" ? body.title : null,
      author: typeof body.author === "string" ? body.author : null,
    });
    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    console.error(`POST /api/saved: ${(err as Error).message}`);
    return NextResponse.json(
      { ok: false, unavailable: true, error: SAVE_UNAVAILABLE },
      { status: 503 },
    );
  }
}

/** DELETE /api/saved?url=... — the url is in the query string, there is no body. */
export async function DELETE(req: Request) {
  const url = (new URL(req.url).searchParams.get("url") ?? "").trim();
  if (!url || url.length > MAX_URL_LEN) {
    return NextResponse.json(
      { ok: false, error: `url query parameter is required, up to ${MAX_URL_LEN} characters` },
      { status: 400 },
    );
  }

  try {
    // Deleting a url that was never saved is a success: the caller wanted it
    // gone and it is gone.
    await unsavePost(url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/saved: ${(err as Error).message}`);
    return NextResponse.json(
      { ok: false, unavailable: true, error: DELETE_UNAVAILABLE },
      { status: 503 },
    );
  }
}
