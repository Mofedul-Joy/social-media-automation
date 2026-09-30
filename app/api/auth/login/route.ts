import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionToken,
  dashboardCredentials,
  verifyCredentials,
} from "@/lib/auth";

// Edge, same as middleware.ts — keeps the signing/verification path on one
// runtime (Web Crypto only) instead of assuming Node's `crypto` is present.
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Fail closed: an unconfigured console must not be usable, not even to log in.
  if (!dashboardCredentials()) {
    return NextResponse.json(
      { ok: false, error: "Dashboard auth is not configured. Set DASHBOARD_PASSWORD in the environment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string" || !verifyCredentials(username, password)) {
    return NextResponse.json({ ok: false, error: "Incorrect username or password." }, { status: 401 });
  }

  const token = await createSessionToken();
  if (!token) {
    // Can only happen if the password was unset between the check above and here.
    return NextResponse.json({ ok: false, error: "Dashboard auth is not configured." }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure requires HTTPS; the local dev server is plain HTTP, so this is
    // relaxed only outside production (Vercel always serves HTTPS).
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
