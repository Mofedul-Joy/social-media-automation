"use client";

/**
 * The results sidebar (issue 06).
 *
 * Every filter is a toggle and they AND together: platform AND category AND
 * saved can all be on at once. Counts are computed by the page against the
 * rows it already holds — there is no extra API call behind any number here,
 * so a count can never disagree with what the stack shows.
 *
 * A filter with no matches is kept visible but dimmed rather than removed, so
 * the list does not reshuffle under the cursor while it is being used, and so
 * "Facebook 0" is readable as an answer instead of as a missing row.
 */

import { Check, Bookmark, Download } from "lucide-react";
import type { Platform } from "@/lib/types";
import { PlatformIcon, PLATFORM_COLOR, PLATFORM_LABEL } from "./PlatformIcon";
import { InfoTip } from "./InfoTip";

/** Narrow enough for the sidebar, wide enough to not set one word per line. */
const TIP = "w-[15rem]";

function Group({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="relative flex items-center gap-1.5 mb-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)] whitespace-nowrap">
          {label}
        </h3>
        <InfoTip text={tip} bubbleClass={TIP} />
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Row({
  on,
  count,
  label,
  icon,
  onClick,
}: {
  on: boolean;
  count: number;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={
        "btn w-full text-left flex items-center gap-2.5 rounded-lg pl-1.5 pr-2 py-1.5 border border-transparent " +
        "hover:bg-[rgba(255,255,255,0.06)] hover:border-[color:var(--border)] " +
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--primary-2)] " +
        (count === 0 && !on ? "opacity-55" : "")
      }
    >
      <span
        aria-hidden
        className="w-[18px] h-[18px] shrink-0 rounded-[6px] grid place-items-center border transition-colors"
        style={
          on
            ? { background: "var(--primary)", borderColor: "var(--primary)", color: "#fff" }
            : { borderColor: "var(--border-strong)" }
        }
      >
        {on && <Check className="w-3 h-3" strokeWidth={3.2} />}
      </span>
      {icon}
      <span className="flex-1 text-[14px] text-[color:var(--text)] whitespace-nowrap">{label}</span>
      <span className="shrink-0 text-[13px] tabular-nums text-[color:var(--muted)]">{count}</span>
    </button>
  );
}

export interface SidebarFilters {
  platforms: Platform[];
  categories: string[];
  savedOnly: boolean;
}

export function ResultsSidebar({
  platformCounts,
  categoryCounts,
  savedCount,
  filters,
  onChange,
  onExport,
  exportLabel,
  exportDisabled,
}: {
  platformCounts: { platform: Platform; count: number }[];
  categoryCounts: { category: string; count: number }[];
  /** null when the saved-posts store is unreachable, which hides the filter. */
  savedCount: number | null;
  filters: SidebarFilters;
  onChange: (next: SidebarFilters) => void;
  onExport: () => void;
  exportLabel: string;
  exportDisabled: boolean;
}) {
  const active = filters.platforms.length + filters.categories.length + (filters.savedOnly ? 1 : 0);

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <aside className="lg:w-[17.5rem] shrink-0">
      <div className="glass rounded-2xl p-5 lg:sticky lg:top-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">Filters</h2>
          {active > 0 && (
            <button
              onClick={() => onChange({ platforms: [], categories: [], savedOnly: false })}
              className="btn text-[13px] font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] underline underline-offset-2"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <Group
            label="Platform"
            tip="Show only results from the platforms you tick. Untick everything to see all of them."
          >
            {platformCounts.map(({ platform, count }) => (
              <Row
                key={platform}
                on={filters.platforms.includes(platform)}
                count={count}
                label={PLATFORM_LABEL[platform]}
                icon={
                  <span className="shrink-0 grid place-items-center" style={{ color: PLATFORM_COLOR[platform] }}>
                    <PlatformIcon platform={platform} className="w-4 h-4" />
                  </span>
                }
                onClick={() => onChange({ ...filters, platforms: toggle(filters.platforms, platform) })}
              />
            ))}
          </Group>

          {categoryCounts.length > 0 && (
            <Group
              label="Type"
              tip="High-potential customer means the post asks for something. General conversation means it only talks about the topic."
            >
              {categoryCounts.map(({ category, count }) => (
                <Row
                  key={category}
                  on={filters.categories.includes(category)}
                  count={count}
                  label={category.charAt(0).toUpperCase() + category.slice(1)}
                  onClick={() => onChange({ ...filters, categories: toggle(filters.categories, category) })}
                />
              ))}
            </Group>
          )}

          {savedCount !== null && (
            <Group
              label="Saved"
              tip="Your bookmarked links, including ones from earlier searches. Only the address is stored, never the post text."
            >
              <Row
                on={filters.savedOnly}
                count={savedCount}
                label="Saved links only"
                icon={<Bookmark className="w-4 h-4 shrink-0 text-[color:var(--accent-2)]" strokeWidth={2.2} />}
                onClick={() => onChange({ ...filters, savedOnly: !filters.savedOnly })}
              />
            </Group>
          )}
        </div>

        <div className="mt-6 pt-5 border-t border-[color:var(--border)]">
          <button
            onClick={onExport}
            disabled={exportDisabled}
            className="btn w-full text-[14px] font-semibold rounded-xl px-3 py-2.5 border border-[color:var(--border-strong)] text-[color:var(--text)] hover:bg-[rgba(255,255,255,0.06)] inline-flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4 shrink-0" strokeWidth={2.2} />
            {exportLabel}
          </button>
          <p className="text-[13px] text-[color:var(--muted)] leading-snug mt-2.5">
            Downloads exactly the rows showing now, filters and all.
          </p>
        </div>
      </div>
    </aside>
  );
}
