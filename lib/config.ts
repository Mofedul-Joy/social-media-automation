import fs from "node:fs";
import path from "node:path";
import type { BusinessContext } from "./types";

const CONFIG_PATH = path.join(process.cwd(), "config", "business_context.json");

/**
 * Loads the client's business context. This is the AI's core instruction set:
 * what the business is, who to engage, and how comments should sound.
 * Falls back to the example file so the app runs before the client brief lands.
 */
export function loadBusinessContext(): BusinessContext {
  const p = fs.existsSync(CONFIG_PATH)
    ? CONFIG_PATH
    : path.join(process.cwd(), "config", "business_context.example.json");
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw) as BusinessContext;
}

export function saveBusinessContext(ctx: BusinessContext): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(ctx, null, 2), "utf-8");
}

export function isConfigured(): boolean {
  return fs.existsSync(CONFIG_PATH);
}
