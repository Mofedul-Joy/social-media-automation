/** Shared HTTP helpers for the discovery lane. */

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
