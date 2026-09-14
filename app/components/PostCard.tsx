"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2, Copy, Check, Pencil, ExternalLink } from "lucide-react";
import type { AiAnalysis, ScrapedPost } from "@/lib/types";
import { PlatformIcon, PLATFORM_COLOR, PLATFORM_LABEL } from "./PlatformIcon";

/** Compact relative age, so a card shows freshness without a full timestamp. */
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

export function PostCard({
  post,
  index,
  onToast,
}: {
  post: ScrapedPost;
  index: number;
  onToast: (msg: string) => void;
}) {
  const color = PLATFORM_COLOR[post.platform];
  const label = PLATFORM_LABEL[post.platform];
  const [gen, setGen] = useState<GenState>({ status: "idle" });
  const [comment, setComment] = useState("");
  const [copied, setCopied] = useState(false);

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

  const posted = age(post.posted_at);
  const done = gen.status === "done" ? gen.analysis : null;
  const draft = done?.comment.trim() ?? "";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.4), ease: [0.2, 0.7, 0.2, 1] }}
      className="glass card-hover rounded-2xl p-5 flex flex-col relative overflow-hidden"
    >
      <div className="absolute top-0 left-0 h-[3px] w-full" style={{ background: color, opacity: 0.9 }} />

      {/* header */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: `${color}1f`, color }}>
          <PlatformIcon platform={post.platform} className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">{post.author ?? label}</span>
          </div>
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

      {/* body */}
      <div className="flex-1">
        {post.title && (
          <h3 className="text-[15px] font-semibold leading-snug mb-1.5 text-[color:var(--text)]">{post.title}</h3>
        )}
        <p className="text-sm text-[color:var(--muted)] leading-relaxed line-clamp-4">
          {done ? done.summary : post.body}
        </p>
      </div>

      {/* scores + open link */}
      <div className="flex items-center gap-4 mt-3 text-xs text-[color:var(--faint)] tabular-nums">
        {done && (
          <>
            <span>intent {(done.intent * 100).toFixed(0)}%</span>
            <span>relevance {(done.relevance * 100).toFixed(0)}%</span>
          </>
        )}
        <a href={post.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-[color:var(--text)] transition-colors">
          Open post <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* comment area */}
      <AnimatePresence initial={false}>
        {done ? (
          draft ? (
            <motion.div key="comment" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-4">
              <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-[color:var(--primary-2)]">
                <Sparkles className="w-3.5 h-3.5" />
                Drafted comment
                <span className="ml-auto inline-flex items-center gap-1 text-[color:var(--faint)]"><Pencil className="w-3 h-3" /> editable</span>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                className="w-full text-sm rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] focus:border-[color:var(--primary)] outline-none px-3 py-2.5 resize-none text-[color:var(--text)] leading-relaxed"
              />
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={copy}
                  className="btn text-sm font-semibold px-4 py-2.5 rounded-xl inline-flex items-center gap-2 flex-1 justify-center"
                  style={
                    copied
                      ? { background: "rgba(34,197,94,0.14)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.4)" }
                      : { background: color, color: "#fff", boxShadow: `0 8px 22px -10px ${color}` }
                  }
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied" : "Copy comment"}
                </button>
              </div>
              <p className="text-[11px] text-[color:var(--faint)] mt-2">
                Paste it yourself on {label} — nothing here posts automatically.
              </p>
            </motion.div>
          ) : (
            <p className="text-sm text-[color:var(--muted)] mt-4">
              No comment drafted. The AI read the author as a {done.actor} here, so there is nothing useful to reply with.
            </p>
          )
        ) : gen.status === "error" ? (
          <div className="mt-4">
            <p className="text-sm text-[color:var(--red)] mb-2">{gen.message}</p>
            <button
              onClick={generate}
              className="btn w-full py-2.5 rounded-xl border border-[color:var(--border-strong)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-sm font-medium inline-flex items-center justify-center gap-2"
            >
              Try again
            </button>
          </div>
        ) : (
          <motion.button
            key="gen"
            onClick={generate}
            disabled={gen.status === "loading"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="btn mt-4 w-full py-2.5 rounded-xl border border-[color:var(--border-strong)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)] text-sm font-medium inline-flex items-center justify-center gap-2"
          >
            {gen.status === "loading" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Drafting comment…</>
            ) : (
              <><Sparkles className="w-4 h-4 text-[color:var(--primary-2)]" /> Generate comment</>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
