/**
 * Session auth for the dashboard gate (replaces HTTP Basic Auth — see
 * middleware.ts for why this gate exists at all).
 *
 * The session cookie is a signed, expiring token, not a bare flag, so a
 * copied or tampered cookie value can't grant access. It's signed with
 * DASHBOARD_PASSWORD itself via HMAC-SHA256 through Web Crypto's
 * SubtleCrypto, which is available both in Next's Edge middleware and in
 * Node route handlers — Node's `crypto` module is NOT reliably available in
 * Edge middleware, so this file only ever touches `crypto.subtle`. Reusing
 * the password as the signing key means rotating the password invalidates
 * every outstanding session for free, with no extra secret to provision.
 */

export const SESSION_COOKIE = "hon_dash_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const encoder = new TextEncoder();

/** Length-aware constant-time-ish comparison to avoid trivial timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const pad = (4 - (str.length % 4)) % 4;
  const normal = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  const binary = atob(normal);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** DASHBOARD_USER/DASHBOARD_PASSWORD as configured; null if the console has no password set. */
export function dashboardCredentials(): { user: string; pass: string } | null {
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!pass) return null;
  return { user: process.env.DASHBOARD_USER || "admin", pass };
}

/** True only if both the console is configured AND the given credentials match it. */
export function verifyCredentials(user: string, pass: string): boolean {
  const configured = dashboardCredentials();
  if (!configured) return false;
  return safeEqual(user, configured.user) && safeEqual(pass, configured.pass);
}

/** Sign a fresh session token good for SESSION_TTL_MS, keyed on the current password. Null if unconfigured. */
export async function createSessionToken(): Promise<string | null> {
  const configured = dashboardCredentials();
  if (!configured) return null;
  const exp = String(Date.now() + SESSION_TTL_MS);
  const key = await getKey(configured.pass);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(exp));
  return `${exp}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/**
 * Verify a session token against the current password. False on missing,
 * malformed, expired, or forged tokens — never throws.
 */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const configured = dashboardCredentials();
  if (!configured) return false;
  const idx = token.lastIndexOf(".");
  if (idx === -1) return false;
  const exp = token.slice(0, idx);
  const sigPart = token.slice(idx + 1);
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(sigPart);
  } catch {
    return false;
  }
  try {
    const key = await getKey(configured.pass);
    return await crypto.subtle.verify("HMAC", key, sigBytes as BufferSource, encoder.encode(exp));
  } catch {
    return false;
  }
}
