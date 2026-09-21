import type { ScrapedPost, SourceResult } from "../types";
import { getJson, externalIdFromUrl, replyPost, REPLY_FETCH_LIMITS, stripHtml } from "./http";

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

/**
 * Answers to one question. Answers ONLY, not comments: on Stack Overflow the
 * substantive "reply 11" is an answer, comments are short meta-chatter, and
 * every extra endpoint doubles the burn on the 300-req/day anonymous quota
 * this integration deliberately still runs on (no app key configured). One
 * free call per shortlisted question — free, but quota-bearing, which is why
 * it only ever runs on a shortlist.
 */
interface SeAnswer {
  answer_id: number;
  body?: string;
  creation_date: number;
  owner?: { display_name?: string };
}

/** `https://stackoverflow.com/questions/<id>/<slug>` -> `<id>`. */
const QUESTION_ID = /\/questions\/(\d+)/;

export async function fetchReplies(post: ScrapedPost): Promise<ScrapedPost[]> {
  const id = QUESTION_ID.exec(post.url)?.[1];
  if (!id) return [];
  const json = await getJson(
    `${BASE}/questions/${id}/answers?order=desc&sort=creation&site=stackoverflow` +
      `&pagesize=30&filter=withbody`,
    {},
    REPLY_FETCH_LIMITS,
  );
  const items: SeAnswer[] = json?.items ?? [];
  return items
    .map((a) =>
      replyPost(post, {
        id: String(a.answer_id),
        url: `https://stackoverflow.com/a/${a.answer_id}`,
        body: a.body ? stripHtml(a.body) : "",
        author: a.owner?.display_name,
        posted_at: new Date(a.creation_date * 1000).toISOString(),
      }),
    )
    .filter((p): p is ScrapedPost => p !== null);
}
