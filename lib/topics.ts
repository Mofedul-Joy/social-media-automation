import { getSupabase } from "./supabaseClient";

/**
 * The saved-topic list: every topic that has actually been searched, so a past
 * search is one click away instead of retyped. Schema in
 * `migrations/001_search_topics.sql` — `topic` is the primary key, so a repeat
 * search bumps one row rather than appending history.
 *
 * Server-side only. `getSupabase()` holds the SERVICE ROLE key, so nothing in
 * here may ever be imported from a client component — the browser reaches it
 * through `/api/topics` and `/api/topic-search`.
 */
export interface SearchTopic {
  topic: string;
  last_used_at: string;
  use_count: number;
}

/** Same ceiling the search route enforces, so a topic too long to search can never be stored. */
const MAX_TOPIC_LEN = 200;

/**
 * Newest-first, unlimited — the list is deliberately uncapped (issue 08), and
 * PostgREST's own max-rows ceiling is the only bound on it. Throws on a store
 * failure; the route decides what an unreachable store should look like to the
 * user, not this.
 */
export async function listTopics(): Promise<SearchTopic[]> {
  const { data, error } = await getSupabase()
    .from("search_topics")
    .select("topic,last_used_at,use_count")
    .order("last_used_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SearchTopic[];
}

/**
 * Read-then-upsert rather than an atomic SQL increment, because that would need
 * a stored function and this app has exactly one user — two searches for the
 * same topic in the same millisecond, the only case a lost update needs, cannot
 * happen here. The cost of being wrong is a counter reading one low.
 */
export async function recordTopic(topic: string): Promise<void> {
  const t = topic.trim();
  if (!t || t.length > MAX_TOPIC_LEN) return;

  const sb = getSupabase();
  const { data, error: readErr } = await sb
    .from("search_topics")
    .select("use_count")
    .eq("topic", t)
    .maybeSingle();
  if (readErr) throw readErr;

  const { error } = await sb.from("search_topics").upsert(
    {
      topic: t,
      use_count: ((data?.use_count as number | undefined) ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "topic" },
  );
  if (error) throw error;
}
