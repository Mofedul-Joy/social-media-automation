"use client";

import { Info } from "lucide-react";

/**
 * The "i" beside a label. The tooltip text is carried by the button's
 * aria-label and the bubble itself is aria-hidden, so a screen reader gets it
 * once rather than twice. It opens on hover AND on keyboard focus
 * (`group-focus-within`), so it is not a mouse-only affordance.
 *
 * Solid `--bg-2`-ish rather than the page's `.glass`: a translucent bubble over
 * a translucent card puts the same hue behind the same hue, which is the one
 * thing this UI must never do.
 *
 * The bubble is positioned `absolute` with NO `relative` on this component, so
 * it resolves against the caller's label row and is capped at that row's width
 * instead of hanging off the right edge of a phone. Callers that need a
 * different size pass `bubbleClass`.
 */
export function InfoTip({ text, bubbleClass }: { text: string; bubbleClass?: string }) {
  return (
    <span className="group inline-flex">
      <button
        type="button"
        aria-label={text}
        className="btn relative after:absolute after:content-[''] after:-inset-2.5 w-6 h-6 rounded-full grid place-items-center border border-[color:var(--border-strong)] text-[color:var(--muted)] hover:text-[color:var(--text)] hover:border-[color:var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary-2)]"
      >
        <Info className="w-3.5 h-3.5" strokeWidth={2.4} />
      </button>
      <span
        aria-hidden="true"
        className={
          "pointer-events-none absolute left-0 top-full mt-2 z-30 rounded-xl px-3.5 py-2.5 text-[13px] leading-snug text-left opacity-0 translate-y-1 transition-[opacity,transform] duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 " +
          (bubbleClass ?? "w-[min(22rem,92%)]")
        }
        // Lighter than the card and narrower than the field it covers. A
        // bubble darker than its surroundings reads as a hole rather than as
        // something floating, and at phone width it lands exactly on the
        // textarea — where, matched in width and tone, it looks like typed
        // content instead of a tip.
        style={{
          background: "#1b1b27",
          color: "var(--text)",
          border: "1px solid rgba(255,255,255,0.22)",
          boxShadow: "0 20px 44px -14px rgba(0,0,0,0.9)",
        }}
      >
        {text}
      </span>
    </span>
  );
}
