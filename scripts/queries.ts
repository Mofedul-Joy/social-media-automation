import "dotenv/config";
import { loadBusinessContext } from "../lib/config";
import { intentQueries, nounQueries, queriesFor } from "../lib/intent";

/** Print the queries a discovery pass would run. Costs nothing; call no API. */
const ctx = loadBusinessContext();
console.log(`topics: ${(ctx.topics ?? ctx.keywords).length}  mode: ${ctx.intent_mode ?? "both"}`);
console.log(`\nfull intent matrix (${intentQueries(ctx).length} queries):`);
for (const q of intentQueries(ctx)) console.log("  " + q);
console.log(`\nnoun baseline (${nounQueries(ctx).length}):`);
for (const q of nounQueries(ctx)) console.log("  " + q);
for (const p of ["reddit", "facebook", "hackernews", "stackexchange"] as const) {
  if (!ctx.platforms[p]?.enabled) continue;
  const qs = queriesFor(ctx, p);
  console.log(`\n${p} would run ${qs.length} this pass:`);
  for (const q of qs) console.log("  " + q);
}
