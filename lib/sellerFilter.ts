import { CATEGORY_BUYER, CATEGORY_GENERAL } from "./types";
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
  /\bcheck (out )?my\b/i,
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
  // "I help businesses and agencies build systems" and "check my profile or
  // BIO to learn more about my services" both reached the top of a real
  // result list as leads on 2026-09-22. Neither matched anything above.
  /\bi help\b/i,
  /\bmy services\b/i,
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
  // Was a bare /\?/, which made every post containing a question mark a lead.
  // Marketing copy is full of rhetorical hooks ("Struggling with lead gen?"),
  // so on 2026-09-22 both results of a live search ranked top as buyers on
  // nothing but punctuation. Require an actual interrogative clause: a wh-word
  // or auxiliary verb, then a question mark within the same sentence.
  // Known gap: a second-person hook ("Do you want more leads?") still matches.
  // Narrowing that needs a call on what gets suppressed, so it is left open.
  /\b(who|what|when|where|why|how|which|can|could|should|would|does|do|did|is|are|any(?:one|body))\b[^.!?\n]{0,120}\?/i,
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

/**
 * The category every discovery result carries, derived from the two regex
 * flags above and nothing else — discovery has no model call to spend. A post
 * that asks for something is a lead; one that merely talks about the topic is
 * conversation. `/api/analyze-post` replaces this with the AI's own label for
 * the single post a human chooses to act on.
 */
export function categorize(post: ScrapedPost): string {
  return hasBuyerSignal(post) ? CATEGORY_BUYER : CATEGORY_GENERAL;
}
