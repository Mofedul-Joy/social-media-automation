/** Shared HTTP helpers for the discovery lane. */

import type { ScrapedPost } from "../types";

export class SourceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SourceError";
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * GET JSON with bounded retry. Discovery runs on a schedule, so a transient
 * vendor blip should cost a few seconds, not the whole pass.
 */
export async function getJson(
  url: string,
  init: RequestInit = {},
  { retries = 2, timeoutMs = 45000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<any> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      const text = await res.text();
      if (!res.ok) {
        const err = new SourceError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
        if (!RETRYABLE.has(res.status) || attempt === retries) throw err;
        lastErr = err;
      } else {
        try {
          return JSON.parse(text);
        } catch {
          throw new SourceError(`non-JSON response: ${text.slice(0, 200)}`);
        }
      }
    } catch (err) {
      if (err instanceof SourceError && err.status && !RETRYABLE.has(err.status)) throw err;
      lastErr = err as Error;
      if (attempt === retries) throw lastErr;
    } finally {
      clearTimeout(timer);
    }
    await sleep(1000 * 2 ** attempt);
  }
  throw lastErr ?? new SourceError("request failed");
}

/**
 * Per-call limits for the reply pass. getJson's defaults (45s, 2 retries) are
 * sized for the primary search, where a slow answer is still worth waiting
 * for. A reply fetch runs inside a 12s lane cap in discoverPosts, so those
 * defaults would leave a request running for up to two minutes after the route
 * had already answered without it. One retry, eight seconds.
 */
export const REPLY_FETCH_LIMITS = { retries: 1, timeoutMs: 8000 };

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Stable dedupe id from a URL (host+path, no query/fragment). */
export function externalIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/**
 * Plain text out of a source that returns HTML. Both Algolia's HN index and the
 * Stack Exchange API hand back rendered markup, which is noise in the AI prompt
 * and visible junk now that the raw post body is shown in the list before any
 * comment is drafted.
 */
const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " ",
};
const TAGS = /<[^>]+>/g;
const ENTITY = /&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g;
export function stripHtml(html: string): string {
  // Tags, then entities, then tags again. Algolia's HN text mixes real markup
  // with entity-escaped markup, so decoding &lt;p&gt; turns it into a tag that
  // a single pass has already gone past. The second pass catches those.
  return html
    .replace(TAGS, " ")
    .replace(ENTITY, (m) => ENTITIES[m] ?? m)
    .replace(TAGS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Posts older than this are not worth commenting on. */
export function isFresh(iso: string | undefined, maxAgeDays: number): boolean {
  if (!iso) return true; // source gave no timestamp; let the AI judge
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= maxAgeDays * 86400_000;
}

/**
 * Normalize one comment/answer into a ScrapedPost so the discovery pipeline's
 * existing dedupe, filter and sort steps work on it unchanged.
 *
 * `external_id` is the parent's id plus the comment's own, which keeps a reply
 * distinct from its thread and from the same reply seen twice. `posted_at` is
 * whatever the source gives for the COMMENT — never the parent's date, which
 * would misreport freshness; a source with no comment timestamp (Facebook)
 * leaves it undefined and falls into the caller's undated reserved slice.
 */
export function replyPost(
  parent: ScrapedPost,
  reply: { id: string; url: string; body: string; author?: string; posted_at?: string },
): ScrapedPost | null {
  const body = reply.body.trim();
  if (!body) return null;
  return {
    platform: parent.platform,
    external_id: `${parent.external_id}#${reply.id}`,
    url: reply.url,
    author: reply.author,
    body,
    scraped_at: new Date().toISOString(),
    posted_at: reply.posted_at,
    source_query: parent.source_query,
    is_reply: true,
    parent_url: parent.url,
  };
}
