import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadBusinessContext } from "../lib/config";
import { intentQueries } from "../lib/intent";
import { getJson } from "../lib/sources/http";
import { groupsMentionedIn } from "../lib/sources/socialapis";

/**
 * Find which Facebook Groups the buyers are in.
 *
 * Keyword search on Facebook is expensive per post, flaky, and returns no
 * timestamps, so it is the wrong tool for routine discovery. It is the right
 * tool for exactly this: run it once with intent phrases, harvest the group
 * URLs the matching posts came from, and poll those groups cheaply forever
 * after. Search finds groups. Groups find posts.
 *
 *   npm run fb-groups -- 6        (6 intent queries)
 *
 * Prints a `groups` array ready to paste into config/business_context.json.
 */

const BASE = "https://api.socialapis.io";

async function main() {
  const limit = Number(process.argv[2] ?? 6);
  const ctx = loadBusinessContext();
  const token = process.env.SOCIALAPIS_TOKEN;
  if (!token) throw new Error("SOCIALAPIS_TOKEN is not set");

  const queries = intentQueries(ctx, limit);
  console.log(`[fb-groups] running ${queries.length} intent queries...`);

  const found = new Map<string, { name?: string; hits: number; queries: Set<string> }>();
  for (const q of queries) {
    const params = new URLSearchParams({ query: q, recent_posts: "true" });
    try {
      const json = await getJson(`${BASE}/facebook/search/posts?${params}`, {
        headers: { "x-api-token": token, accept: "application/json" },
      });
      const groups = groupsMentionedIn(json);
      console.log(`  "${q}" -> ${groups.length} group(s)`);
      for (const g of groups) {
        const rec = found.get(g.url) ?? { name: g.name, hits: 0, queries: new Set<string>() };
        rec.hits++;
        rec.queries.add(q);
        rec.name ??= g.name;
        found.set(g.url, rec);
      }
    } catch (err) {
      console.warn(`  "${q}" -> FAILED: ${(err as Error).message}`);
    }
  }

  // Groups surfaced by more than one intent phrase are where the buyers cluster.
  const ranked = Array.from(found, ([url, r]) => ({ url, name: r.name, hits: r.hits, queries: [...r.queries] }))
    .sort((a, b) => b.hits - a.hits);

  console.log(`\n[fb-groups] ${ranked.length} distinct group(s), ranked by how many intent phrases hit them:`);
  console.table(ranked.map((g) => ({ name: g.name ?? "?", hits: g.hits, url: g.url })));

  const outFile = path.join(process.cwd(), "data", "fb-groups.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(ranked, null, 2));
  console.log(`\n[fb-groups] written to ${outFile}`);
  console.log(`[fb-groups] paste into config/business_context.json under platforms.facebook.groups:`);
  console.log(JSON.stringify(ranked.map((g) => g.url), null, 2));
}

main().catch((err) => {
  console.error("[fb-groups] fatal:", err);
  process.exit(1);
});
