import { NextResponse } from "next/server";
import { loadBusinessContext } from "@/lib/config";
import { analyzePost } from "@/lib/analyzeClient";
import { externalIdFromUrl } from "@/lib/sources/http";
import type { Platform, ScrapedPost } from "@/lib/types";

export const dynamic = "force-dynamic";
/**
 * lib/analyzeClient.ts aborts at 130s, above the worker CLI's own 120s, so the
 * function must outlive a worst-case worker run rather than cutting it short.
 * A real click settles in ~14s; this ceiling is only for the bad tail.
 */
export const maxDuration = 120;

/**
 * Exactly one AI call, for the one post a human chose to act on. This is the
 * only place in the app that spends an analyze call, and it spends it once:
 * no retry loop, because a second `claude` run is a second billed round trip
 * and the user can simply click again.
 */

/**
 * Written as a Record so the compiler fails here if `Platform` ever gains a
 * member, instead of silently rejecting the new platform at runtime.
 */
const PLATFORMS: Record<Platform, true> = {
  reddit: true,
  facebook: true,
  instagram: true,
  threads: true,
  hackernews: true,
  stackexchange: true,
};

/** Caps sized to the worker's 512KB body limit and to a sane prompt length. */
const MAX_BODY_LEN = 20_000;
const MAX_TITLE_LEN = 500;

function str(v: unknown, max: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

/**
 * The post round-trips through the browser, so nothing on it is trusted. Rather
 * than validating in place, a clean ScrapedPost is rebuilt from the fields we
 * recognise: over-long text is truncated (a tampered payload should not be able
 * to blow up the worker's body limit or its prompt), and anything unrecognised
 * is dropped. Returns an error string instead of a post when it is unusable.
 */
function sanitize(raw: any): { post: ScrapedPost } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "post must be an object" };

  const platform = raw.platform as Platform;
  if (typeof platform !== "string" || PLATFORMS[platform] !== true) {
    return { error: "post.platform is not a known platform" };
  }

  const url = typeof raw.url === "string" ? raw.url : "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "post.url must be an absolute http(s) URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "post.url must be an absolute http(s) URL" };
  }

  const body = str(raw.body, MAX_BODY_LEN);
  if (!body) return { error: "post.body must be a non-empty string" };

  const scraped_at = str(raw.scraped_at, 40);
  return {
    post: {
      platform,
      external_id: str(raw.external_id, 500) ?? externalIdFromUrl(url),
      url,
      author: str(raw.author, 200),
      title: str(raw.title, MAX_TITLE_LEN),
      body,
      scraped_at: scraped_at && !Number.isNaN(Date.parse(scraped_at))
        ? scraped_at
        : new Date().toISOString(),
      posted_at: str(raw.posted_at, 40),
      source_query: str(raw.source_query, 500),
    },
  };
}

/** Body: { post: ScrapedPost } */
export async function POST(req: Request) {
  const { post: raw } = await req.json().catch(() => ({ post: null }));
  const checked = sanitize(raw);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  // A Supabase read can throw (see lib/config.ts); without a catch here Next
  // answers with a bare 500 and a zero-byte body, same failure /api/config had.
  let ctx;
  try {
    ctx = await loadBusinessContext();
  } catch (err) {
    console.error(`POST /api/analyze-post (config): ${(err as Error).message}`);
    return NextResponse.json(
      { error: `config store unavailable: ${(err as Error).message}` },
      { status: 503 },
    );
  }
  try {
    // No relevance or intent floor here. The old route dropped low-intent posts
    // before the user ever saw them; the new UI shows both scores and lets the
    // human make that call, so the analysis goes back exactly as returned.
    const analysis = await analyzePost(ctx, checked.post);
    return NextResponse.json({ analysis });
  } catch (err) {
    // The worker's own error text can carry its URL or response body, so it is
    // logged server side and the client gets a fixed, short message.
    console.error(`analyze-post ${checked.post.url}: ${(err as Error).message}`);
    return NextResponse.json({ error: "AI analysis failed, please try again" }, { status: 502 });
  }
}
