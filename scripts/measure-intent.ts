import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadBusinessContext } from "../lib/config";
import { intentQueries, nounQueries } from "../lib/intent";
import { searchReddit } from "../lib/sources/arcticshift";
import { searchHackerNews } from "../lib/sources/hackernews";
import { analyzePost } from "../lib/ai";
import type { ScrapedPost, SourceResult } from "../lib/types";

/**
 * The evidence run.
 *
 * Claim under test: querying a topic noun returns businesses selling the thing,
 * while querying an intent phrase returns people who want it. This script runs
 * both query styles against the same source, scores every post returned, and
 * reports buyer hit rate and cost per buyer for each.
 *
 * Writes nothing to the queue. Read-only, off-account, safe to re-run.
 *
 *   npm run measure -- reddit 4
 *                      ^source ^queries per lane
 */

type Lane = "noun" | "intent";

interface Scored {
  lane: Lane;
  query: string;
  url: string;
  relevance: number;
  intent: number;
  actor: string;
}

interface LaneStats {
  queries: number;
  posts: number;
  units: number;
  buyers: number;
  sellers: number;
  avgIntent: number;
  avgRelevance: number;
}

const INTENT_FLOOR = 0.6;

async function collect(
  source: "reddit" | "hackernews",
  queries: string[],
  lane: Lane,
  subreddits: string[],
): Promise<{ posts: (ScrapedPost & { lane: Lane })[]; units: number; errors: string[] }> {
  const posts: (ScrapedPost & { lane: Lane })[] = [];
  let units = 0;
  const errors: string[] = [];
  for (const q of queries) {
    try {
      const res: SourceResult =
        source === "reddit" ? await searchReddit(q, { subreddits }) : await searchHackerNews(q);
      units += res.unitsCharged;
      for (const p of res.posts) posts.push({ ...p, lane });
      console.log(`  [${lane}] "${q}" -> ${res.posts.length} posts`);
    } catch (err) {
      errors.push(`${lane} "${q}": ${(err as Error).message}`);
      console.warn(`  [${lane}] "${q}" -> FAILED: ${(err as Error).message}`);
    }
  }
  return { posts, units, errors };
}

function summarise(rows: Scored[], queries: number, units: number): LaneStats {
  const n = rows.length || 1;
  return {
    queries,
    posts: rows.length,
    units,
    buyers: rows.filter((r) => r.intent >= INTENT_FLOOR && r.actor !== "seller").length,
    sellers: rows.filter((r) => r.actor === "seller").length,
    avgIntent: Number((rows.reduce((a, r) => a + r.intent, 0) / n).toFixed(3)),
    avgRelevance: Number((rows.reduce((a, r) => a + r.relevance, 0) / n).toFixed(3)),
  };
}

function pct(a: number, b: number): string {
  return b === 0 ? "n/a" : `${((a / b) * 100).toFixed(0)}%`;
}

async function main() {
  const source = (process.argv[2] as "reddit" | "hackernews") ?? "reddit";
  const perLane = Number(process.argv[3] ?? 4);
  const ctx = loadBusinessContext();
  const subs = source === "reddit" ? ctx.platforms.reddit.subreddits ?? [] : [];

  const nouns = nounQueries(ctx).slice(0, perLane);
  const intents = intentQueries(ctx, perLane);

  console.log(`[measure] source=${source} queries/lane=${perLane}`);
  console.log(`[measure] noun lane:   ${nouns.join(" | ")}`);
  console.log(`[measure] intent lane: ${intents.join(" | ")}\n`);

  const a = await collect(source, nouns, "noun", subs);
  const b = await collect(source, intents, "intent", subs);
  const all = [...a.posts, ...b.posts];
  console.log(`\n[measure] scoring ${all.length} posts with the classifier...`);

  const scored: Scored[] = [];
  for (const p of all) {
    try {
      const ai = await analyzePost(ctx, p);
      scored.push({
        lane: p.lane,
        query: p.source_query ?? "",
        url: p.url,
        relevance: ai.relevance,
        intent: ai.intent,
        actor: ai.actor,
      });
    } catch (err) {
      console.warn(`  scoring failed for ${p.url}: ${(err as Error).message}`);
    }
  }

  const noun = summarise(scored.filter((s) => s.lane === "noun"), nouns.length, a.units);
  const intent = summarise(scored.filter((s) => s.lane === "intent"), intents.length, b.units);

  console.log("\n=== buyer-intent hit rate ===");
  console.table({
    noun: { ...noun, buyerRate: pct(noun.buyers, noun.posts), unitsPerBuyer: noun.buyers ? (noun.units / noun.buyers).toFixed(2) : "n/a" },
    intent: { ...intent, buyerRate: pct(intent.buyers, intent.posts), unitsPerBuyer: intent.buyers ? (intent.units / intent.buyers).toFixed(2) : "n/a" },
  });

  const outDir = path.join(process.cwd(), "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `measure-${source}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(
    outFile,
    JSON.stringify({ source, perLane, noun, intent, rows: scored, errors: [...a.errors, ...b.errors] }, null, 2),
  );
  console.log(`\n[measure] raw results written to ${outFile}`);
}

main().catch((err) => {
  console.error("[measure] fatal:", err);
  process.exit(1);
});
