import { loadBusinessContext } from "./config";
import { scrapePlatform } from "./scrape";
import { analyzePost } from "./ai";
import { alreadySeen, insertCandidate, getCandidate } from "./store";
import { logActivity, ensureHeader } from "./sheets";
import { launchContext } from "../agents/browser";
import type { Platform } from "./types";

export interface DiscoverResult {
  scraped: number;
  analyzed: number;
  queued: number;
  belowThreshold: number;
  skippedDuplicate: number;
  byPlatform: Record<string, number>;
}

/**
 * One discovery pass: for each enabled platform, scrape recent posts, run each
 * new post through the AI relevance filter, and queue the ones that clear the
 * threshold for human approval. Deduped against everything already seen.
 */
export async function runDiscovery(): Promise<DiscoverResult> {
  const ctx = loadBusinessContext();
  await ensureHeader();

  const result: DiscoverResult = {
    scraped: 0,
    analyzed: 0,
    queued: 0,
    belowThreshold: 0,
    skippedDuplicate: 0,
    byPlatform: {},
  };

  const platforms: Platform[] = ["reddit", "facebook", "instagram"];
  const enabled = platforms.filter((p) => ctx.platforms[p]?.enabled);
  if (enabled.length === 0) return result;

  // One shared logged-in browser reads every platform (no scraping API/keys).
  const browser = await launchContext();
  try {
    for (const platform of enabled) {
      const posts = await scrapePlatform(browser, platform, ctx);
      result.scraped += posts.length;

      for (const post of posts) {
        if (alreadySeen(post.platform, post.external_id)) {
          result.skippedDuplicate++;
          continue;
        }
        let ai;
        try {
          ai = await analyzePost(ctx, post);
        } catch (err) {
          console.warn(`[discover] AI analysis failed for ${post.url}: ${(err as Error).message}`);
          continue;
        }
        result.analyzed++;

        if (!ai.relevant || ai.relevance < ctx.relevance_threshold) {
          result.belowThreshold++;
          continue;
        }

        const id = insertCandidate(post, ai);
        if (id) {
          result.queued++;
          result.byPlatform[platform] = (result.byPlatform[platform] ?? 0) + 1;
          const cand = getCandidate(id);
          if (cand) await logActivity(cand, "discovered");
        }
      }
    }
  } finally {
    await browser.close();
  }

  return result;
}
