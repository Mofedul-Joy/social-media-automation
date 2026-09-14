import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, ".env") });
import http from "node:http";
import { analyzePost } from "../lib/ai";
import type { BusinessContext, ScrapedPost } from "../lib/types";

/**
 * The only thing left on the VPS: analyzePost() behind one authenticated HTTP
 * endpoint. lib/ai.ts shells out to the local `claude` CLI, which serverless
 * cannot run — everything else moved to Vercel.
 */
const PORT = Number(process.env.WORKER_PORT ?? 8787);
const SECRET = process.env.WORKER_SHARED_SECRET;
const MAX_BODY_BYTES = 512 * 1024;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      body += c;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method !== "POST" || req.url !== "/analyze") {
    res.writeHead(404);
    return res.end();
  }
  if (!SECRET) {
    res.writeHead(500, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "WORKER_SHARED_SECRET not configured" }));
  }
  if (!safeEqual(req.headers.authorization ?? "", `Bearer ${SECRET}`)) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  let raw: string;
  try {
    raw = await readBody(req);
  } catch (err) {
    res.writeHead((err as Error).message === "payload too large" ? 413 : 400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: (err as Error).message }));
  }
  let body: { post: ScrapedPost; businessContext: BusinessContext };
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "invalid JSON body" }));
  }
  if (!body?.post || !body?.businessContext) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "post and businessContext required" }));
  }
  try {
    const result = await analyzePost(body.businessContext, body.post);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
});

server.listen(PORT, () => console.log(`[worker] listening on :${PORT}`));
