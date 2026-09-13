import { NextResponse } from "next/server";
import { setDecision, markPosted, getCandidate } from "@/lib/store";
import { logActivity } from "@/lib/sheets";

export const dynamic = "force-dynamic";

/**
 * Approve, skip, or confirm posting for a candidate comment. There is no
 * automated poster: approving opens the real post in a new tab and copies
 * the comment for the human to paste themselves, then "posted" is the human
 * confirming they actually did it.
 * Body: { id: number, decision: "approved" | "skipped" | "posted", comment?: string }
 */
export async function POST(req: Request) {
  const { id, decision, comment } = await req.json();
  if (typeof id !== "number" || !["approved", "skipped", "posted"].includes(decision)) {
    return NextResponse.json({ error: "invalid id or decision" }, { status: 400 });
  }
  const existing = getCandidate(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (decision === "posted" && existing.status !== "approved") {
    return NextResponse.json({ error: "only an approved candidate can be marked posted" }, { status: 400 });
  }

  if (decision === "posted") {
    markPosted(id);
  } else {
    setDecision(id, decision, typeof comment === "string" ? comment : undefined);
  }
  const updated = getCandidate(id);
  if (updated) await logActivity(updated, decision);
  return NextResponse.json({ ok: true, candidate: updated });
}
