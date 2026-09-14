import type { ScrapedPost, SourceResult } from "../types";
import { getJson, externalIdFromUrl, SourceError } from "./http";

/**
 * SocialAPIs.io: the Facebook discovery source.
 *
 * There is no Meta write or post-search API for this. Graph API only reads and
 * writes Pages and media you own, `/search?type=post` was removed in v2.0, and
 * the Content Library is academic access only. Third-party read infrastructure
 * is the only route, and it stays strictly off-account.
 *
 * The pattern that works, measured:
 *   1. `search/posts` with an intent phrase to find WHICH GROUPS the buyers are in.
 *      ~1.4 posts/credit, flaky, and it returns no timestamps.
 *   2. `groups/posts` against those group URLs from then on.
 *      3 posts/credit, real timestamps, and top comments.
 * Search finds groups. Groups find posts. With no groups configured, search is
 * also the fallback discovery source — worse per credit, but not zero.
 */

const BASE = "https://api.socialapis.io";

function headers(): Record<string, string> {
  const t = process.env.SOCIALAPIS_TOKEN;
  if (!t) throw new SourceError("SOCIALAPIS_TOKEN is not set");
  return { "x-api-token": t, accept: "application/json" };
}

/** Live responses put the array on `data.items`; their docs say `data.results`. Accept either. */
function items(json: any): any[] {
  const d = json?.data ?? json;
  return d?.items ?? d?.results ?? d?.posts ?? (Array.isArray(d) ? d : []);
}

/**
 * `search/posts` nests the post under `basic_info`/`owner_info`; the flat
 * fields below are what `groups/posts` is documented to return. Both shapes are
 * accepted because only the search shape has been seen live — reading the
 * nested one first must not cost the group path its existing parsing.
 */
function textOf(p: any): string {
  return String(
    p?.basic_info?.post_text ?? p?.message ?? p?.text ?? p?.content ?? p?.description ?? "",
  ).trim();
}

function urlOf(p: any): string | null {
  const u = p?.basic_info?.url ?? p?.url ?? p?.post_url ?? p?.permalink ?? p?.link;
  if (typeof u === "string" && u.startsWith("http")) return u;
  const id = p?.basic_info?.post_id ?? p?.post_id ?? p?.id;
  return id ? `https://www.facebook.com/${id}` : null;
}

function timeOf(p: any): string | undefined {
  const t = p?.created_time ?? p?.timestamp ?? p?.time ?? p?.creation_time;
  if (typeof t === "number") return new Date(t * 1000).toISOString();
  if (typeof t === "string" && !Number.isNaN(Date.parse(t))) return new Date(t).toISOString();
  return undefined;
}

function toPost(p: any, query: string, groupUrl?: string): ScrapedPost | null {
  const url = urlOf(p);
  const body = textOf(p);
  if (!url || body.length < 20) return null;
  // Top comments often carry the actual intent ("I'm looking for one too").
  const comments: string[] = (p?.top_comments ?? p?.comments ?? [])
    .map((c: any) => textOf(c))
    .filter(Boolean)
    .slice(0, 5);
  return {
    platform: "facebook",
    // externalIdFromUrl drops the query string, and a large share of search
    // results are `permalink.php?story_fbid=…` — every one of those collapses
    // to the same id and the caller's dedupe throws all but one away. The
    // vendor's own post_id is unique, so prefer it where the payload has one.
    // Only the search shape does, so the group path keeps the URL-derived id.
    external_id: p?.basic_info?.post_id ? String(p.basic_info.post_id) : externalIdFromUrl(url),
    url,
    author: p?.owner_info?.owner_name ?? p?.author?.name ?? p?.owner?.name ?? p?.user?.name ?? undefined,
    title: groupUrl ? `Group post: ${groupUrl}` : undefined,
    body: comments.length ? `${body}\n\n--- top comments ---\n${comments.join("\n")}` : body,
    scraped_at: new Date().toISOString(),
    posted_at: timeOf(p),
    source_query: query,
  };
}

/**
 * Poll one group's recent posts. `limit` is capped at 9 by the vendor and
 * billed as ceil(posts/3) credits, so 9 is the efficient page size.
 *
 * Retries are off here on purpose. getJson's default is two retries on
 * 429/5xx, and every attempt is a billable SocialAPIs call, so a single
 * search could quietly turn into three charges. One call, one charge: if the
 * vendor is throttling or down, the caller treats Facebook as absent for that
 * search rather than paying to insist.
 */
export async function groupPosts(
  groupUrl: string,
  { limit = 9, afterTime }: { limit?: number; afterTime?: Date } = {},
): Promise<SourceResult> {
  const params = new URLSearchParams({ link: groupUrl, limit: String(Math.min(9, Math.max(3, limit))) });
  if (afterTime) params.set("after_time", afterTime.toISOString());
  const json = await getJson(
    `${BASE}/facebook/groups/posts?${params}`,
    { headers: headers() },
    { retries: 0 },
  );
  const posts = items(json)
    .map((p) => toPost(p, `group:${groupUrl}`, groupUrl))
    .filter((p): p is ScrapedPost => p !== null);
  return { posts, unitsCharged: Math.max(1, Math.ceil(posts.length / 3)), errors: [] };
}

/**
 * Keyword search across public Facebook posts. Expensive per post and returns
 * no timestamps, so freshness cannot be enforced on its results — but it is
 * the only Facebook source that works with no group URL configured, so the
 * discovery lane falls back to it when the group list is empty.
 *
 * Retries are off for the same reason as `groupPosts`: every attempt is a
 * billable call, so one call is one charge rather than three.
 */
export async function searchPosts(
  query: string,
  { recentOnly = true, startTime }: { recentOnly?: boolean; startTime?: Date } = {},
): Promise<SourceResult> {
  const params = new URLSearchParams({ query });
  if (recentOnly) params.set("recent_posts", "true");
  if (startTime) params.set("start_time", startTime.toISOString().slice(0, 10));
  const json = await getJson(
    `${BASE}/facebook/search/posts?${params}`,
    { headers: headers() },
    { retries: 0 },
  );
  const posts = items(json)
    .map((p) => toPost(p, query))
    .filter((p): p is ScrapedPost => p !== null);
  // The vendor reports the real charge on every response and it is a flat 1
  // per call, not the ~1.4-posts-per-credit the estimate below assumed
  // (measured: 5 posts, creditsCharged 1). Trust the number it sends; keep the
  // estimate only for a payload that omits meta.
  const charged = json?.meta?.creditsCharged;
  return {
    posts,
    unitsCharged: typeof charged === "number" ? charged : Math.max(1, Math.ceil(posts.length / 1.4)),
    errors: [],
  };
}

/** Group URLs referenced by a set of search results, for building the poll list. */
export function groupsMentionedIn(json: any): { url: string; name?: string }[] {
  const out = new Map<string, string | undefined>();
  for (const p of items(json)) {
    const g = p?.group ?? p?.to ?? p?.parent;
    const url = g?.url ?? g?.link;
    if (typeof url === "string" && url.includes("/groups/")) out.set(url, g?.name);
  }
  return Array.from(out, ([url, name]) => ({ url, name }));
}
