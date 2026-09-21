"use client";

/**
 * PROTOTYPE — ticket 05 (.scratch/hon-sma-v2/issues/05-row-layout-control-center.md).
 * Rough, reactable shape only. Not wired into the live app/page.tsx.
 *
 * Row layout: left = scrollable post info, right = "Control Center" with
 * per-post actions (Generate comment — same /api/analyze-post flow as the
 * existing PostCard — and Save/memorize as a link, stubbed with local state).
 */

import { useState } from "react";
import { Sparkles, Loader2, Copy, Check, ExternalLink, Bookmark, BookmarkCheck } from "lucide-react";
import type { AiAnalysis, ScrapedPost } from "@/lib/types";
import { PlatformIcon, PLATFORM_COLOR, PLATFORM_LABEL } from "./PlatformIcon";

function age(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type GenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; analysis: AiAnalysis }
  | { status: "error"; message: string };

export function PostRow({
  post,
  onToast,
}: {
  post: ScrapedPost;
  onToast: (msg: string) => void;
}) {
  const color = PLATFORM_COLOR[post.platform];
  const label = PLATFORM_LABEL[post.platform];
  const [gen, setGen] = useState<GenState>({ status: "idle" });
  const [comment, setComment] = useState("");
  const [copied, setCopied] = useState(false);

  // Save/memorize stub — local state only. Real version: POST to
  // /api/saved-posts, persisted in a `saved_posts` Supabase table
  // (see proposed schema in the ticket's Prototype section).
  const [saved, setSaved] = useState(false);

  async function generate() {
    setGen({ status: "loading" });
    try {
      const res = await fetch("/api/analyze-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "could not draft a comment");
      setGen({ status: "done", analysis: data.analysis });
      setComment(data.analysis.comment ?? "");
    } catch (err) {
      setGen({ status: "error", message: (err as Error).message });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(comment);
      setCopied(true);
      onToast("Comment copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast("Could not copy — select the comment and copy manually");
    }
  }

  function toggleSave() {
    setSaved((s) => !s);
    onToast(saved ? "Removed from saved" : "Saved — url/platform/title only, not the full post");
  }

  const posted = age(post.posted_at);
  const done = gen.status === "done" ? gen.analysis : null;
  const draft = done?.comment.trim() ?? "";

  return (
    <div className="glass rounded-2xl relative overflow-hidden flex flex-col sm:flex-row">
      <div className="absolute top-0 left-0 h-full w-[3px]" style={{ background: color, opacity: 0.9 }} />

      {/* LEFT: post info, scrollable to read full detail */}
      <div className="flex-1 min-w-0 p-5 sm:pr-4 sm:border-r border-[color:var(--border)]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${color}1f`, color }}>
            <PlatformIcon platform={post.platform} className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-sm font-semibold truncate block">{post.author ?? label}</span>
            <div className="text-xs text-[color:var(--muted)] truncate">
              {label}
              {posted ? ` · ${posted}` : ""}
            </div>
          </div>
          {done && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0"
              style={{ background: "rgba(255,255,255,0.07)", color: "var(--faint)" }}
            >
              {done.category}
            </span>
          )}
        </div>

        {post.title && (
          <h3 className="text-[15px] font-semibold leading-snug mb-1.5 text-[color:var(--text)]">{post.title}</h3>
        )}

        {/* scrollable full body, rather than the card's line-clamp-4 */}
        <div className="max-h-40 overflow-y-auto pr-2 text-sm text-[color:var(--muted)] leading-relaxed whitespace-pre-wrap">
          {done ? done.summary : post.body}
        </div>

        {done && (
          <div className="flex items-center gap-4 mt-3 text-xs text-[color:var(--faint)] tabular-nums">
            <span>intent {(done.intent * 100).toFixed(0)}%</span>
            <span>relevance {(done.relevance * 100).toFixed(0)}%</span>
          </div>
        )}
      </div>

      {/* RIGHT: Control Center — per-post actions */}
      <div className="w-full sm:w-72 shrink-0 p-5 flex flex-col gap-2.5 bg-[rgba(255,255,255,0.02)]">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--faint)] mb-0.5">
          Control Center
        </div>

        <a
          href={post.url}
          target="_blank"
          rel="noreferrer"
          className="btn text-sm rounded-xl px-3 py-2.5 border border-[color:var(--border)] hover:border-[color:var(--border-strong)] inline-flex items-center gap-2"
        >
          <ExternalLink className="w-4 h-4" /> Open original
        </a>

        <button
          onClick={toggleSave}
          className="btn text-sm rounded-xl px-3 py-2.5 border inline-flex items-center gap-2"
          style={
            saved
              ? { background: "rgba(96,165,250,0.14)", color: "#60a5fa", borderColor: "rgba(96,165,250,0.4)" }
              : { borderColor: "var(--border)" }
          }
        >
          {saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          {saved ? "Saved" : "Save as link"}
        </button>

        {!done && gen.status !== "error" && (
          <button
            onClick={generate}
            disabled={gen.status === "loading"}
            className="btn text-sm rounded-xl px-3 py-2.5 border border-[color:var(--border-strong)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] inline-flex items-center gap-2"
          >
            {gen.status === "loading" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Drafting…</>
            ) : (
              <><Sparkles className="w-4 h-4 text-[color:var(--primary-2)]" /> Generate comment</>
            )}
          </button>
        )}

        {gen.status === "error" && (
          <div>
            <p className="text-xs text-[color:var(--red)] mb-2">{gen.message}</p>
            <button
              onClick={generate}
              className="btn w-full text-sm rounded-xl px-3 py-2.5 border border-[color:var(--border-strong)]"
            >
              Try again
            </button>
          </div>
        )}

        {done && (
          draft ? (
            <div className="mt-1">
              <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-[color:var(--primary-2)]">
                <Sparkles className="w-3.5 h-3.5" /> Drafted comment
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="w-full text-sm rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] focus:border-[color:var(--primary)] outline-none px-3 py-2.5 resize-none text-[color:var(--text)] leading-relaxed"
              />
              <button
                onClick={copy}
                className="btn text-sm font-semibold px-3 py-2.5 rounded-xl inline-flex items-center gap-2 justify-center w-full mt-2"
                style={
                  copied
                    ? { background: "rgba(34,197,94,0.14)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.4)" }
                    : { background: color, color: "#fff" }
                }
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? "Copied" : "Copy comment"}
              </button>
              <p className="text-[11px] text-[color:var(--faint)] mt-2">
                Paste it yourself on {label} — nothing here posts automatically.
              </p>
            </div>
          ) : (
            <p className="text-xs text-[color:var(--muted)]">
              No comment drafted — read as a {done.actor}.
            </p>
          )
        )}
      </div>
    </div>
  );
}
