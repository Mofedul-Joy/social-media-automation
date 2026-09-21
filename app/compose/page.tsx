/**
 * /compose — write one post, get a formatted draft per place, paste each one
 * yourself, tick it off.
 *
 * This page and everything it renders NEVER post anywhere. There is no
 * platform write path in this feature, by design and by rule.
 *
 * Server component: reads the draft and the saved target list so a reload
 * comes back with the state already on screen rather than flashing empty.
 */

import { loadLatestDraft, loadSavedTargets, type CrosspostTarget, type SavedTarget } from "@/lib/composeStore";
import { Composer } from "../components/Composer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const metadata = {
  title: "Compose — Pulse",
  description: "Write a post once, format it for each place you post, and tick off the ones you have posted yourself.",
};

export default async function ComposePage() {
  let saved: SavedTarget[] = [];
  let post: { id: number; body: string } | null = null;
  let targets: CrosspostTarget[] = [];
  let loadError: string | null = null;

  // A Supabase blip must not take the whole page down — the composer is still
  // useful for formatting text even when nothing can be saved, so degrade to a
  // visible banner instead of an error screen.
  try {
    const [savedTargets, draft] = await Promise.all([loadSavedTargets(), loadLatestDraft()]);
    saved = savedTargets;
    post = draft.post ? { id: draft.post.id, body: draft.post.body } : null;
    targets = draft.targets;
  } catch (err) {
    // The raw exception ("TypeError: fetch failed") tells Hon nothing he can
    // act on, so it goes to the server log and he gets the state of play plus
    // what still works.
    console.error(`GET /compose: ${(err as Error).message}`);
    loadError =
      "Could not reach the place your drafts are saved, so your list and your last draft are not loaded. You can still write and format a post below, but saving and ticking off will not work until this comes back. Try reloading in a minute.";
  }

  return <Composer savedTargets={saved} initialPost={post} initialTargets={targets} loadError={loadError} />;
}
