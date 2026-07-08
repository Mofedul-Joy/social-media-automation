import "dotenv/config";
import { launchContext, humanDelay } from "./browser";
import { postRedditComment } from "./post_reddit";
import { postFacebookComment } from "./post_facebook";
import { postInstagramComment } from "./post_instagram";
import { nextApproved, markPosted, markFailed, postedTodayCount, getCandidate } from "../lib/store";
import { logActivity } from "../lib/sheets";
import type { BrowserContext } from "playwright";
import type { Candidate, Platform } from "../lib/types";

const POSTERS: Record<Platform, (ctx: BrowserContext, c: Candidate) => Promise<void>> = {
  reddit: postRedditComment,
  facebook: postFacebookComment,
  instagram: postInstagramComment,
};

function dailyCap(platform: Platform): number {
  const map: Record<Platform, string> = {
    reddit: "MAX_REDDIT_POSTS_PER_DAY",
    facebook: "MAX_FACEBOOK_POSTS_PER_DAY",
    instagram: "MAX_INSTAGRAM_POSTS_PER_DAY",
  };
  return Number(process.env[map[platform]] ?? 10);
}

/**
 * Posting worker: drains the approved queue, one comment at a time, through a
 * real browser, enforcing per-platform daily caps and human-like pacing.
 * Only comments explicitly approved in the dashboard are ever posted.
 */
async function main() {
  const approved = nextApproved(undefined, 100);
  if (approved.length === 0) {
    console.log("[worker] nothing approved to post. Exiting.");
    return;
  }
  console.log(`[worker] ${approved.length} approved comment(s) in queue.`);

  const ctx = await launchContext();
  const postedThisRun: Record<Platform, number> = { reddit: 0, facebook: 0, instagram: 0 };

  try {
    for (const cand of approved) {
      const platform = cand.platform;
      const cap = dailyCap(platform);
      const already = postedTodayCount(platform);
      if (already + postedThisRun[platform] >= cap) {
        console.log(`[worker] daily cap reached for ${platform} (${cap}). Skipping ${cand.url}`);
        continue;
      }

      // Re-check status in case the dashboard changed it mid-run.
      const fresh = getCandidate(cand.id);
      if (!fresh || fresh.status !== "approved") continue;

      console.log(`[worker] posting to ${platform}: ${cand.url}`);
      try {
        await POSTERS[platform](ctx, cand);
        markPosted(cand.id);
        postedThisRun[platform]++;
        const done = getCandidate(cand.id);
        if (done) await logActivity(done, "posted");
        console.log(`[worker]  -> posted (${platform} ${postedThisRun[platform]}/${cap} today)`);
      } catch (err) {
        const msg = (err as Error).message;
        markFailed(cand.id, msg);
        const failed = getCandidate(cand.id);
        if (failed) await logActivity(failed, "failed");
        console.warn(`[worker]  -> FAILED: ${msg}`);
      }

      await humanDelay();
    }
  } finally {
    await ctx.close();
  }

  console.log("[worker] run complete:", postedThisRun);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
