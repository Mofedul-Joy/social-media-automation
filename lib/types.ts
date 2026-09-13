/**
 * Two lanes, deliberately separate:
 *
 *  DISCOVERY  read-only, off-account, third party APIs over public data.
 *             A block here costs a proxy IP, never the client's account.
 *  ENGAGEMENT there is no auto-poster. Approving a candidate opens the real
 *             post and copies the drafted comment; a human pastes it and
 *             posts it themselves, from their own already-logged-in browser.
 *             No platform API can write a comment to someone else's post, and
 *             browser automation was ruled out as an account-ban risk, so
 *             this applies equally to every platform with a URL.
 *
 * `Platform` covers both lanes. Instagram is discovery-excluded: its search
 * surfaces sellers, not buyers. Hacker News and Stack Overflow are
 * discovery-only sources but can still be engaged with manually like any
 * other platform. Threads has no working discovery source right now — its
 * only source was EnsembleData, dropped for cost — so it is kept in the type
 * but out of DISCOVERY_PLATFORMS.
 */
export type Platform =
  | "reddit"
  | "facebook"
  | "instagram"
  | "threads"
  | "hackernews"
  | "stackexchange";

export const DISCOVERY_PLATFORMS: Platform[] = ["reddit", "facebook", "hackernews", "stackexchange"];

export type PostStatus = "pending" | "approved" | "skipped" | "posted" | "failed";

export interface PlatformConfig {
  enabled: boolean;
  /** Reddit: subreddits to restrict keyword search to. Empty means site-wide. */
  subreddits?: string[];
  /** Facebook: group URLs to poll directly with groups/posts. */
  groups?: string[];
  /** Facebook: pages (engagement lane only). */
  pages?: string[];
  /** Instagram: hashtags (engagement lane only). */
  hashtags?: string[];
  /**
   * Literal queries to run as-is. Left empty, discovery uses the generated
   * intent matrix instead, which is what actually surfaces buyers.
   */
  search_terms?: string[];
  /** Cap on generated intent queries per run, to bound API spend. */
  max_queries?: number;
}

export interface BusinessContext {
  business_name: string;
  description: string;
  target_audience: string;
  keywords: string[];
  comment_tone: string;
  avoid: string[];
  platforms: Record<Platform, PlatformConfig>;
  relevance_threshold: number;

  // --- intent lane ---------------------------------------------------------
  /**
   * The nouns the business is about ("home gym", "AI automation"). Queried
   * alone these return sellers. The intent generator wraps them in buyer
   * phrasing before they ever reach an API.
   */
  topics?: string[];
  /** "product" (people buying a thing), "service" (people hiring help), or "both". */
  intent_mode?: "product" | "service" | "both";
  /** Override the built-in frames. Each must contain the {topic} placeholder. */
  intent_frames?: string[];
  /** Minimum intent score to enter the approval queue. */
  intent_threshold?: number;
}

/** A post as pulled from a discovery source, before AI analysis. */
export interface ScrapedPost {
  platform: Platform;
  external_id: string; // stable id used for dedupe (url or platform id)
  url: string;
  author?: string;
  title?: string;
  body: string;
  scraped_at: string; // ISO
  /** ISO timestamp of the post itself where the source gives one. */
  posted_at?: string;
  /** The query that surfaced this post, so query yield can be measured. */
  source_query?: string;
}

/** A candidate row in the approval queue after AI analysis. */
export interface Candidate {
  id: number;
  platform: Platform;
  external_id: string;
  url: string;
  author: string | null;
  title: string | null;
  body: string;
  relevance: number;
  /** Second axis: is this person expressing intent, or is it another seller. */
  intent_score: number;
  category: string; // "new buyer" | "question" | "complaint" | ...
  ai_summary: string;
  draft_comment: string;
  source_query: string | null;
  status: PostStatus;
  created_at: string;
  decided_at: string | null;
  posted_at: string | null;
  error: string | null;
}

export interface AiAnalysis {
  relevant: boolean;
  relevance: number; // 0..1  topical fit
  intent: number; // 0..1  buyer/hirer intent, independent of topical fit
  /** Who is speaking. Sellers score high on relevance and low on intent. */
  actor: "buyer" | "seller" | "peer" | "unclear";
  category: string;
  summary: string;
  comment: string;
}

/** One discovery source's result for one query. */
export interface SourceResult {
  posts: ScrapedPost[];
  /** Vendor units/credits this call consumed, where the vendor reports it. */
  unitsCharged: number;
  errors: string[];
}
