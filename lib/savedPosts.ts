import { getSupabase } from "./supabaseClient";
import type { Platform } from "@/lib/types";

/**
 * The saved-post list: posts a human chose to keep, stored as a link and
 * nothing else. Schema in `migrations/003_saved_posts.sql` — `url` is unique,
 * so re-saving the same post collapses onto the one row.
 *
 * Server-side only. `getSupabase()` holds the SERVICE ROLE key, so nothing in
 * here may ever be imported from a client component — the browser reaches it
 * through `/api/saved`.
 */
export interface SavedPost {
  id: string;
  platform: string;
  url: string;
  title: string | null;
  author: string | null;
  saved_at: string;
}

/**
 * Every `Platform`, not `DISCOVERY_PLATFORMS`: discovery only reaches four of
 * them, but a human can save anything that has a URL, so all six are legal
 * here. Exported because `/api/saved` needs the same list to answer 400 on a
 * bad platform before it ever touches the store — a typo is the caller's
 * mistake, not an outage.
 */
export const SAVEABLE_PLATFORMS: readonly Platform[] = [
  "reddit",
  "facebook",
  "instagram",
  "threads",
  "hackernews",
  "stackexchange",
];

const COLUMNS = "id,platform,url,title,author,saved_at";

/** Longer than any real post URL; a ceiling so a junk string can never be stored. */
export const MAX_URL_LEN = 2000;
/** Titles and author handles are display-only, so a sane cap is enough. */
const MAX_TITLE_LEN = 500;
const MAX_AUTHOR_LEN = 200;

/** Trim, cap, and collapse an empty string to null — both columns are nullable for a reason. */
function optional(value: string | null | undefined, max: number): string | null {
  const v = (value ?? "").trim();
  return v ? v.slice(0, max) : null;
}

/**
 * Newest-first, unlimited — this is one human's own bookmarks, so PostgREST's
 * max-rows ceiling is the only bound it needs. Throws on a store failure; the
 * route decides what an unreachable store should look like to the user, not
 * this.
 */
export async function listSaved(): Promise<SavedPost[]> {
  const { data, error } = await getSupabase()
    .from("saved_posts")
    .select(COLUMNS)
    .order("saved_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as SavedPost[];
}

/**
 * Upsert on `url`, so saving the same post twice is a no-op rather than the
 * duplicate-key error the UI would otherwise have to decode.
 *
 * `saved_at` is deliberately absent from the payload. For a single-object
 * upsert postgrest-js sends no `columns` query param (it builds one only for
 * array payloads), so PostgREST derives the INSERT ... ON CONFLICT DO UPDATE
 * column set from the payload keys alone: an omitted column takes its table
 * default on insert and is left untouched on merge — `defaultToNull` is
 * documented as applying only to bulk inserts and never when merging with an
 * existing row. So the original timestamp stands on a repeat save, which is
 * what we want: the first save is the truth.
 *
 * `title`/`author` ARE always sent, so a re-save refreshes them. They are
 * display metadata, and the more recent read of the post is the better one.
 *
 * Validation here is the backstop, not the user-facing check — it throws like
 * any other failure, so the route validates the body itself first in order to
 * tell a 400 apart from a 503.
 */
export async function savePost(p: {
  platform: string;
  url: string;
  title?: string | null;
  author?: string | null;
}): Promise<SavedPost> {
  const url = (p.url ?? "").trim();
  if (!url || url.length > MAX_URL_LEN) {
    throw new Error(`url must be a non-empty string up to ${MAX_URL_LEN} characters`);
  }
  const platform = (p.platform ?? "").trim();
  if (!SAVEABLE_PLATFORMS.includes(platform as Platform)) {
    throw new Error(`platform must be one of: ${SAVEABLE_PLATFORMS.join(", ")}`);
  }

  const { data, error } = await getSupabase()
    .from("saved_posts")
    .upsert(
      {
        platform,
        url,
        title: optional(p.title, MAX_TITLE_LEN),
        author: optional(p.author, MAX_AUTHOR_LEN),
      },
      { onConflict: "url" },
    )
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as SavedPost;
}

/**
 * Unsaving a url that was never saved deletes nothing and is not an error — the
 * caller wanted it gone and it is gone. Throws only on a store failure.
 */
export async function unsavePost(url: string): Promise<void> {
  const u = (url ?? "").trim();
  if (!u) throw new Error("url is required");

  const { error } = await getSupabase().from("saved_posts").delete().eq("url", u);
  if (error) throw error;
}
