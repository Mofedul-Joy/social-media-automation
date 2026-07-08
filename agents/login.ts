import "dotenv/config";
import { launchContext } from "./browser";

/**
 * One-time (per platform) interactive login. Opens a real Chrome window using
 * the persistent profile so you can sign in to Reddit, Facebook, and Instagram
 * by hand. Sessions persist in CHROME_USER_DATA_DIR for the posting worker.
 *
 * Force non-headless regardless of .env so the operator can actually log in.
 */
async function main() {
  process.env.HEADLESS = "false";
  const ctx = await launchContext();
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  await page.goto("https://www.reddit.com/login");
  console.log("\n=== LOGIN SETUP ===");
  console.log("A Chrome window is open with the persistent profile.");
  console.log("Log in to each account in this window (in tabs):");
  console.log("  - https://www.reddit.com/login");
  console.log("  - https://www.facebook.com/login");
  console.log("  - https://www.instagram.com/accounts/login/");
  console.log("Sessions are saved automatically. Close the window when done.\n");

  // Keep the process alive until the operator closes the browser.
  await new Promise<void>((resolve) => {
    ctx.on("close", () => resolve());
  });
  console.log("[login] browser closed, sessions saved.");
}

main().catch((err) => {
  console.error("[login] error:", err);
  process.exit(1);
});
