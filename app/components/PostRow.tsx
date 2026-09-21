"use client";

/**
 * One search result, as a full-width row (issue 05).
 *
 *   LEFT   everything about the post, body scrollable in place so a long post
 *          can be read without the row growing taller than its neighbours.
 *   RIGHT  the Control Center: exactly three actions, fixed width so the
 *          buttons line up down the whole stack and can be hit without aiming.
 *
 * The three actions are Open original, Save as link and Generate comment, and
 * that list is closed (issue 05). There is deliberately no Dismiss, and saving
 * reports itself with the bookmark flip alone — no toast.
 *
 * Nothing here posts anything anywhere. Generate drafts text into a box the
 * human copies and pastes themselves.
 */

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  CornerDownRight,
  Link2,
} from "lucide-react";
import type { AiAnalysis, ScrapedPost } from "@/lib/types";
import { CATEGORY_BUYER } from "@/lib/types";
import { decodeEntities } from "@/lib/text";
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

/**
 * Lead and conversation have to be told apart at a glance down a long stack,
 * so the lead reads in green and everything else stays neutral. Both are light
 * text on a dark tint — never the same hue as the text sitting on it.
 */
function CategoryChip({ category }: { category: string }) {
  const lead = category === CATEGORY_BUYER;
  return (
    <span
      className="shrink-0 text-[12px] font-semibold px-2 py-1 rounded-lg whitespace-nowrap"
      style={
        lead
          ? { background: "rgba(34,197,94,0.16)", color: "#6ee7a0", border: "1px solid rgba(34,197,94,0.34)" }
          : { background: "rgba(255,255,255,0.07)", color: "var(--muted)", border: "1px solid var(--border)" }
      }
    >
      {category}
    </span>
  );
}

type GenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; analysis: AiAnalysis }
  | { status: "error"; message: string };

export function PostRow({
  post,
  index,
  saved,
  onToggleSave,
  onAnalyzed,
  linkOnly = false,
  savedAgo,
  onToast,
}: {
  post: ScrapedPost;
  /** Position in the stack, for the entrance stagger only. */
  index: number;
  saved: boolean;
  /** Returns an error message to show in place, or null when it worked. */
  onToggleSave: (post: ScrapedPost) => Promise<string | null>;
  /**
   * Hands the AI's own category back up, so the chip here and the count in
   * the sidebar cannot end up describing this post differently.
   */
  onAnalyzed?: (url: string, category: string) => void;
  /**
   * A saved entry with no matching live result. `saved_posts` stores the link
   * and nothing else (issue 05), so there is no body to show and no body to
   * draft a comment from — the row says so instead of pretending otherwise.
   */
  linkOnly?: boolean;
  savedAgo?: string | null;
  onToast: (msg: string) => void;
}) {
  const color = PLATFORM_COLOR[post.platform];
  const label = PLATFORM_LABEL[post.platform];
  // The stack rises in sequence, capped so row 30 does not wait a second.
  // Off entirely when the OS asks for reduced motion — globals.css only
  // neutralises CSS animation, and this one is driven in JS.
  const still = useReducedMotion();
  const [gen, setGen] = useState<GenState>({ status: "idle" });
  const [comment, setComment] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      if (data.analysis.category) onAnalyzed?.(post.url, data.analysis.category);
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

  /**
   * The page owns saved state, so the bookmark here and the count in the
   * sidebar can never disagree. A failure comes back as a message and is shown
   * in place: silence would leave a bookmark that looks saved and is not.
   */
  async function toggleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveError(await onToggleSave(post));
    setSaving(false);
  }

  const posted = age(post.posted_at);
  const done = gen.status === "done" ? gen.analysis : null;
  const draft = done?.comment.trim() ?? "";
  // The AI's own label replaces the discovery bucket once a human has spent a
  // call on this post — it read the post, the regex only pattern-matched it.
  const category = done?.category ?? post.category;

  return (
    <motion.article
      initial={still ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.4), ease: [0.2, 0.7, 0.2, 1] }}
      className="glass rounded-2xl overflow-hidden flex flex-col lg:flex-row transition-colors hover:border-[color:var(--border-strong)]"
    >
      {/* LEFT: the post */}
      <div className="flex-1 min-w-0 p-5 sm:p-6 lg:border-r border-b lg:border-b-0 border-[color:var(--border)]">
        <div className="flex items-center gap-3 mb-3.5">
          <div
            className="w-10 h-10 rounded-xl grid place-items-center shrink-0"
            style={{ background: `${color}26`, color }}
          >
            <PlatformIcon platform={post.platform} className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold truncate text-[color:var(--text)]">
              {post.author ? decodeEntities(post.author) : label}
            </div>
            <div className="text-[13px] text-[color:var(--muted)] truncate">
              {label}
              {posted ? ` · ${posted}` : ""}
              {linkOnly && savedAgo ? ` · saved ${savedAgo}` : ""}
            </div>
          </div>
          {category && <CategoryChip category={category} />}
        </div>

        {post.is_reply && (
          <a
            href={post.parent_url ?? post.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 mb-3 text-[13px] font-medium text-[color:var(--accent-2)] hover:underline underline-offset-2"
          >
            <CornerDownRight className="w-4 h-4 shrink-0" strokeWidth={2.2} />
            A reply inside a thread — open the original post
          </a>
        )}

        {post.title && (
          <h3 className="text-[17px] font-semibold leading-snug mb-2 text-[color:var(--text)]">
            {decodeEntities(post.title)}
          </h3>
        )}

        {linkOnly ? (
          <p className="text-[15px] text-[color:var(--muted)] leading-relaxed">
            Saved as a link. Only the address was stored, never the post text, so open the original to read it.
          </p>
        ) : (
          <>
            {/*
              Scrolls rather than clamps, so the whole post is readable without
              leaving the page. The cap is --row-body-h in app/globals.css, set
              off the real length of live results: tall enough that the common
              post needs no scroll at all, short enough that one long post
              cannot push the next row off the screen.
            */}
            <div className="max-h-[var(--row-body-h)] overflow-y-auto overscroll-contain pr-3 text-[15px] text-[color:var(--muted)] leading-[1.65] whitespace-pre-wrap [overflow-wrap:anywhere]">
              {done ? done.summary : decodeEntities(post.body)}
            </div>
            {done && (
              <div className="flex items-center gap-5 mt-4 text-[13px] text-[color:var(--muted)] tabular-nums">
                <span>intent {(done.intent * 100).toFixed(0)}%</span>
                <span>relevance {(done.relevance * 100).toFixed(0)}%</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* RIGHT: Control Center */}
      <div className="w-full lg:w-[19rem] shrink-0 p-5 sm:p-6 flex flex-col gap-2.5 bg-[rgba(255,255,255,0.025)]">
        <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)] mb-0.5">
          Control Center
        </div>

        <a
          href={post.url}
          target="_blank"
          rel="noreferrer"
          className="btn text-[15px] rounded-xl px-3.5 py-2.5 border border-[color:var(--border-strong)] text-[color:var(--text)] hover:bg-[rgba(255,255,255,0.06)] inline-flex items-center gap-2.5"
        >
          <ExternalLink className="w-4 h-4 shrink-0" strokeWidth={2.2} /> Open original
        </a>

        <button
          onClick={toggleSave}
          disabled={saving}
          aria-pressed={saved}
          className="btn text-[15px] rounded-xl px-3.5 py-2.5 border inline-flex items-center gap-2.5"
          style={
            saved
              ? { background: "rgba(96,165,250,0.16)", color: "#93c5fd", borderColor: "rgba(96,165,250,0.45)" }
              : { borderColor: "var(--border-strong)", color: "var(--text)" }
          }
        >
          {saving ? (
            <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
          ) : saved ? (
            <BookmarkCheck className="w-4 h-4 shrink-0" strokeWidth={2.2} />
          ) : (
            <Bookmark className="w-4 h-4 shrink-0" strokeWidth={2.2} />
          )}
          {saved ? "Saved" : "Save as link"}
        </button>

        {saveError && (
          <p className="text-[13px] text-[color:var(--red)] leading-snug" role="alert">
            {saveError}
          </p>
        )}

        {linkOnly ? (
          <p className="text-[13px] text-[color:var(--muted)] leading-snug mt-1 inline-flex items-start gap-2">
            <Link2 className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2.2} />
            Search this topic again to draft a comment on it.
          </p>
        ) : (
          <>
            {!done && gen.status !== "error" && (
              <button
                onClick={generate}
                disabled={gen.status === "loading"}
                className="btn btn-primary text-[15px] font-semibold rounded-xl px-3.5 py-2.5 inline-flex items-center gap-2.5"
              >
                {gen.status === "loading" ? (
                  <>
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" /> Drafting…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 shrink-0" strokeWidth={2.2} /> Generate comment
                  </>
                )}
              </button>
            )}

            {gen.status === "error" && (
              <div>
                <p className="text-[13px] text-[color:var(--red)] mb-2 leading-snug">{gen.message}</p>
                <button
                  onClick={generate}
                  className="btn w-full text-[15px] rounded-xl px-3.5 py-2.5 border border-[color:var(--border-strong)] text-[color:var(--text)]"
                >
                  Try again
                </button>
              </div>
            )}

            {done &&
              (draft ? (
                <div className="mt-1">
                  <div className="flex items-center gap-1.5 mb-2 text-[13px] font-semibold text-[color:var(--primary-2)]">
                    <Sparkles className="w-4 h-4" strokeWidth={2.2} /> Drafted comment
                  </div>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={5}
                    aria-label="Drafted comment, editable before you copy it"
                    className="w-full text-[15px] rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] focus:border-[color:var(--primary)] outline-none px-3 py-2.5 resize-y text-[color:var(--text)] leading-relaxed [color-scheme:dark]"
                  />
                  <button
                    onClick={copy}
                    className="btn text-[15px] font-semibold px-3.5 py-2.5 rounded-xl inline-flex items-center gap-2.5 justify-center w-full mt-2"
                    style={
                      copied
                        ? { background: "rgba(34,197,94,0.18)", color: "#6ee7a0", border: "1px solid rgba(34,197,94,0.45)" }
                        : { background: color, color: "#fff" }
                    }
                  >
                    {copied ? (
                      <Check className="w-4 h-4" strokeWidth={2.4} />
                    ) : (
                      <Copy className="w-4 h-4" strokeWidth={2.2} />
                    )}
                    {copied ? "Copied" : "Copy comment"}
                  </button>
                  <p className="text-[13px] text-[color:var(--muted)] mt-2.5 leading-snug">
                    Paste it yourself on {label} — nothing here posts automatically.
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-[color:var(--muted)] leading-snug">
                  No comment drafted — this reads as a {done.actor}, not someone to reply to.
                </p>
              ))}
          </>
        )}
      </div>
    </motion.article>
  );
}
