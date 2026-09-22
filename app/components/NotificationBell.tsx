"use client";

/**
 * The header bell: new replies on posts Hon saved.
 *
 * "Posts Hon engaged with" is the saved-post list and nothing else
 * (.scratch/hon-sma-v2/issues/07). A reply is news when it appears on a saved
 * post's comment tree and was not there the last time we looked. Everything
 * shown here came from the same public per-source reply endpoints discovery
 * already uses — there is no read-back of Hon's own account, and nothing in
 * this component or behind it ever posts anywhere.
 *
 * WHEN IT CHECKS: on page open, and when Hon presses refresh. There is no
 * cron and no background poll, because every check spends a Facebook credit
 * per saved Facebook post and nothing should be spent while nobody is looking.
 * The server holds a cooldown so a reload loop cannot re-spend it; refresh
 * passes `force` because a human deliberately asking is the one case worth
 * paying for immediately.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bell, CheckCheck, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import type { Platform } from "@/lib/types";
import { PlatformIcon, PLATFORM_COLOR, PLATFORM_LABEL } from "./PlatformIcon";
import { decodeEntities } from "@/lib/text";

/** Mirrors `ReplyNotification` in lib/replies.ts, which is server-only and must not be imported here. */
interface ReplyNotification {
  id: string;
  platform: string;
  post_title: string | null;
  post_url: string;
  author: string | null;
  snippet: string;
  url: string;
  posted_at: string | null;
  first_seen_at: string;
  seen_by_user: boolean;
}

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = ms / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

const KNOWN_PLATFORMS: readonly string[] = [
  "reddit",
  "facebook",
  "instagram",
  "threads",
  "hackernews",
  "stackexchange",
];
function asPlatform(p: string): Platform | null {
  return KNOWN_PLATFORMS.includes(p) ? (p as Platform) : null;
}

export function NotificationBell() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<ReplyNotification[]>([]);
  const [unread, setUnread] = useState(0);
  /** "loading" is the first read; "polling" is a live check against the sources. */
  const [busy, setBusy] = useState<"loading" | "polling" | null>("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const apply = useCallback((d: { unread?: number; replies?: ReplyNotification[] }) => {
    if (Array.isArray(d.replies)) setReplies(d.replies);
    if (typeof d.unread === "number") setUnread(d.unread);
  }, []);

  /**
   * Page open runs the live check, not just a read of what is already stored:
   * the point of the bell is to find out whether anything replied since last
   * time. The server's cooldown decides whether that actually costs anything.
   */
  const poll = useCallback(
    async (force: boolean) => {
      setBusy(force ? "polling" : "loading");
      setProblem(null);
      try {
        const res = await fetch("/api/notifications/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force }),
        });
        const d = await res.json();
        if (!res.ok || d.ok === false) {
          setProblem(
            d?.error ??
              "Could not check for new replies just now. Your saved posts are fine — try refresh in a minute.",
          );
          // Fall back to whatever is already stored, so a dead source does not
          // empty a panel that has real unread replies sitting in it.
          const stored = await fetch("/api/notifications").then((r) => r.json());
          apply(stored);
          return;
        }
        apply(d);
      } catch {
        setProblem(
          "Could not check for new replies just now. Your saved posts are fine — try refresh in a minute.",
        );
      } finally {
        setBusy(null);
      }
    },
    [apply],
  );

  useEffect(() => {
    void poll(false);
  }, [poll]);

  // Close on click-away and on Escape. A dropdown that can only be closed by
  // the button that opened it is a trap on a page with one narrow header.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /**
   * Optimistic: the row is already dimmed by the time the request lands, and
   * the server's own count overwrites the guess when it answers.
   *
   * `ids` omitted means ALL, and it is sent as an empty body rather than as
   * the ids of the rows on screen. The panel holds at most the newest 50, so
   * sending what it can see would leave every unread reply past that page
   * still counted — measured: 78 unread, "Mark all read" cleared 50 and left
   * 28 on the badge with nothing on screen to clear them with.
   */
  async function markSeen(ids?: string[]) {
    const all = ids === undefined;
    if (!all && ids.length === 0) return;
    if (all && unread === 0) return;
    const hit = new Set(ids ?? []);
    setReplies((rs) => (all ? rs.map((r) => ({ ...r, seen_by_user: true })) : rs.map((r) => (hit.has(r.id) ? { ...r, seen_by_user: true } : r))));
    setUnread((n) => (all ? 0 : Math.max(0, n - hit.size)));
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(all ? {} : { ids }),
      });
      const d = await res.json();
      if (typeof d?.unread === "number") setUnread(d.unread);
    } catch {
      // The count is cosmetic and the next page open re-reads it, so a failed
      // mark-seen is not worth an error message over a link that did open.
    }
  }

  const checking = busy !== null;

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Replies, ${unread} new` : "Replies"}
        aria-expanded={open}
        className={
          "btn inline-flex items-center gap-2 text-sm font-medium glass rounded-full px-4 py-2 " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary-2)] " +
          (open || unread > 0
            ? "text-[color:var(--text)]"
            : "text-[color:var(--muted)] hover:text-[color:var(--text)]")
        }
      >
        <Bell className="w-4 h-4" strokeWidth={2.2} />
        Replies
        {unread > 0 ? (
          <span className="btn-primary tabular-nums text-[12px] font-bold leading-none rounded-full px-2 py-[3px] min-w-[1.35rem] text-center">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : (
          <span className="tabular-nums text-[color:var(--faint)]">0</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98, filter: "blur(4px)" }}
            transition={{ duration: reduce ? 0.01 : 0.26, ease: [0.16, 1, 0.3, 1] }}
            /*
             * The bell is not the rightmost thing in the header, so anchoring
             * the panel to it alone pushes 27rem of panel off the LEFT edge on
             * a phone (measured: left: -57px at a 500px viewport). Below sm it
             * leaves the header's coordinate space entirely and spans the
             * viewport with its own gutters; from sm up it hangs off the bell
             * as a dropdown should.
             */
            className="glass fixed inset-x-3 top-[4.75rem] z-50 rounded-2xl overflow-hidden shadow-[0_28px_70px_-24px_rgba(0,0,0,0.85)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[27rem]"
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 border-b border-[color:var(--border)]">
              <div className="leading-tight text-left">
                <div className="font-semibold text-[15px]">New replies</div>
                <div className="text-[12px] text-[color:var(--faint)] mt-0.5">
                  On the posts you saved
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {unread > 0 && (
                  <button
                    onClick={() => void markSeen()}
                    className="btn inline-flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] hover:bg-[rgba(255,255,255,0.06)] rounded-lg px-2.5 py-2.5"
                  >
                    <CheckCheck className="w-3.5 h-3.5" strokeWidth={2.2} />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => void poll(true)}
                  disabled={checking}
                  aria-label="Check for new replies now"
                  title="Check for new replies now"
                  className="btn grid place-items-center w-9 h-9 rounded-lg text-[color:var(--muted)] hover:text-[color:var(--text)] hover:bg-[rgba(255,255,255,0.06)]"
                >
                  <RefreshCw
                    className={"w-4 h-4 " + (busy === "polling" ? "animate-spin" : "")}
                    strokeWidth={2.2}
                  />
                </button>
              </div>
            </div>

            {problem && (
              <div className="px-4 py-3 text-[13px] leading-relaxed text-[#ffd0d0] bg-[rgba(255,107,107,0.10)] border-b border-[rgba(255,107,107,0.28)] text-left">
                {problem}
              </div>
            )}

            <div className="max-h-[26rem] overflow-y-auto">
              {busy === "loading" && replies.length === 0 ? (
                <div className="px-4 py-8 flex items-center justify-center gap-2 text-[13px] text-[color:var(--muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.2} />
                  Checking your saved posts
                </div>
              ) : replies.length === 0 ? (
                <div className="px-4 py-7 text-left">
                  <div className="text-[14px] font-medium">Nothing new yet</div>
                  <p className="text-[13px] leading-relaxed text-[color:var(--muted)] mt-1.5">
                    Save a post from your results and Pulse will check it for new replies every
                    time you open this page.
                  </p>
                </div>
              ) : (
                <ul>
                  {replies.map((r) => {
                    const platform = asPlatform(r.platform);
                    const when = ago(r.posted_at ?? r.first_seen_at);
                    return (
                      <li key={r.id} className="border-b border-[color:var(--border)] last:border-b-0">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            if (!r.seen_by_user) void markSeen([r.id]);
                          }}
                          className="group block px-4 py-3.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] focus-visible:outline-none focus-visible:bg-[rgba(255,255,255,0.07)]"
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              aria-hidden
                              className={
                                "w-1.5 h-1.5 rounded-full shrink-0 " +
                                (r.seen_by_user ? "bg-transparent" : "")
                              }
                              style={
                                r.seen_by_user ? undefined : { background: "var(--primary-2)" }
                              }
                            />
                            {platform && (
                              <span
                                className="shrink-0"
                                style={{ color: PLATFORM_COLOR[platform] }}
                                title={PLATFORM_LABEL[platform]}
                              >
                                <PlatformIcon platform={platform} className="w-3.5 h-3.5" />
                              </span>
                            )}
                            <span
                              className={
                                "text-[13px] font-semibold truncate " +
                                (r.seen_by_user
                                  ? "text-[color:var(--muted)]"
                                  : "text-[color:var(--text)]")
                              }
                            >
                              {r.author ?? "Someone"}
                            </span>
                            {when && (
                              <span className="text-[12px] text-[color:var(--faint)] shrink-0 ml-auto tabular-nums">
                                {when}
                              </span>
                            )}
                            <ExternalLink
                              className="w-3.5 h-3.5 shrink-0 text-[color:var(--faint)] opacity-0 group-hover:opacity-100 transition-opacity"
                              strokeWidth={2.2}
                              aria-hidden
                            />
                          </div>
                          {/*
                            The snippet is the content of the row, so it stays
                            at --muted whether the reply is read or not:
                            --faint is 3.5:1 on this surface and this is the
                            text Hon has to actually read. Read and unread are
                            told apart by the dot and by the author's weight
                            instead, which costs no legibility.
                          */}
                          <p className="text-[13px] leading-relaxed line-clamp-2 text-[color:var(--muted)]">
                            {decodeEntities(r.snippet)}
                          </p>
                          <div className="text-[12px] text-[color:var(--faint)] mt-1.5 truncate">
                            on {r.post_title ? decodeEntities(r.post_title) : r.post_url}
                          </div>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
