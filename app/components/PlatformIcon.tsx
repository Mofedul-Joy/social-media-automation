import type { Platform } from "@/lib/types";

export const PLATFORM_COLOR: Record<Platform, string> = {
  reddit: "#ff4500",
  facebook: "#1877f2",
  instagram: "#e1306c",
  hackernews: "#ff6600",
  stackexchange: "#f48024",
  threads: "#8a8a8a",
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  reddit: "Reddit",
  facebook: "Facebook",
  instagram: "Instagram",
  hackernews: "Hacker News",
  stackexchange: "Stack Exchange",
  threads: "Threads",
};

/** Real brand marks for Reddit/Facebook/Instagram; a plain letter badge for the
 * rest rather than an imprecise imitation of a mark this app doesn't need to
 * reproduce exactly. */
export function PlatformIcon({ platform, className = "w-4 h-4" }: { platform: Platform; className?: string }) {
  if (platform === "reddit") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M12 2c5.514 0 10 4.486 10 10s-4.486 10-10 10S2 17.514 2 12 6.486 2 12 2Zm5.02 9.06a1.44 1.44 0 0 0-2.44-.99c-1.02-.7-2.4-1.15-3.93-1.2l.8-3.56 2.5.55a1.03 1.03 0 1 0 .12-.72l-2.86-.63a.36.36 0 0 0-.43.28l-.88 3.94c-1.56.05-2.96.5-3.99 1.21A1.44 1.44 0 1 0 5.5 13.4a2.6 2.6 0 0 0-.03.4c0 2.05 2.39 3.72 5.33 3.72s5.33-1.67 5.33-3.72c0-.13-.01-.26-.03-.39a1.44 1.44 0 0 0 .92-1.35ZM8.9 12.3a1.03 1.03 0 1 1 2.06 0 1.03 1.03 0 0 1-2.06 0Zm5.74 2.7c-.63.63-1.83.68-2.18.68-.36 0-1.56-.05-2.19-.68a.24.24 0 0 1 .34-.34c.4.4 1.25.54 1.85.54s1.44-.14 1.84-.54a.24.24 0 1 1 .34.34Zm-.2-1.67a1.03 1.03 0 1 1 0-2.06 1.03 1.03 0 0 1 0 2.06Z" />
      </svg>
    );
  }
  if (platform === "facebook") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.9 3.77-3.9 1.09 0 2.24.19 2.24.19v2.47H15.2c-1.24 0-1.63.77-1.63 1.56v1.89h2.78l-.44 2.9h-2.34V22c4.78-.76 8.43-4.92 8.43-9.94Z" />
      </svg>
    );
  }
  if (platform === "instagram") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M12 2c2.72 0 3.06.01 4.12.06 1.07.05 1.8.22 2.43.47.66.25 1.22.6 1.77 1.15.55.55.9 1.11 1.15 1.77.25.63.42 1.36.47 2.43.05 1.07.06 1.4.06 4.12s-.01 3.06-.06 4.12c-.05 1.07-.22 1.8-.47 2.43a4.9 4.9 0 0 1-1.15 1.77c-.55.55-1.11.9-1.77 1.15-.63.25-1.36.42-2.43.47-1.07.05-1.4.06-4.12.06s-3.06-.01-4.12-.06c-1.07-.05-1.8-.22-2.43-.47a4.9 4.9 0 0 1-1.77-1.15 4.9 4.9 0 0 1-1.15-1.77c-.25-.63-.42-1.36-.47-2.43C2.01 15.06 2 14.72 2 12s.01-3.06.06-4.12c.05-1.07.22-1.8.47-2.43.25-.66.6-1.22 1.15-1.77.55-.55 1.11-.9 1.77-1.15.63-.25 1.36-.42 2.43-.47C8.94 2.01 9.28 2 12 2Zm0 1.8c-2.67 0-2.99.01-4.04.06-.98.04-1.5.21-1.86.35-.47.18-.8.4-1.15.75-.35.35-.57.68-.75 1.15-.14.36-.31.88-.35 1.86-.05 1.05-.06 1.37-.06 4.04s.01 2.99.06 4.04c.04.98.21 1.5.35 1.86.18.47.4.8.75 1.15.35.35.68.57 1.15.75.36.14.88.31 1.86.35 1.05.05 1.37.06 4.04.06s2.99-.01 4.04-.06c.98-.04 1.5-.21 1.86-.35.47-.18.8-.4 1.15-.75.35-.35.57-.68.75-1.15.14-.36.31-.88.35-1.86.05-1.05.06-1.37.06-4.04s-.01-2.99-.06-4.04c-.04-.98-.21-1.5-.35-1.86a3.1 3.1 0 0 0-.75-1.15 3.1 3.1 0 0 0-1.15-.75c-.36-.14-.88-.31-1.86-.35-1.05-.05-1.37-.06-4.04-.06Zm0 3.07a5.13 5.13 0 1 1 0 10.26 5.13 5.13 0 0 1 0-10.26Zm0 1.8a3.33 3.33 0 1 0 0 6.66 3.33 3.33 0 0 0 0-6.66Zm5.34-3.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Z" />
      </svg>
    );
  }
  const letter = platform === "hackernews" ? "Y" : platform === "stackexchange" ? "S" : "T";
  return (
    <span
      className={`${className} inline-flex items-center justify-center font-bold leading-none`}
      style={{ fontSize: "0.7em" }}
      aria-hidden
    >
      {letter}
    </span>
  );
}
