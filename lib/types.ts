export type Platform = "reddit" | "facebook" | "instagram";

export type PostStatus = "pending" | "approved" | "skipped" | "posted" | "failed";

export interface PlatformConfig {
  enabled: boolean;
  subreddits?: string[];
  pages?: string[];
  groups?: string[];
  hashtags?: string[];
  search_terms?: string[];
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
}

/** A post as scraped from a platform, before AI analysis. */
export interface ScrapedPost {
  platform: Platform;
  external_id: string; // stable id used for dedupe (url or platform id)
  url: string;
  author?: string;
  title?: string;
  body: string;
  scraped_at: string; // ISO
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
  category: string; // "new buyer" | "question" | "complaint" | ...
  ai_summary: string;
  draft_comment: string;
  status: PostStatus;
  created_at: string;
  decided_at: string | null;
  posted_at: string | null;
  error: string | null;
}

export interface AiAnalysis {
  relevant: boolean;
  relevance: number; // 0..1
  category: string;
  summary: string;
  comment: string;
}
