import "dotenv/config";
import { runDiscovery } from "../lib/discover";

async function main() {
  console.log("[discover] starting discovery pass...");
  const t0 = Date.now();
  const r = await runDiscovery();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("[discover] done in", secs + "s");
  console.table(r.byPlatform);
  console.log(
    `[discover] scraped=${r.scraped} analyzed=${r.analyzed} queued=${r.queued} ` +
      `belowThreshold=${r.belowThreshold} duplicates=${r.skippedDuplicate}`,
  );
}

main().catch((err) => {
  console.error("[discover] fatal:", err);
  process.exit(1);
});
