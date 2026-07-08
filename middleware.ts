import { NextResponse, type NextRequest } from "next/server";

/**
 * Gate the entire dashboard behind HTTP Basic Auth. This is the safety boundary
 * for the approval console: without it, anyone who can reach the URL could
 * approve comments (which post to the client's real social accounts) or trigger
 * discovery (which spends API credits). Credentials come from env and are never
 * hardcoded. If no password is configured we fail closed (503) rather than open.
 */

const REALM = 'Engagement Console';

function unauthorized(message: string, status = 401): NextResponse {
  const res = new NextResponse(message, { status });
  if (status === 401) res.headers.set('WWW-Authenticate', `Basic realm="${REALM}"`);
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const user = process.env.DASHBOARD_USER || 'admin';
  const pass = process.env.DASHBOARD_PASSWORD;

  // Fail closed: an unconfigured console must not be usable.
  if (!pass) {
    return unauthorized(
      'Dashboard auth is not configured. Set DASHBOARD_PASSWORD (and optionally DASHBOARD_USER) in the environment.',
      503,
    );
  }

  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const idx = decoded.indexOf(':');
      const givenUser = decoded.slice(0, idx);
      const givenPass = decoded.slice(idx + 1);
      if (safeEqual(givenUser, user) && safeEqual(givenPass, pass)) {
        return NextResponse.next();
      }
    } catch {
      // fall through to 401
    }
  }
  return unauthorized('Authentication required.');
}

/** Length-aware constant-time-ish comparison to avoid trivial timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  // Protect everything except Next internals and the favicon.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
