import type { BrowserContext } from "playwright";
import { humanDelay, humanType } from "./browser";
import type { Candidate } from "../lib/types";

/**
 * Post a comment on a Reddit post as the logged-in user.
 * Navigates to the post URL, opens the comment box, types the draft, submits.
 * Throws if not logged in or the UI can't be found.
 */
export async function postRedditComment(ctx: BrowserContext, cand: Candidate): Promise<void> {
  const page = await ctx.newPage();
  try {
    await page.goto(cand.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await humanDelay();

    // Detect logged-out state (Reddit shows a "Log In" button in the header).
    const loginBtn = page.getByRole("button", { name: /log ?in/i });
    if (await loginBtn.first().isVisible().catch(() => false)) {
      throw new Error("Reddit session not logged in - run `npm run login` and sign in once.");
    }

    // New Reddit uses a comment composer; the box appears on click/focus.
    // Try the rich-text editor first, then fall back to a plain textarea.
    const composer = page
      .locator('[contenteditable="true"], [data-testid="comment-submission-form-richtext"] div[role="textbox"]')
      .first();
    const textarea = page.locator("textarea").first();

    let typed = false;
    if (await composer.isVisible().catch(() => false)) {
      await composer.click();
      await page.keyboard.type(cand.draft_comment, { delay: 40 });
      typed = true;
    } else if (await textarea.isVisible().catch(() => false)) {
      await humanType(page, "textarea", cand.draft_comment);
      typed = true;
    }
    if (!typed) throw new Error("Could not locate the Reddit comment box (UI may have changed).");

    await humanDelay();

    // Submit: the "Comment" button becomes enabled once text is present.
    const submit = page.getByRole("button", { name: /^comment$/i }).last();
    await submit.click({ timeout: 15000 });
    await page.waitForTimeout(4000);
  } finally {
    await page.close();
  }
}
