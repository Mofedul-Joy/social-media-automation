import type { ScrapedPost, SourceResult } from "../types";
import { getJson, replyPost, REPLY_FETCH_LIMITS, stripHtml } from "./http";
import { decodeEntities } from "../text";

/**
 * Hacker News, via Algolia's public search API. No key, no vendor cost, no
 * quota. Audience is founders/builders, which is a strong match for a
 * service business targeting people building AI products.
 *
 * https://hn.algolia.com/api
 */

const BASE = "https://hn.algolia.com/api/v1";

interface HnHit {
  objectID: string;
  title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  author: string;
  created_at: string;
  url?: string | null;
  _tags: string[];
}

function hnPost(h: HnHit, query: string): ScrapedPost | null {
  const isComment = h._tags.includes("comment");
  // Algolia returns story_text and comment_text as HTML, not plain text.
  const body = decodeEntities(stripHtml((isComment ? h.comment_text : h.story_text ?? h.title) ?? ""));
  if (!body) return null;
  // Always the HN thread, never `h.url`. For a link submission h.url is the
  // article the submitter posted, and there is nothing to comment on over
  // there. "Open post" has to land where the conversation is, on the item page
  // the reader is already logged into. (h.url is also submitter-entered and
  // unvalidated by Algolia, so it was never safe as a link target anyway.)
  const url = `https://news.ycombinator.com/item?id=${h.objectID}`;
  return {
    platform: "hackernews",
    // NOT externalIdFromUrl: it drops the query string, and the item id is the
    // whole query string here, so every HN hit collapsed to
    // "news.ycombinator.com/item" and the caller's dedupe threw all but one
    // away. Same trap socialapis.ts documents for permalink.php URLs.
    external_id: `news.ycombinator.com/item?id=${h.objectID}`,
    url,
    author: h.author,
    title: isComment ? undefined : h.title ? decodeEntities(h.title) : undefined,
    body,
    scraped_at: new Date().toISOString(),
    posted_at: h.created_at,
    source_query: query,
  };
}

/**
 * Searches stories (Ask HN, Show HN, submissions), sorted by date. Relevance
 * ranking surfaces old high-engagement threads that the freshness filter
 * throws away downstream, wasting analyze calls; date order matches what
 * intent discovery actually needs. Comments are noisier signal and not worth
 * the extra call for now.
 */
export async function searchHackerNews(query: string): Promise<SourceResult> {
  const url =
    `${BASE}/search_by_date?query=${encodeURIComponent(query)}&tags=story` +
    `&hitsPerPage=30`;
  const json = await getJson(url);
  const hits: HnHit[] = json?.hits ?? [];
  const posts = hits
    .map((h) => hnPost(h, query))
    .filter((p): p is ScrapedPost => p !== null);
  return { posts, unitsCharged: 0, errors: [] };
}

/**
 * The whole comment tree for one story in a single free call. Algolia's
 * `/items/{id}` returns every descendant already nested under `children`, so
 * there is no pagination and no per-comment fan-out — the cheapest of the four
 * sources to extend, which is why it is not capped as hard as the others.
 */
interface HnItem {
  id: number;
  type?: string;
  text?: string | null;
  author?: string | null;
  created_at?: string | null;
  children?: HnItem[];
}

function flattenItems(node: HnItem, out: HnItem[] = []): HnItem[] {
  for (const child of node.children ?? []) {
    if (child.type === "comment") out.push(child);
    flattenItems(child, out);
  }
  return out;
}

/** `https://news.ycombinator.com/item?id=<id>` -> `<id>`. */
const ITEM_ID = /[?&]id=(\d+)/;

export async function fetchReplies(post: ScrapedPost): Promise<ScrapedPost[]> {
  const id = ITEM_ID.exec(post.url)?.[1];
  if (!id) return [];
  const json: HnItem | null = await getJson(`${BASE}/items/${id}`, {}, REPLY_FETCH_LIMITS);
  if (!json) return [];
  return flattenItems(json)
    .map((c) =>
      replyPost(post, {
        id: String(c.id),
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        // Algolia hands back HTML here, same as the search index does.
        body: decodeEntities(stripHtml(c.text ?? "")),
        author: c.author ?? undefined,
        posted_at: c.created_at ?? undefined,
      }),
    )
    .filter((p): p is ScrapedPost => p !== null);
}
