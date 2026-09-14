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
