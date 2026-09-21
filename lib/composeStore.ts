/**
 * Server-only persistence for the compose feature. Imports the service-role
 * Supabase client, so it must never be pulled into a client component.
 *
 * Everything here reads and writes THIS APP'S OWN Supabase tables. There is no
 * call to Reddit, Facebook, Instagram, Threads, Hacker News or Stack Exchange
 * in this file, and there must never be one: `done` is Hon ticking a box after
 * he pasted the draft himself, not a check that the post went live.
 *
 * Schema: migrations/002_compose.sql.
 */

import { getSupabase } from "./supabaseClient";
import type { Platform } from "./types";

export interface SavedTarget {
  id: number;
  platform: Platform;
  name: string;
  url: string;
}

export interface CrosspostTarget {
  id: number;
  composed_post_id: number;
  platform: Platform;
  target: string;
  target_url: string;
  formatted_body: string;
  done: boolean;
  done_at: string | null;
}

export interface ComposedPost {
  id: number;
  body: string;
  created_at: string;
}

/** One target as the client asks for it to be saved. */
export interface TargetInput {
  platform: Platform;
  target: string;
  target_url: string;
  formatted_body: string;
}

/**
 * Supabase reads in this app fail intermittently in production (see the note in
 * lib/config.ts), so a compose page load should not 500 on a blip. A failure
 * here surfaces as an empty page plus an error banner, never a crash.
 */
export async function loadSavedTargets(): Promise<SavedTarget[]> {
  const { data, error } = await getSupabase()
    .from("crosspost_saved_targets")
    .select("id, platform, name, url")
    .order("platform", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SavedTarget[];
}

/**
 * Is this name already taken on this platform by a DIFFERENT place?
 *
 * The name is the key the UI and crosspost_targets both use, so two places
 * sharing one name on one platform would collapse into a single row and one of
 * them would silently stop being tracked. Caught here so the caller can say so
 * plainly, rather than letting the unique index surface as a 503.
 */
export async function savedNameTaken(platform: Platform, name: string, url: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("crosspost_saved_targets")
    .select("url")
    .eq("platform", platform)
    .eq("name", name);
  if (error) throw error;
  return (data ?? []).some((row) => (row as { url: string }).url !== url);
}

export async function addSavedTarget(platform: Platform, name: string, url: string): Promise<SavedTarget> {
  const { data, error } = await getSupabase()
    .from("crosspost_saved_targets")
    .upsert({ platform, name, url }, { onConflict: "platform,url" })
    .select("id, platform, name, url")
    .single();
  if (error) throw error;
  return data as SavedTarget;
}

export async function deleteSavedTarget(id: number): Promise<void> {
  const { error } = await getSupabase().from("crosspost_saved_targets").delete().eq("id", id);
  if (error) throw error;
}

/** The draft Hon is currently working on: the most recent one. */
export async function loadLatestDraft(): Promise<{ post: ComposedPost | null; targets: CrosspostTarget[] }> {
  const { data: posts, error } = await getSupabase()
    .from("composed_posts")
    .select("id, body, created_at")
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  const post = (posts?.[0] as ComposedPost | undefined) ?? null;
  if (!post) return { post: null, targets: [] };
  return { post, targets: await loadTargets(post.id) };
}

export async function loadTargets(composedPostId: number): Promise<CrosspostTarget[]> {
  const { data, error } = await getSupabase()
    .from("crosspost_targets")
    .select("id, composed_post_id, platform, target, target_url, formatted_body, done, done_at")
    .eq("composed_post_id", composedPostId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CrosspostTarget[];
}

/**
 * Save the draft and the set of targets it goes to.
 *
 * Targets are reconciled rather than deleted and re-inserted, because a
 * re-insert would silently reset every `done` tick Hon had already made — the
 * one piece of state in this feature he cannot reconstruct from anywhere else.
 * Rows for de-selected targets are removed; kept rows keep their done state and
 * have their formatted body refreshed from the edited draft.
 */
export async function saveDraft(
  postId: number | null,
  body: string,
  targets: TargetInput[],
): Promise<{ post: ComposedPost; targets: CrosspostTarget[] }> {
  const db = getSupabase();

  let post: ComposedPost;
  if (postId === null) {
    const { data, error } = await db
      .from("composed_posts")
      .insert({ body })
      .select("id, body, created_at")
      .single();
    if (error) throw error;
    post = data as ComposedPost;
  } else {
    const { data, error } = await db
      .from("composed_posts")
      .update({ body })
      .eq("id", postId)
      .select("id, body, created_at")
      .single();
    if (error) throw error;
    post = data as ComposedPost;
  }

  const existing = await loadTargets(post.id);
  const keyOf = (t: { platform: string; target: string }) => `${t.platform}\u0000${t.target}`;
  const wanted = new Map(targets.map((t) => [keyOf(t), t]));

  const staleIds = existing.filter((row) => !wanted.has(keyOf(row))).map((row) => row.id);
  if (staleIds.length) {
    const { error } = await db.from("crosspost_targets").delete().in("id", staleIds);
    if (error) throw error;
  }

  const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));
  for (const t of targets) {
    const row = existingByKey.get(keyOf(t));
    if (row) {
      // Refresh the formatted text only; `done` and `done_at` are Hon's, not ours.
      const { error } = await db
        .from("crosspost_targets")
        .update({ formatted_body: t.formatted_body, target_url: t.target_url })
        .eq("id", row.id);
      if (error) throw error;
    } else {
      const { error } = await db.from("crosspost_targets").insert({
        composed_post_id: post.id,
        platform: t.platform,
        target: t.target,
        target_url: t.target_url,
        formatted_body: t.formatted_body,
      });
      if (error) throw error;
    }
  }

  return { post, targets: await loadTargets(post.id) };
}

/**
 * Tick or untick one target. This records that a HUMAN says he pasted and
 * submitted it. Nothing is read back from the platform to verify that, by
 * design — verifying would need platform access this app does not have and is
 * not allowed to acquire.
 */
export async function setTargetDone(id: number, done: boolean): Promise<CrosspostTarget> {
  const { data, error } = await getSupabase()
    .from("crosspost_targets")
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id, composed_post_id, platform, target, target_url, formatted_body, done, done_at")
    .single();
  if (error) throw error;
  return data as CrosspostTarget;
}
