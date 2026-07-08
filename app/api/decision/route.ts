import { NextResponse } from "next/server";
import { setDecision, getCandidate } from "@/lib/store";
import { logActivity } from "@/lib/sheets";

export const dynamic = "force-dynamic";

/**
 * Approve or skip a candidate comment. Approving queues it for the posting
 * worker; nothing is ever posted without passing through here first.
 * Body: { id: number, decision: "approved" | "skipped", comment?: string }
 */
export async function POST(req: Request) {
  const { id, decision, comment } = await req.json();
  if (typeof id !== "number" || (decision !== "approved" && decision !== "skipped")) {
    return NextResponse.json({ error: "invalid id or decision" }, { status: 400 });
  }
  const existing = getCandidate(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  setDecision(id, decision, typeof comment === "string" ? comment : undefined);
  const updated = getCandidate(id);
  if (updated) await logActivity(updated, decision === "approved" ? "approved" : "skipped");
  return NextResponse.json({ ok: true, candidate: updated });
}
