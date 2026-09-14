import type { AiAnalysis, BusinessContext, ScrapedPost } from "./types";

/**
 * Vercel-side stand-in for lib/ai.ts's analyzePost. Same name and signature, so
 * call sites only change their import path. The real work runs on the VPS
 * worker, which is the only place the `claude` CLI (and Hon's subscription
 * token) exists.
 */
const WORKER_URL = process.env.AI_WORKER_URL;
const WORKER_SECRET = process.env.AI_WORKER_SECRET;
/** Slightly above the CLI's own 120s timeout, so the worker's error wins. */
const TIMEOUT_MS = 130_000;

export async function analyzePost(ctx: BusinessContext, post: ScrapedPost): Promise<AiAnalysis> {
  if (!WORKER_URL || !WORKER_SECRET) throw new Error("AI_WORKER_URL / AI_WORKER_SECRET not configured");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_URL}/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${WORKER_SECRET}` },
      body: JSON.stringify({ post, businessContext: ctx }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI worker ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
    return (await res.json()) as AiAnalysis;
  } finally {
    clearTimeout(t);
  }
}
