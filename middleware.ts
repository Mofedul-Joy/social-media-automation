import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, dashboardCredentials, verifySessionToken } from "@/lib/auth";

/**
 * Gate the entire dashboard behind a signed session cookie set by /login. This
 * is the safety boundary for the approval console: without it, anyone who can
 * reach the URL could approve comments (which post to the client's real
 * social accounts) or trigger discovery (which spends API credits).
 * Credentials come from env and are never hardcoded. If no password is
 * configured we fail closed (503) rather than open — including for /login
 * itself, since there is nothing valid to log in with.
 */

const PUBLIC_PATHS = new Set(["/login"]);
const PUBLIC_PREFIXES = ["/api/auth/"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function serviceUnavailable(message: string): NextResponse {
  return new NextResponse(message, { status: 503 });
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  // Fail closed: an unconfigured console must not be usable.
  if (!dashboardCredentials()) {
    return serviceUnavailable(
      'Dashboard auth is not configured. Set DASHBOARD_PASSWORD (and optionally DASHBOARD_USER) in the environment.',
    );
  }

  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except Next internals and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
