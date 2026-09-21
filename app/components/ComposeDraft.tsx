"use client";

/**
 * One target's formatted draft: the exact text to paste, what the formatting
 * changed, a Copy button, a link that opens the place, and a done toggle.
 *
 * The done toggle writes one row in this app's own database. It does not tell
 * the platform anything and it does not check the platform for anything — it
 * is Hon's own note that he already pasted this one in himself.
 */

import { useState } from "react";
import { Copy, Check, ExternalLink, CircleCheck, Circle, Scissors, Hash, Loader2 } from "lucide-react";
import type { Platform } from "@/lib/types";
import { PlatformIcon, PLATFORM_COLOR, PLATFORM_LABEL } from "./PlatformIcon";
import { PLATFORM_CONVENTION, type FormattedDraft } from "@/lib/compose";

export interface DraftRow {
  key: string;
  platform: Platform;
  name: string;
  url: string;
  draft: FormattedDraft;
  /** The saved row's id, once the draft has been saved. */
  rowId: number | null;
  done: boolean;
}

const num = (n: number) => n.toLocaleString("en-US");

/**
 * Brand colours are picked for logos, not for holding white 15px label text:
 * Reddit orange, Stack Exchange orange and the Threads grey all land between
 * 2.6:1 and 3.4:1 against white. Darken the fill until white clears 4.5:1, so
 * the primary action on every card is actually readable. Kept local rather
 * than changed in PLATFORM_COLOR, which other surfaces use for icons and tints
 * where the raw brand colour is correct.
 */
function readableFill(hex: string): string {
  const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (rgb: number[]) =>
    rgb
      .map((v) => v / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);

  let rgb = parse(hex);
  // 4.5:1 against white means the fill's relative luminance must be <= 0.1833.
  for (let i = 0; i < 24 && (1.05 / (lum(rgb) + 0.05)) < 4.5; i++) {
    rgb = rgb.map((v) => Math.round(v * 0.92));
  }
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function ComposeDraft({
  row,
  stale,
  onToggleDone,
  onToast,
}: {
  row: DraftRow;
  /** The body has been edited since the last save, so the stored copy is behind. */
  stale: boolean;
  onToggleDone: (row: DraftRow) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const color = PLATFORM_COLOR[row.platform];
  const fill = readableFill(color);
  const label = PLATFORM_LABEL[row.platform];
  const { text, length, limit, hashtagsRemoved, trimmed } = row.draft;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onToast(`Draft for ${row.name} copied — paste it on ${label} yourself`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast("Could not copy — select the draft text and copy it manually");
    }
  }

  async function toggle() {
    setBusy(true);
    try {
      await onToggleDone(row);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className="glass rounded-2xl p-5 relative"
      style={row.done ? { borderColor: "rgba(34,197,94,0.35)" } : undefined}
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-xl grid place-items-center shrink-0"
          style={{ background: `${color}24`, color }}
        >
          <PlatformIcon platform={row.platform} className="w-[18px] h-[18px]" />
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight truncate text-[color:var(--text)]">{row.name}</h3>
          <div className="text-[13px] text-[color:var(--muted)] leading-tight mt-0.5">{label}</div>
        </div>

        <button
          type="button"
          onClick={toggle}
          disabled={busy || row.rowId === null}
          title={row.rowId === null ? "Save the draft first to keep track of this one" : undefined}
          className="btn shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold whitespace-nowrap border"
          style={
            row.done
              ? { background: "rgba(34,197,94,0.14)", color: "#4ade80", borderColor: "rgba(34,197,94,0.45)" }
              : { background: "rgba(255,255,255,0.05)", color: "var(--text)", borderColor: "var(--border-strong)" }
          }
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : row.done ? (
            <CircleCheck className="w-4 h-4" />
          ) : (
            <Circle className="w-4 h-4" />
          )}
          {row.done ? "Posted" : "Mark posted"}
        </button>
      </div>

      {/* The exact text Copy puts on the clipboard. Read-only on purpose: the
          one editable copy of the post is the box at the top of the page, so
          every target stays in sync with what was actually written. */}
      <div className="rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] px-4 py-3 max-h-60 overflow-auto">
        {text ? (
          <p className="text-[15px] leading-relaxed text-[color:var(--text)] whitespace-pre-wrap break-words">{text}</p>
        ) : (
          <p className="text-[15px] leading-relaxed text-[color:var(--muted)]">
            Nothing to paste yet — write your post at the top of the page.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3 text-[13px] text-[color:var(--muted)] tabular-nums">
        <span className={trimmed > 0 ? "text-[color:var(--primary-2)] font-medium" : undefined}>
          {limit === null ? `${num(length)} characters` : `${num(length)} / ${num(limit)} characters`}
        </span>
        {limit === null && <span>{label} publishes no character limit.</span>}
        {hashtagsRemoved > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5" />
            {hashtagsRemoved} hashtag{hashtagsRemoved === 1 ? "" : "s"} removed
          </span>
        )}
        {trimmed > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[color:var(--primary-2)] font-medium">
            <Scissors className="w-3.5 h-3.5" />
            {num(trimmed)} characters trimmed to fit
          </span>
        )}
      </div>

      <p className="text-[13px] text-[color:var(--muted)] leading-relaxed mt-1.5">
        {PLATFORM_CONVENTION[row.platform]}
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={copy}
          disabled={!text}
          className="btn text-[15px] font-semibold px-4 py-2.5 rounded-xl inline-flex items-center gap-2"
          style={
            copied
              ? { background: "rgba(34,197,94,0.14)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.4)" }
              : { background: fill, color: "#fff", boxShadow: `0 8px 22px -10px ${fill}` }
          }
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? "Copied" : "Copy draft"}
        </button>

        {row.url && (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="btn text-[15px] font-medium px-4 py-2.5 rounded-xl inline-flex items-center gap-2 border border-[color:var(--border-strong)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.09)] text-[color:var(--text)] whitespace-nowrap"
          >
            Open {label} <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>

      <p className="text-[13px] text-[color:var(--muted)] leading-relaxed mt-3">
        Paste it yourself on {label} — nothing here posts automatically.
      </p>

      {stale && row.rowId !== null && (
        <p className="text-[13px] text-[color:var(--primary-2)] leading-relaxed mt-1.5">
          You have edited the post since this was saved. Save again to keep the record straight.
        </p>
      )}
    </article>
  );
}
