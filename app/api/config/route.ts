import { NextResponse } from "next/server";
import { loadBusinessContext, saveBusinessContext, isConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";
// Two Supabase attempts at 8s each (lib/config.ts) must fit inside this, or
// Vercel's own default duration limit kills the request before the retry
// this route relies on ever gets to run.
export const maxDuration = 30;

export async function GET() {
  // Without this, a Supabase read failure throws and Next answers with a bare
  // 500 and a zero-byte body — nothing the dashboard or the client can act on.
  try {
    return NextResponse.json({ configured: await isConfigured(), context: await loadBusinessContext() });
  } catch (err) {
    // Caught errors are not auto-reported, so without this a sustained outage
    // is invisible in the function logs.
    console.error(`GET /api/config: ${(err as Error).message}`);
    return NextResponse.json(
      { error: `config store unavailable: ${(err as Error).message}` },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  let ctx: unknown;
  try {
    ctx = await req.json();
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
  // A store failure is not the caller's fault, so it must not come back as 400.
  try {
    await saveBusinessContext(ctx as Parameters<typeof saveBusinessContext>[0]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/config: ${(err as Error).message}`);
    return NextResponse.json(
      { ok: false, error: `config store unavailable: ${(err as Error).message}` },
      { status: 503 },
    );
  }
}
