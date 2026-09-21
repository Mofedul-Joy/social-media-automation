/**
 * Cross-post formatting. Pure functions only — no network, no Supabase, no
 * platform calls of any kind. This module turns ONE body Hon typed into the
 * per-target text he will paste himself. Nothing here, or anywhere in the
 * compose feature, sends anything to a platform.
 *
 * Safe to import from a client component: it imports nothing.
 */

import type { Platform } from "./types";

/**
 * Hard body limits, per platform, in characters.
 *
 * `null` means "this platform publishes no body limit we can cite". It is NOT
 * a stand-in for a number we could not be bothered to look up — inventing a
 * limit would silently truncate Hon's post at a boundary that does not exist,
 * so an unknown limit stays unknown and the UI just shows a count.
 *
 * Verified 2026-09-21: Reddit self-post body 40,000; Facebook post 63,206;
 * Instagram caption 2,200; Threads 500. Hacker News and Stack Exchange do not
 * publish a body character limit, hence null.
 */
export const PLATFORM_LIMIT: Record<Platform, number | null> = {
  reddit: 40_000,
  facebook: 63_206,
  instagram: 2_200,
  threads: 500,
  hackernews: null,
  stackexchange: null,
};

/**
 * How many inline #hashtags each platform actually wants.
 *
 *  0     strip them — the platform has no hashtag culture and they read as
 *        noise or as spam (Reddit, Hacker News), or tagging is a separate
 *        structured field rather than inline text (Stack Exchange).
 *  n     keep the first n, drop the rest (Instagram caps at 30; Threads
 *        attaches a single topic tag per post).
 *  null  no convention to enforce — leave the text alone.
 */
export const PLATFORM_HASHTAG_MAX: Record<Platform, number | null> = {
  reddit: 0,
  hackernews: 0,
  stackexchange: 0,
  instagram: 30,
  threads: 1,
  facebook: null,
};

/** Plain-English note per platform, shown under its draft. */
export const PLATFORM_CONVENTION: Record<Platform, string> = {
  reddit: "Reddit threads do not use hashtags, so they are removed.",
  hackernews: "Hacker News does not use hashtags, so they are removed.",
  stackexchange: "Stack Exchange tags go in the tag field, not the body, so hashtags are removed.",
  instagram: "Instagram allows up to 30 hashtags. Extra ones are removed.",
  threads: "Threads attaches one topic tag per post. Extra hashtags are removed.",
  facebook: "Facebook leaves hashtags as written.",
};

const HASHTAG = /#[\p{L}\p{N}_]+/gu;

/** Squash the holes left behind after removing hashtags, without reflowing. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Keep the first `max` hashtags and drop the rest. `max` of 0 drops all. */
function applyHashtagRule(body: string, max: number | null): { text: string; removed: number } {
  if (max === null) return { text: body, removed: 0 };
  let seen = 0;
  let removed = 0;
  const text = body.replace(HASHTAG, (tag) => {
    seen += 1;
    if (seen <= max) return tag;
    removed += 1;
    return "";
  });
  return { text: removed ? tidy(text) : text, removed };
}

/**
 * Cut to `limit` characters on a whitespace boundary where one is close
 * enough, so a draft is never chopped through the middle of a word.
 */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const raw = text.slice(0, limit);
  const lastSpace = raw.lastIndexOf(" ");
  // Only honour the boundary if it is not throwing away a meaningful tail.
  const cut = (lastSpace > limit * 0.85 ? raw.slice(0, lastSpace) : raw).trimEnd();

  // A hard cut can land inside a hashtag, and the leftover still looks like a
  // tag ("#wonderfu"). Pasting a corrupted tag is worse than pasting none, so
  // drop a trailing fragment that was not a whole tag in the original.
  const whole = new Set(text.match(HASHTAG) ?? []);
  const tail = cut.match(/#[\p{L}\p{N}_]+$/u);
  return tail && !whole.has(tail[0]) ? cut.slice(0, tail.index).trimEnd() : cut;
}

/**
 * How many of `before`'s hashtags are missing from `after`, counting repeats
 * properly. A plain count-difference would call a truncated fragment a
 * surviving tag and under-report what Hon actually lost.
 */
function tagsLost(before: string, after: string): number {
  const pool = [...(after.match(HASHTAG) ?? [])];
  let lost = 0;
  for (const tag of before.match(HASHTAG) ?? []) {
    const i = pool.indexOf(tag);
    if (i === -1) lost += 1;
    else pool.splice(i, 1);
  }
  return lost;
}

export interface FormattedDraft {
  /** Exactly the text the Copy button puts on the clipboard. */
  text: string;
  /** Characters in `text`. */
  length: number;
  /** The platform's limit, or null where it publishes none. */
  limit: number | null;
  /** Hashtags dropped to match the platform's convention. */
  hashtagsRemoved: number;
  /** Characters dropped to fit the limit. 0 when the draft already fitted. */
  trimmed: number;
}

/**
 * Format one body for one platform: apply the hashtag convention, then fit it
 * to the character limit. Returns the exact text Hon will copy, plus what had
 * to change, so the UI can tell him rather than quietly altering his words.
 */
export function formatForPlatform(body: string, platform: Platform): FormattedDraft {
  const limit = PLATFORM_LIMIT[platform];
  const { text: tagged } = applyHashtagRule(body, PLATFORM_HASHTAG_MAX[platform]);
  const text = limit === null ? tagged : truncate(tagged, limit);
  // Counted against the final text, not against the hashtag step alone: a tag
  // the convention kept can still be lost to the limit, and reporting it as
  // "kept" would be a lie about what Hon is actually pasting.
  return {
    text,
    length: text.length,
    limit,
    hashtagsRemoved: tagsLost(body, text),
    trimmed: tagged.length - text.length,
  };
}
