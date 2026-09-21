/**
 * POST /api/compose — save the draft and the targets it is going to.
 *
 * The ONLY thing this writes to is this app's own Supabase tables. It does not
 * publish, submit, schedule or send the draft anywhere. Hon opens each target
 * himself and pastes it.
 */

import { NextResponse } from "next/server";
import { saveDraft, type TargetInput } from "@/lib/composeStore";
import { formatForPlatform } from "@/lib/compose";
import type { Platform } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PLATFORMS: Platform[] = ["reddit", "facebook", "instagram", "threads", "hackernews", "stackexchange"];

export async function POST(req: Request) {
  let payload: { postId?: number | null; body?: string; targets?: unknown };
  try {
    payload = await req.json();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const body = typeof payload.body === "string" ? payload.body : "";
  const postId = typeof payload.postId === "number" ? payload.postId : null;
  if (!Array.isArray(payload.targets)) {
    return NextResponse.json({ error: "targets must be an array" }, { status: 400 });
  }

  // Re-format server-side from the raw body rather than trusting whatever the
  // client sent as formatted_body: the stored text must be the text the rules
  // produce, or the record of what was drafted stops being trustworthy.
  const targets: TargetInput[] = [];
  for (const raw of payload.targets as Array<Record<string, unknown>>) {
    const platform = raw?.platform as Platform;
    const target = typeof raw?.target === "string" ? raw.target.trim() : "";
    if (!PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: `unknown platform: ${String(raw?.platform)}` }, { status: 400 });
    }
    if (!target) return NextResponse.json({ error: "each target needs a name" }, { status: 400 });
    targets.push({
      platform,
      target,
      target_url: typeof raw?.target_url === "string" ? raw.target_url : "",
      formatted_body: formatForPlatform(body, platform).text,
    });
  }

  try {
    return NextResponse.json({ ok: true, ...(await saveDraft(postId, body, targets)) });
  } catch (err) {
    console.error(`POST /api/compose: ${(err as Error).message}`);
    // Raw driver errors go to the log; the caller gets something actionable.
    return NextResponse.json(
      {
        error:
          "Could not save the draft — the store is not responding. Your text is still on screen, so try again in a minute.",
      },
      { status: 503 },
    );
  }
}
