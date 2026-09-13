import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AiAnalysis, BusinessContext, ScrapedPost } from "./types";

const execFileAsync = promisify(execFile);

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
// Classification runs headless through the local `claude` CLI, authenticated by
// CLAUDE_CODE_OAUTH_TOKEN in the environment (inherited by the child process),
// so calls bill against the client's own Claude subscription, not an API key.
const CLI_TIMEOUT_MS = 120_000;

function systemPrompt(ctx: BusinessContext): string {
  return [
    `You are the engagement analyst and comment writer for ${ctx.business_name}.`,
    ``,
    `BUSINESS: ${ctx.description}`,
    `TARGET AUDIENCE TO ENGAGE: ${ctx.target_audience}`,
    `TOPICS/KEYWORDS: ${ctx.keywords.join(", ")}`,
    `COMMENT TONE: ${ctx.comment_tone}`,
    `THINGS TO AVOID: ${ctx.avoid.join("; ")}`,
    ``,
    `Your job: given one social-media post, decide whether it is worth engaging with`,
    `on behalf of this business, and if so, draft a comment.`,
    ``,
    `Score TWO INDEPENDENT axes. Do not collapse them.`,
    ``,
    `RELEVANCE (0.0-1.0) is topical fit only: is this post about our subject.`,
    `- 1.0: squarely our subject.`,
    `- 0.5: adjacent.`,
    `- 0.0: unrelated, spam, or hostile.`,
    ``,
    `INTENT (0.0-1.0) is whether the AUTHOR wants what we provide, right now.`,
    `This is the axis that matters and it is NOT implied by relevance. Businesses`,
    `posting about our subject score high relevance and near-zero intent, because`,
    `they are selling, not buying. A post can be perfectly on topic and worthless.`,
    `- 0.9-1.0: explicitly asking for a recommendation, help, a provider, or what to buy.`,
    `- 0.6-0.8: describing a problem we solve, or comparing options, without asking outright.`,
    `- 0.3-0.5: curious or discussing the space with no personal need expressed.`,
    `- 0.0-0.2: promoting, selling, announcing, reposting news, or an ad.`,
    ``,
    `ACTOR: "buyer" (wants it), "seller" (offers it), "peer" (in the field, not a`,
    `customer), "unclear". Anyone marketing a product or service is "seller" even`,
    `when the post is phrased as a question.`,
    ``,
    `Comment rules: sound like a helpful peer in the community, not a brand. Match the tone.`,
    `Never pitch the product or drop links. Add real value or a genuine perspective. Keep it`,
    `natural length for the platform. Low-scoring posts are discarded before a human`,
    `ever sees them, so keep the comment brief when intent is low.`,
    ``,
    `Respond ONLY with a JSON object, no prose, no markdown fences:`,
    `{"relevant": bool, "relevance": number, "intent": number, "actor": string, "category": string, "summary": string, "comment": string}`,
    `category is one of: "new buyer", "question", "complaint", "discussion", "recommendation request", "other".`,
    `summary is one sentence describing the post.`,
  ].join("\n");
}

function clamp01(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

function parseJson(text: string): AiAnalysis {
  let t = text.trim();
  // tolerate accidental code fences
  if (t.startsWith("```")) t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const obj = JSON.parse(t);
  return {
    relevant: !!obj.relevant,
    relevance: clamp01(obj.relevance),
    intent: clamp01(obj.intent),
    actor: ["buyer", "seller", "peer", "unclear"].includes(obj.actor) ? obj.actor : "unclear",
    category: String(obj.category ?? "other"),
    summary: String(obj.summary ?? ""),
    comment: String(obj.comment ?? ""),
  };
}

/** Analyze a single post: relevance score, category, summary, and draft comment. */
export async function analyzePost(ctx: BusinessContext, post: ScrapedPost): Promise<AiAnalysis> {
  const userContent = [
    `PLATFORM: ${post.platform}`,
    post.title ? `TITLE: ${post.title}` : "",
    post.author ? `AUTHOR: ${post.author}` : "",
    `URL: ${post.url}`,
    ``,
    `POST BODY:`,
    post.body.slice(0, 6000),
  ]
    .filter(Boolean)
    .join("\n");

  // userContent carries UNTRUSTED scraped text. Every value below is a separate
  // argv element handed to execFile, which spawns the binary directly — no shell,
  // no string concatenation, so there is nothing to inject into.
  const args = [
    "-p",
    userContent,
    "--system-prompt",
    systemPrompt(ctx),
    "--model",
    MODEL,
    "--output-format",
    "json",
    "--tools",
    "",
    "--no-session-persistence",
    "--permission-prompts",
    "none",
  ];

  const run = execFileAsync("claude", args, {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  });
  // execFile always pipes stdin and the CLI waits ~3s on an open one. Close it.
  run.child.stdin?.end();

  let stdout: string;
  try {
    stdout = (await run).stdout;
  } catch (err) {
    const e = err as Error & { killed?: boolean; code?: number | string; stderr?: string };
    if (e.killed) throw new Error(`claude CLI timed out after ${CLI_TIMEOUT_MS}ms`);
    throw new Error(`claude CLI failed (exit ${e.code ?? "?"}): ${(e.stderr || e.message).trim()}`);
  }

  let payload: { is_error?: boolean; result?: unknown };
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI did not return JSON: ${stdout.slice(0, 500)}`);
  }
  if (payload.is_error || typeof payload.result !== "string") {
    throw new Error(`claude CLI returned an error: ${stdout.slice(0, 500)}`);
  }

  return parseJson(payload.result);
}
