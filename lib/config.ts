import { getSupabase } from "./supabaseClient";
import exampleContext from "../config/business_context.example.json";
import type { BusinessContext } from "./types";

/**
 * The client's business context. This is the AI's core instruction set: what the
 * business is, who to engage, and how comments should sound. Stored as a single
 * row in Supabase (Vercel's filesystem is read-only, so it cannot live on disk).
 * The bundled example file is the fallback until the client brief lands.
 */
const ROW_ID = 1;

/**
 * Per-attempt ceiling. Supabase has no timeout of its own here, and the
 * function's own execution budget is what kills a hung read — so two attempts
 * must fit well inside it, or a slow failure returns the same bare 500 this
 * retry exists to remove.
 *
 * Was 3_000: direct REST calls to the same Supabase project from outside
 * Vercel consistently complete in 0.2-0.5s, but requests from the deployed
 * function were timing out on both attempts back to back (measured live,
 * 2026-09-14) — a too-tight budget killing an otherwise-working but slower
 * connection (e.g. cold-start/IPv6 path overhead on Vercel's network), not a
 * genuinely hung one. Raised to give a real-but-slow connection room to land.
 */
const ATTEMPT_TIMEOUT_MS = 8_000;

async function withTimeout<T>(run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`supabase read timed out after ${ATTEMPT_TIMEOUT_MS}ms`)), ATTEMPT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * One retry on failure. Reads here fail intermittently in production — a
 * transient Supabase/network blip on an otherwise healthy project, measured at
 * roughly 1 request in 20 — and a single retry turns that into a non-event
 * rather than a failed dashboard load. A permanent failure (bad key, missing
 * table) costs one wasted call, which is the accepted price of that.
 */
async function retryOnce<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await withTimeout(run);
  } catch (err) {
    // Logged, not swallowed: if the retry also fails for a different reason,
    // this is the only place the first cause is ever visible.
    console.warn(`config store: first attempt failed, retrying: ${(err as Error).message}`);
    return await withTimeout(run);
  }
}

export async function loadBusinessContext(): Promise<BusinessContext> {
  const data = await retryOnce(async () => {
    const { data, error } = await getSupabase()
      .from("business_context")
      .select("context")
      .eq("id", ROW_ID)
      .maybeSingle();
    if (error) throw error;
    return data;
  });
  return (data?.context as BusinessContext) ?? (exampleContext as unknown as BusinessContext);
}

export async function saveBusinessContext(ctx: BusinessContext): Promise<void> {
  const { error } = await getSupabase()
    .from("business_context")
    .upsert({ id: ROW_ID, context: ctx, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function isConfigured(): Promise<boolean> {
  const data = await retryOnce(async () => {
    const { data, error } = await getSupabase()
      .from("business_context")
      .select("id")
      .eq("id", ROW_ID)
      .maybeSingle();
    if (error) throw error;
    return data;
  });
  return !!data;
}
