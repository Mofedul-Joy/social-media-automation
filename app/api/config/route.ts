import { NextResponse } from "next/server";
import { loadBusinessContext, saveBusinessContext, isConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: await isConfigured(), context: await loadBusinessContext() });
}

export async function POST(req: Request) {
  try {
    const ctx = await req.json();
    await saveBusinessContext(ctx);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
}
