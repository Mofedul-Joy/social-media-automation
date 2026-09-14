import type { ScrapedPost } from "./types";

/**
 * Deterministic seller/CTA pattern filter. No model call.
 *
 * Query phrasing (lib/intent.ts) picks the search terms but cannot tell who's
 * talking -- "I can help with X" and "I need help with X" share almost every
 * word. Sellers also deliberately write in struggle-language as a hook
 * ("Struggling with X? Read more..."), which phrasing alone can't catch
 * either. This is the second, independent signal: a fixed list of phrases
 * that only appear in a pitch (a CTA, a self-description as the provider,
 * "read more"/"link in bio" style content marketing), never in someone
 * describing their own problem.
 */
const SELLER_PATTERNS: RegExp[] = [
  /\bjoin me\b/i,
  /\bsign up\b/i,
  /\bdm me\b/i,
  /\bdm for\b/i,
  /\bmessage me\b/i,
  /\bbook a call\b/i,
  /\bclick (the )?link\b/i,
  /\blink in bio\b/i,
  /\bread more\b/i,
  /\bcheck out my\b/i,
  /\bvisit my\b/i,
  /\bfollow me\b/i,
  /\blimited spots\b/i,
  /\bslide into (my|our) dms\b/i,
  /\bcontact (me|us) (today|now)\b/i,
  /\breach out (to (me|us)|today|now)\b/i,
  /\bi'?m (currently )?looking to work with\b/i,
  /\bi (can|could) help (you )?with\b/i,
  /\bi specialize in\b/i,
  /\bi offer\b/i,
  /\bwe (offer|provide|specialize)\b/i,
  /\bour (agency|team|service)\b/i,
  /\bfractional cmo\b/i,
  /\blive (zoom|webinar) session\b/i,
  /\bbook (a |your )?(free )?(call|consult|consultation|demo)\b/i,
];

/** True if the post reads as a pitch/CTA rather than someone with a problem. */
export function isPromotionalPost(post: ScrapedPost): boolean {
  const text = `${post.title ?? ""} ${post.body}`;
  return SELLER_PATTERNS.some((re) => re.test(text));
}

/**
 * Absence of a seller phrase isn't presence of a buyer one -- plenty of
 * off-topic or third-person content matches neither list. This is the other
 * half: the post must itself read as the author asking, not just fail to
 * read as a pitch.
 */
const BUYER_SIGNAL_PATTERNS: RegExp[] = [
  /\?/,
  /\bi'?m (struggling|frustrated|stuck|having trouble)\b/i,
  /\bi (need|could use) (some )?help\b/i,
  /\bcan (anyone|someone|you guys|you all)\b/i,
  /\bdoes anyone (know|have)\b/i,
  /\bany(one)? (recommendations?|advice|tips|suggestions)\b/i,
  /\bhow do (i|you)\b/i,
  /\bwhat'?s the best way\b/i,
  /\blooking for (advice|recommendations?|suggestions|help)\b/i,
  /\bwould appreciate\b/i,
  /\bhelp me\b/i,
  /\bwhat should i (do|use)\b/i,
];

/** True if the post itself reads as the author asking, not just describing. */
export function hasBuyerSignal(post: ScrapedPost): boolean {
  const text = `${post.title ?? ""} ${post.body}`;
  return BUYER_SIGNAL_PATTERNS.some((re) => re.test(text));
}
