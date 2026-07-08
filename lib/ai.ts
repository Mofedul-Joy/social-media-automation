import Anthropic from "@anthropic-ai/sdk";
import type { AiAnalysis, BusinessContext, ScrapedPost } from "./types";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

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
    `Relevance rubric (score 0.0-1.0):`,
    `- 1.0: exactly the audience, actively looking for help/opinions we can add value to.`,
    `- 0.6-0.9: on-topic, a genuine person we could helpfully reply to.`,
    `- 0.3-0.5: loosely related, low value to engage.`,
    `- 0.0-0.2: off-topic, spam, hostile, or a brand/ad.`,
    ``,
    `Comment rules: sound like a helpful peer in the community, not a brand. Match the tone.`,
    `Never pitch the product or drop links. Add real value or a genuine perspective. Keep it`,
    `natural length for the platform. If relevance is below ${ctx.relevance_threshold}, still`,
    `return a short comment but it will be discarded.`,
    ``,
    `Respond ONLY with a JSON object, no prose, no markdown fences:`,
    `{"relevant": bool, "relevance": number, "category": string, "summary": string, "comment": string}`,
    `category is one of: "new buyer", "question", "complaint", "discussion", "recommendation request", "other".`,
    `summary is one sentence describing the post.`,
  ].join("\n");
}

function parseJson(text: string): AiAnalysis {
  let t = text.trim();
  // tolerate accidental code fences
  if (t.startsWith("```")) t = t.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const obj = JSON.parse(t);
  return {
    relevant: !!obj.relevant,
    relevance: typeof obj.relevance === "number" ? Math.max(0, Math.min(1, obj.relevance)) : 0,
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

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 700,
    system: systemPrompt(ctx),
    messages: [{ role: "user", content: userContent }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseJson(text);
}
