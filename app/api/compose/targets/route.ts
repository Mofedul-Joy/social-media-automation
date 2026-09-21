/**
 * PATCH /api/compose/targets — tick or untick one target.
 *
 * This records a HUMAN'S claim that he pasted and submitted the draft there.
 * It does not check, and must never check, whether the post is actually live:
 * that would need read access to the platform, which this app does not have
 * and is not permitted to acquire. One row update, nothing else.
 */

import { NextResponse } from "next/server";
import { setTargetDone } from "@/lib/composeStore";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function PATCH(req: Request) {
  let payload: { id?: unknown; done?: unknown };
  try {
    payload = await req.json();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const id = typeof payload.id === "number" ? payload.id : NaN;
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id must be a number" }, { status: 400 });
  if (typeof payload.done !== "boolean") {
    return NextResponse.json({ error: "done must be a boolean" }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, target: await setTargetDone(id, payload.done) });
  } catch (err) {
    console.error(`PATCH /api/compose/targets: ${(err as Error).message}`);
    return NextResponse.json(
      { error: "Could not save that tick — the store is not responding. Try again in a minute." },
      { status: 503 },
    );
  }
}
