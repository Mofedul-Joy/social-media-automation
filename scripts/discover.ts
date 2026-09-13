import "dotenv/config";
import { runDiscovery } from "../lib/discover";
import type { Platform } from "../lib/types";

/**
 * One discovery pass. Runs off-account through the vendor APIs only; it never
 * touches the client's logged-in browser.
 *
 *   npm run discover                 all enabled discovery platforms
 *   npm run discover -- reddit       one platform
 */
async function main() {
  const only = process.argv.slice(2).filter(Boolean) as Platform[];
  console.log(`[discover] starting${only.length ? ` (${only.join(", ")})` : ""}...`);
  const t0 = Date.now();
  const r = await runDiscovery(only.length ? { platforms: only } : {});
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`[discover] done in ${secs}s`);
  if (Object.keys(r.byPlatform).length) console.table(r.byPlatform);
  console.log(
    `[discover] fetched=${r.fetched} stale=${r.stale} duplicates=${r.skippedDuplicate} ` +
      `analyzed=${r.analyzed} queued=${r.queued} belowThreshold=${r.belowThreshold}`,
  );
  const units = Object.entries(r.unitsCharged)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[discover] units spent: ${units || "none"}`);
  for (const e of r.errors) console.warn(`[discover] ! ${e}`);
}

main().catch((err) => {
  console.error("[discover] fatal:", err);
  process.exit(1);
});
