/**
 * CSV for the Export button (issue 09). Runs in the browser, off rows that are
 * already on the page — there is no export endpoint and no second fetch, so
 * what downloads is exactly what was on screen.
 *
 * No dependency: RFC 4180 quoting is four lines, and a library for it would be
 * the only thing in this app's bundle that exists to avoid writing them.
 */

/** RFC 4180: double every quote, and quote any cell that could break a row. */
function cell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // A leading =, +, - or @ is executed as a formula by Excel and Sheets, so a
  // post body starting with one is prefixed with a tab. The cell still reads
  // as text; it just stops a scraped post being able to run anything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `\t${s}` : s;
  return /["\n\r,]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // CRLF line endings and a UTF-8 BOM, because Excel on Windows reads a
  // BOM-less UTF-8 file as Latin-1 and turns every non-ASCII character in a
  // scraped post into mojibake.
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

/** Hands the file to the browser's own download, no server round trip. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on the next tick rather than immediately: Safari reads the blob
  // after the click handler returns, and revoking synchronously gives it an
  // empty file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `pulse-home gym/setup.csv` is not a filename. */
export function csvFilename(label: string): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "results";
  return `pulse-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
}
