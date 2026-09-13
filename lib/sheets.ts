import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import type { Candidate } from "./types";

/**
 * Appends activity rows to the client's Google Sheet activity log.
 * No-ops (with a console note) if Sheets isn't configured yet, so discovery and
 * posting still work before the client provides the sheet/credentials.
 */

const HEADER = [
  "Timestamp",
  "Platform",
  "Category",
  "Intent",
  "Relevance",
  "Status",
  "Post URL",
  "AI Summary",
  "Comment",
  "Found by query",
  "Error",
];

function serviceAccountPath(): string | null {
  const p = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return fs.existsSync(abs) ? abs : null;
}

function isConfigured(): boolean {
  return !!process.env.ACTIVITY_LOG_SHEET_ID && !!serviceAccountPath();
}

async function getSheets() {
  const keyFile = serviceAccountPath()!;
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth: await auth.getClient() as any });
}

function rowFor(c: Candidate, event: string): (string | number)[] {
  return [
    new Date().toISOString(),
    c.platform,
    c.category,
    c.intent_score,
    c.relevance,
    event,
    c.url,
    c.ai_summary,
    c.draft_comment,
    c.source_query ?? "",
    c.error ?? "",
  ];
}

/** Ensure the header row exists (best-effort). */
export async function ensureHeader(): Promise<void> {
  if (!isConfigured()) return;
  try {
    const sheets = await getSheets();
    const id = process.env.ACTIVITY_LOG_SHEET_ID!;
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: "A1:K1" });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: "A1",
        valueInputOption: "RAW",
        requestBody: { values: [HEADER] },
      });
    }
  } catch (err) {
    console.warn(`[sheets] header check skipped: ${(err as Error).message}`);
  }
}

/** Log one activity event for a candidate. */
export async function logActivity(c: Candidate, event: string): Promise<void> {
  if (!isConfigured()) {
    console.log(`[sheets] (not configured) ${event}: ${c.platform} ${c.url}`);
    return;
  }
  try {
    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.ACTIVITY_LOG_SHEET_ID!,
      range: "A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowFor(c, event)] },
    });
  } catch (err) {
    console.warn(`[sheets] append failed: ${(err as Error).message}`);
  }
}
