Type: task
Status: resolved
Blocked by: (none)

## Question

Replace the browser's native HTTP Basic Auth popup (`middleware.ts`) with a real styled login page, same single admin credential (`DASHBOARD_USER`/`DASHBOARD_PASSWORD`), no multi-user (matches the existing single-login decision, out of scope in map.md).

## Answer

Built 2026-09-30. Basic Auth replaced with a signed session-cookie gate.

**What was built**

- `lib/auth.ts` — new. Session token = `${expiryMs}.${base64url(HMAC-SHA256(key=DASHBOARD_PASSWORD, msg=expiryMs))}`, signed/verified with Web Crypto `crypto.subtle` (works in both Edge middleware and Node route handlers; Node's `crypto` module isn't reliably available in Edge). Reusing `DASHBOARD_PASSWORD` as the HMAC key means rotating the password invalidates every outstanding session for free — no second secret to provision. Also holds `dashboardCredentials()` / `verifyCredentials()` (same `safeEqual` timing-safe compare as the old Basic Auth code).
- `app/api/auth/login/route.ts` (edge runtime) — POST `{username, password}`, checks against env, sets `hon_dash_session`: HttpOnly, `SameSite=Lax`, `Secure` in production only (dev server is plain HTTP), 7-day expiry. 401 on bad creds, 503 if `DASHBOARD_PASSWORD` unset (fail closed, same as before).
- `app/api/auth/logout/route.ts` (edge runtime) — POST, clears the cookie.
- `app/login/page.tsx` — styled dark-theme login form (`impeccable` skill), username + password, inline error on rejection, redirects to the original `?from=` path (or `/`) on success.
- `middleware.ts` — rewritten to check the session cookie instead of the `Authorization: Basic` header. Still fails closed 503 (everywhere, including `/login`) if `DASHBOARD_PASSWORD` is unset. `/login` and `/api/auth/*` are the only bypassed paths; everything else redirects (307) to `/login?from=<path>` when the cookie is missing/invalid, instead of a raw 401. Matcher unchanged.
- `app/page.tsx` — added a "Log out" icon button in the header (POSTs to `/api/auth/logout`, then hard-redirects to `/login`).

**Verification**

- `npx tsc --noEmit` and `npm run build` both clean.
- Local dev server (`npm run dev`) + curl cookie jar: wrong password → 401, no cookie set; right password → 200 + `Set-Cookie` on `hon_dash_session`; protected route with the cookie → 200; without cookie → 307 to `/login?from=%2F`; tampered cookie (flipped char) → 307; cookie with an expired-looking `exp` → 307; logout → clears cookie, subsequent request → 307 again. Fail-closed re-verified by temporarily blanking `DASHBOARD_PASSWORD` in `.env`: `/` and `/login` both return 503, then restored the original value and diffed `.env` against a backup to confirm nothing was left changed.
- `chrome-devtools` MCP against the live dev server, isolated browser context (clean cookie jar): fresh visit to `/` redirects to `/login?from=%2F`; wrong password shows the inline "Incorrect username or password." error; right password lands back on `/` (protected dashboard) with the search UI visible; "Log out" button is present in the header, clicking it returns to `/login` and a subsequent visit to `/` redirects again (session actually cleared, not just UI state).

**Adversarial review** (`adversarial-reviewer` subagent, Sonnet 5) found one real, justified issue:

- **Medium — open redirect via the `from` query param.** The original redirect logic (`from && from.startsWith("/") ? from : "/"`) accepted protocol-relative values like `from=//evil.com`, which `startsWith("/")` lets through but which Next's router (and browsers) treat as an external origin. A crafted link to the real login page could, after a genuine successful login, silently bounce the admin to an attacker's domain. **Fixed**: replaced with `safeRedirectPath()`, which only accepts a same-document path (`/^\/(?!\/|\\)/`, rejecting a second leading `/` or `\`). Re-verified live via chrome-devtools: `from=//evil.com` now lands on `/`, not `evil.com`.
- Everything else the reviewer checked (path-bypass smuggling through the matcher/prefix bypass, signature/expiry handling in `verifySessionToken`, the `secure` flag's correctness on Vercel, CSRF exposure on login/logout, secret leakage into the client bundle, reusing the password as the HMAC key, Edge-runtime gotchas) was checked against the actual code and ruled out as not a real issue for this single-operator internal tool. One low-severity note left as-is per the reviewer's own call: `POST /api/auth/logout` doesn't require an existing valid session before clearing the cookie, so a cross-site `no-cors` POST could force a logout — a nuisance, not a boundary breach, not fixed.

**Committed, not pushed** — local commit on `main` in `workspaces/client-delivery/hon/code/Hon-SMA`. Per repo convention, agents don't push here.
