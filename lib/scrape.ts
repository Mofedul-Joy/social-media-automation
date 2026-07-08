import type { BrowserContext, Page } from "playwright";
import type { BusinessContext, Platform, ScrapedPost } from "./types";

/**
 * Discovery layer — NO third-party scraping service, NO platform API keys.
 * Everything is read through the same logged-in Chrome (Playwright) that posts
 * comments. Because the browser carries the real session cookies and runs from a
 * residential IP, it sees exactly what the account sees: real-time, free.
 *
 * - Reddit:   navigate to the authenticated `.json` endpoints (a logged-in
 *             session is served structured JSON — clean and stable).
 * - Facebook: navigate the in-app search/feed and read rendered post text (DOM).
 * - Instagram:navigate hashtag/explore pages and read rendered post text (DOM).
 *
 * FB/IG DOM extraction is intentionally defensive and marked for live tuning in
 * Phase 2 once the accounts exist — their markup is obfuscated and drifts.
 */

const REDDIT_LIMIT = 15;

/** Stable dedupe id from a URL (host+path, no query/fragment). */
function externalIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.replace(/\/$/, "");
  } catch {
    return url;
  }
}

function termsFor(platform: Platform, ctx: BusinessContext): string[] {
  const cfg = ctx.platforms[platform];
  return cfg.search_terms?.length ? cfg.search_terms : ctx.keywords;
}

// ---------------------------------------------------------------------------
// Reddit — authenticated JSON via the logged-in browser
// ---------------------------------------------------------------------------

interface RedditChild {
  data: {
    id: string;
    permalink: string;
    subreddit: string;
    author: string;
    title: string;
    selftext: string;
    created_utc: number;
  };
}

async function fetchJsonInPage(page: Page, url: string): Promise<any | null> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const text = await page.evaluate(() => document.body.innerText);
  try {
    return JSON.parse(text);
  } catch {
    return null; // got an HTML block/login page instead of JSON
  }
}

async function scrapeReddit(context: BrowserContext, ctx: BusinessContext): Promise<ScrapedPost[]> {
  const cfg = ctx.platforms.reddit;
  const terms = termsFor("reddit", ctx);
  const urls: string[] = [];

  if (cfg.subreddits?.length) {
    for (const sub of cfg.subreddits) {
      for (const term of terms) {
        urls.push(
          `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json` +
            `?q=${encodeURIComponent(term)}&restrict_sr=1&sort=new&t=week&limit=${REDDIT_LIMIT}`,
        );
      }
    }
  } else {
    for (const term of terms) {
      urls.push(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(term)}` +
          `&sort=new&t=week&limit=${REDDIT_LIMIT}`,
      );
    }
  }

  const page = await context.newPage();
  const seen = new Set<string>();
  const out: ScrapedPost[] = [];
  try {
    for (const url of urls) {
      const json = await fetchJsonInPage(page, url);
      const children: RedditChild[] = json?.data?.children ?? [];
      if (!json) {
        console.warn(`[scrape] reddit returned non-JSON (blocked/not logged in): ${url}`);
        continue;
      }
      for (const c of children) {
        const d = c.data;
        if (!d?.permalink) continue;
        const fullUrl = `https://www.reddit.com${d.permalink}`;
        const id = externalIdFromUrl(fullUrl);
        if (seen.has(id)) continue;
        seen.add(id);
        const body = (d.selftext || "").trim();
        out.push({
          platform: "reddit",
          external_id: id,
          url: fullUrl,
          author: d.author,
          title: d.title,
          body: body || d.title || "",
          scraped_at: new Date().toISOString(),
        });
      }
    }
  } finally {
    await page.close();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Facebook / Instagram — rendered DOM via the logged-in browser (Phase 2 tuning)
// ---------------------------------------------------------------------------

async function scrapeFacebook(context: BrowserContext, ctx: BusinessContext): Promise<ScrapedPost[]> {
  const terms = termsFor("facebook", ctx);
  const page = await context.newPage();
  const seen = new Set<string>();
  const out: ScrapedPost[] = [];
  try {
    for (const term of terms) {
      const url = `https://www.facebook.com/search/posts?q=${encodeURIComponent(term)}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);
      // Feed posts render as role="article"; text lives in descendant spans/divs.
      const posts = await page.evaluate(() => {
        const items: { url: string; text: string }[] = [];
        document.querySelectorAll('[role="article"]').forEach((el) => {
          const text = (el as HTMLElement).innerText?.trim() || "";
          const link = el.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]');
          const href = link?.getAttribute("href") || "";
          if (text.length > 40 && href) items.push({ url: href, text });
        });
        return items;
      });
      for (const p of posts) {
        const abs = p.url.startsWith("http") ? p.url : `https://www.facebook.com${p.url}`;
        const id = externalIdFromUrl(abs);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          platform: "facebook",
          external_id: id,
          url: abs,
          body: p.text.slice(0, 4000),
          scraped_at: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn(`[scrape] facebook failed: ${(err as Error).message}`);
  } finally {
    await page.close();
  }
  return out;
}

async function scrapeInstagram(context: BrowserContext, ctx: BusinessContext): Promise<ScrapedPost[]> {
  const cfg = ctx.platforms.instagram;
  const tags = (cfg.hashtags?.length ? cfg.hashtags : termsFor("instagram", ctx)).map((t) =>
    t.replace(/^#/, ""),
  );
  const page = await context.newPage();
  const seen = new Set<string>();
  const out: ScrapedPost[] = [];
  try {
    for (const tag of tags) {
      const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);
      // Grid links to individual posts (/p/<shortcode>/); we collect the links,
      // the AI reads the caption once the worker opens each post.
      const links = await page.evaluate(() => {
        const hrefs: string[] = [];
        document.querySelectorAll('a[href*="/p/"]').forEach((a) => {
          const h = a.getAttribute("href");
          if (h) hrefs.push(h);
        });
        return Array.from(new Set(hrefs)).slice(0, 20);
      });
      for (const href of links) {
        const abs = href.startsWith("http") ? href : `https://www.instagram.com${href}`;
        const id = externalIdFromUrl(abs);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          platform: "instagram",
          external_id: id,
          url: abs,
          body: `Instagram post under #${tag}`, // caption fetched at review/post time
          scraped_at: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn(`[scrape] instagram failed: ${(err as Error).message}`);
  } finally {
    await page.close();
  }
  return out;
}

/** Scrape recent candidate posts for one platform through the logged-in browser. */
export async function scrapePlatform(
  context: BrowserContext,
  platform: Platform,
  ctx: BusinessContext,
): Promise<ScrapedPost[]> {
  const cfg = ctx.platforms[platform];
  if (!cfg?.enabled) return [];
  switch (platform) {
    case "reddit":
      return scrapeReddit(context, ctx);
    case "facebook":
      return scrapeFacebook(context, ctx);
    case "instagram":
      return scrapeInstagram(context, ctx);
  }
}
