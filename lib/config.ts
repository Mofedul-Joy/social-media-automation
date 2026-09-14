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

export async function loadBusinessContext(): Promise<BusinessContext> {
  const { data, error } = await getSupabase()
    .from("business_context")
    .select("context")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) throw error;
  return (data?.context as BusinessContext) ?? (exampleContext as unknown as BusinessContext);
}

export async function saveBusinessContext(ctx: BusinessContext): Promise<void> {
  const { error } = await getSupabase()
    .from("business_context")
    .upsert({ id: ROW_ID, context: ctx, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function isConfigured(): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("business_context")
    .select("id")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}
