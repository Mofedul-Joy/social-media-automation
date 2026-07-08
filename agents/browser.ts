import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

/**
 * A real Chrome, driven with human-like pacing, using a persistent profile that
 * holds the logged-in Reddit/Facebook/Instagram sessions. This is the VPS-side
 * deterministic equivalent of the Chrome-DevTools-MCP posting layer: no platform
 * API is used, everything happens through the browser as the logged-in user.
 */

export function userDataDir(): string {
  const dir = process.env.CHROME_USER_DATA_DIR || "./data/chrome-profile";
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

export async function launchContext(): Promise<BrowserContext> {
  const headless = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";
  const proxy = process.env.PROXY_URL
    ? { server: process.env.PROXY_URL }
    : undefined;

  return chromium.launchPersistentContext(userDataDir(), {
    headless,
    channel: "chrome",
    proxy,
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

/** Random human-like pause (seconds range from env). */
export function humanDelay(): Promise<void> {
  const min = Number(process.env.ACTION_DELAY_MIN ?? 6);
  const max = Number(process.env.ACTION_DELAY_MAX ?? 18);
  const ms = (min + Math.random() * Math.max(0, max - min)) * 1000;
  return new Promise((r) => setTimeout(r, ms));
}

/** Type text with per-character jitter so it looks hand-typed. */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.click();
  for (const ch of text) {
    await el.type(ch, { delay: 30 + Math.random() * 90 });
  }
}
