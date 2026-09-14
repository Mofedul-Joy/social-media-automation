import type { BusinessContext } from "./types";

/**
 * Intent query generation.
 *
 * The measured failure of the first discovery runs: querying a topic noun
 * ("home gym") returns businesses selling the thing, because that is who
 * publishes about it. Relevance is not intent.
 *
 * Buyers announce themselves with a small, stable set of phrasings. Wrapping
 * the topic in those phrasings before it reaches an API flips the result set
 * from sellers to people asking. This file is that wrapper: a deterministic
 * cross product of intent frames and client topics. No model call, no cost.
 */

/** Someone about to buy a thing. */
const PRODUCT_FRAMES = [
  "looking to buy {topic}",
  "thinking about getting {topic}",
  "which {topic} should I get",
  "best {topic} for beginners",
  "{topic} recommendations",
  "anyone recommend {topic}",
  "worth buying {topic}",
  "help me choose {topic}",
  "about to buy {topic}",
  "is {topic} worth it",
];

/** Someone about to hire help. */
const SERVICE_FRAMES = [
  "looking for someone to build {topic}",
  "need help with {topic}",
  "how do I build {topic}",
  "anyone know a good {topic} developer",
  "hire someone for {topic}",
  "recommendations for {topic} agency",
  "struggling with {topic}",
  "is there a service for {topic}",
  "quotes for {topic}",
  "who can build {topic}",
];

/** Topic nouns on their own. Kept only as the measurement baseline. */
export function nounQueries(ctx: BusinessContext): string[] {
  return dedupe(topicsOf(ctx));
}

function topicsOf(ctx: BusinessContext): string[] {
  const t = ctx.topics?.length ? ctx.topics : ctx.keywords;
  return t.map((s) => s.trim()).filter(Boolean);
}

function framesOf(ctx: BusinessContext): string[] {
  if (ctx.intent_frames?.length) return ctx.intent_frames;
  switch (ctx.intent_mode ?? "both") {
    case "product":
      return PRODUCT_FRAMES;
    case "service":
      return SERVICE_FRAMES;
    default:
      return [...SERVICE_FRAMES, ...PRODUCT_FRAMES];
  }
}

function dedupe(xs: string[]): string[] {
  return Array.from(new Set(xs.map((x) => x.toLowerCase().replace(/\s+/g, " ").trim())));
}

/**
 * Interleave frames across topics so a truncated run still covers every topic
 * rather than spending the whole budget on the first one.
 */
function interleave(topics: string[], frames: string[]): string[] {
  const out: string[] = [];
  for (const frame of frames) {
    for (const topic of topics) {
      out.push(frame.replace(/\{topic\}/g, topic));
    }
  }
  return out;
}

/**
 * The intent matrix: every frame applied to every topic, ordered so the first
 * N are spread across all topics. `limit` bounds API spend per run.
 */
export function intentQueries(ctx: BusinessContext, limit?: number): string[] {
  const qs = dedupe(interleave(topicsOf(ctx), framesOf(ctx)));
  return limit && limit > 0 ? qs.slice(0, limit) : qs;
}

/**
 * The queries one platform should actually run this pass. Explicit
 * `search_terms` in the config win, since a human put them there on purpose.
 */
export function queriesFor(
  ctx: BusinessContext,
  platform: keyof BusinessContext["platforms"],
): string[] {
  const cfg = ctx.platforms[platform];
  const limit = cfg?.max_queries ?? 12;
  if (cfg?.search_terms?.length) return cfg.search_terms.slice(0, limit);
  return intentQueries(ctx, limit);
}

/**
 * Same frame treatment as intentQueries, applied to ONE ad-hoc topic (what a
 * human types into a free-text search box on demand) instead of the
 * configured ctx.topics list. So typing "AI agent" doesn't search that
 * literal phrase -- it searches "need help with AI agent" and its siblings.
 */
export function intentQueriesFor(topic: string, ctx: BusinessContext, limit?: number): string[] {
  const t = topic.trim();
  if (!t) return [];
  const qs = dedupe(framesOf(ctx).map((f) => f.replace(/\{topic\}/g, t)));
  return limit && limit > 0 ? qs.slice(0, limit) : qs;
}

/**
 * The single most universally-readable buyer-signal phrasing, for a caller
 * that can only afford exactly one query -- a paid API call (Facebook), or a
 * source under a tight time budget (Reddit, already at its rate-courtesy
 * ceiling). Picking a fixed frame instead of frames[0] because SERVICE_FRAMES
 * is ordered for the batch matrix in intentQueries/queriesFor (unaffected by
 * this), not for "best single pick" -- some of those frames ("who can build
 * {topic}") read badly against an arbitrary typed phrase.
 */
export function primaryIntentQuery(topic: string, ctx: BusinessContext): string {
  const t = topic.trim();
  if (!t) return t;
  const frame = (ctx.intent_mode ?? "both") === "product" ? "looking to buy {topic}" : "need help with {topic}";
  return frame.replace(/\{topic\}/g, t);
}
