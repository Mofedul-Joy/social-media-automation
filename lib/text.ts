/**
 * The Hacker News Firebase API returns post and comment text HTML-escaped, so
 * a real result reaches the page reading `legacy&#x2F;vibe-coded` instead of
 * `legacy/vibe-coded`. Confirmed on live results, 2026-09-21.
 *
 * This decodes at the point of display and of export, which is everything the
 * results view owns. It is NOT the whole fix: `/api/analyze-post` is handed
 * the same escaped body, so the AI reads the entities too. That belongs in
 * `lib/sources/hackernews.ts`, which normalizes source text — see the parked
 * item in this slice's report.
 *
 * Deliberately not `DOMParser` or a `<textarea>`: this runs on the server
 * during the initial render as well as in the browser, and a named-entity
 * table is not worth carrying for the handful of entities an API ever emits.
 */
const NAMED: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  if (!s || !s.includes("&")) return s;
  return (
    s
      .replace(/&(?:lt|gt|quot|apos|nbsp);/g, (m) => NAMED[m])
      .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeChar(m, parseInt(h, 16)))
      .replace(/&#(\d+);/g, (m, d) => safeChar(m, parseInt(d, 10)))
      // Last, so `&amp;lt;` decodes to the literal text `&lt;` rather than to
      // `<` — otherwise this function would be a way to smuggle markup in.
      .replace(/&amp;/g, "&")
  );
}

/** Out-of-range or control code points are left as they came rather than thrown away. */
function safeChar(raw: string, code: number): string {
  return Number.isFinite(code) && code > 31 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
}
