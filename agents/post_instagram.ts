import type { BrowserContext } from "playwright";
import { humanDelay } from "./browser";
import type { Candidate } from "../lib/types";

/**
 * PHASE 2. Post a comment on an Instagram post as the logged-in user.
 * IG is the most sensitive platform: keep daily caps low, observe an account
 * warm-up period, and expect selector tuning against the live account.
 */
export async function postInstagramComment(ctx: BrowserContext, cand: Candidate): Promise<void> {
  const page = await ctx.newPage();
  try {
    await page.goto(cand.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await humanDelay();

    if (await page.getByRole("button", { name: /log in/i }).first().isVisible().catch(() => false)) {
      throw new Error("Instagram session not logged in - run `npm run login` and sign in once.");
    }

    const box = page.getByRole("textbox", { name: /add a comment/i }).first();
    if (!(await box.isVisible().catch(() => false))) {
      throw new Error("Could not locate the Instagram comment box (UI may have changed).");
    }
    await box.click();
    await page.keyboard.type(cand.draft_comment, { delay: 55 });
    await humanDelay();

    const postBtn = page.getByRole("button", { name: /^post$/i }).first();
    await postBtn.click({ timeout: 15000 });
    await page.waitForTimeout(4000);
  } finally {
    await page.close();
  }
}
