import { NextResponse } from "next/server";
import { listCandidates, stats } from "@/lib/store";
import type { PostStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") as PostStatus | null) ?? "pending";
  const candidates = listCandidates(status);
  return NextResponse.json({ candidates, stats: stats() });
}
