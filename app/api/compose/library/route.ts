/**
 * POST / DELETE /api/compose/library — Hon's own list of places he posts.
 *
 * The list is USER-MANAGED on purpose. No group, page or community is ever
 * invented or discovered by the app: Hon pastes in the URL of a place he is
 * already a member of. Adding one here is a database row and nothing more — it
 * grants this app no access to that place and triggers no request to it.
 */

import { NextResponse } from "next/server";
import { addSavedTarget, deleteSavedTarget, savedNameTaken } from "@/lib/composeStore";
import type { Platform } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PLATFORMS: Platform[] = ["reddit", "facebook", "instagram", "threads", "hackernews", "stackexchange"];

export async function POST(req: Request) {
  let payload: { platform?: unknown; name?: unknown; url?: unknown };
  try {
    payload = await req.json();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const platform = payload.platform as Platform;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const url = typeof payload.url === "string" ? payload.url.trim() : "";

  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "Pick which platform this place is on." }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "Give it a name you will recognise in the list." }, { status: 400 });

  // Validated, never fetched. The app must not visit the URL: a request from
  // this server to a logged-out platform proves nothing and is not needed.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "That does not look like a link. Paste the full address, starting with https://" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "The link must start with http:// or https://" }, { status: 400 });
  }

  try {
    if (await savedNameTaken(platform, name, parsed.toString())) {
      return NextResponse.json(
        { error: `You already have a different ${platform} place called “${name}”. Give this one another name.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, target: await addSavedTarget(platform, name, parsed.toString()) });
  } catch (err) {
    console.error(`POST /api/compose/library: ${(err as Error).message}`);
    return NextResponse.json(
      { error: "Could not save that place — the store is not responding. Try again in a minute." },
      { status: 503 },
    );
  }
}

export async function DELETE(req: Request) {
  // Number(null) is 0, which is finite — so a missing id would otherwise pass
  // validation and "succeed" as a no-op delete of a row that cannot exist.
  const raw = new URL(req.url).searchParams.get("id");
  const id = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "id must be a positive whole number" }, { status: 400 });
  }
  try {
    await deleteSavedTarget(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/compose/library: ${(err as Error).message}`);
    return NextResponse.json(
      { error: "Could not remove that place — the store is not responding. Try again in a minute." },
      { status: 503 },
    );
  }
}
