import type { ScrapedPost, SourceResult } from "../types";
import { getJson, externalIdFromUrl } from "./http";

/**
 * Stack Overflow, via the free public Stack Exchange API. No key, no vendor
 * cost. Anonymous quota is 300 requests/day (shared per IP); a free app key
 * from stackapps.com raises that to 10,000/day if this lane needs more room.
 *
 * Signal is weaker than Reddit/HN — this is a Q&A site, so most hits are
 * "how do I build X" rather than "who can build X for me" — but it is free
 * and the AI gate downstream already exists to sort that out.
 *
 * https://api.stackexchange.com/docs/advanced-search
 */

const BASE = "https://api.stackexchange.com/2.3";

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

interface SeQuestion {
  question_id: number;
  title: string;
  link: string;
  body?: string;
  creation_date: number;
  owner?: { display_name?: string };
}

function toPost(q: SeQuestion, query: string): ScrapedPost | null {
  const body = q.body ? stripHtml(q.body) : "";
  if (!body) return null;
  return {
    platform: "stackexchange",
    external_id: externalIdFromUrl(q.link),
    url: q.link,
    author: q.owner?.display_name,
    title: q.title,
    body,
    scraped_at: new Date().toISOString(),
    posted_at: new Date(q.creation_date * 1000).toISOString(),
    source_query: query,
  };
}

/** Advanced search across Stack Overflow, newest first. */
export async function searchStackOverflow(query: string): Promise<SourceResult> {
  const url =
    `${BASE}/search/advanced?order=desc&sort=creation&site=stackoverflow` +
    `&pagesize=30&filter=withbody&q=${encodeURIComponent(query)}`;
  const json = await getJson(url);
  const items: SeQuestion[] = json?.items ?? [];
  const posts = items.map((q) => toPost(q, query)).filter((p): p is ScrapedPost => p !== null);
  return { posts, unitsCharged: 0, errors: [] };
}
