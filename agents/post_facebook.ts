import type { BrowserContext } from "playwright";
import { humanDelay } from "./browser";
import type { Candidate } from "../lib/types";

/**
 * PHASE 2. Post a comment on a Facebook post as the logged-in user.
 * Facebook's DOM is obfuscated and A/B-tested, so selectors here are a starting
 * point to be hardened against the live account during Phase 2 tuning.
 */
export async function postFacebookComment(ctx: BrowserContext, cand: Candidate): Promise<void> {
  const page = await ctx.newPage();
  try {
    await page.goto(cand.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await humanDelay();

    if (await page.getByRole("link", { name: /log in/i }).first().isVisible().catch(() => false)) {
      throw new Error("Facebook session not logged in - run `npm run login` and sign in once.");
    }

    // The comment box is a contenteditable with aria-label "Write a comment".
    const box = page.getByRole("textbox", { name: /write a (public )?comment/i }).first();
    if (!(await box.isVisible().catch(() => false))) {
      throw new Error("Could not locate the Facebook comment box (UI may have changed).");
    }
    await box.click();
    await page.keyboard.type(cand.draft_comment, { delay: 45 });
    await humanDelay();
    await page.keyboard.press("Enter"); // FB submits a comment on Enter
    await page.waitForTimeout(4000);
  } finally {
    await page.close();
  }
}
