/**
 * /analytics — counts only. No time series, no week-over-week, no chart over
 * time (decided in `.scratch/hon-sma-v2/issues/10-analytics-trend-dashboard.md`).
 *
 * Every figure on this page is a count of rows this app actually stored. There
 * is no estimate, no projection and no placeholder anywhere in here: if a
 * number is unknown the page says so in words rather than showing a digit that
 * cannot be traced back to a row.
 *
 * Server component. It calls `loadAnalytics()` directly rather than fetching
 * its own `/api/analytics` — that route exists for anything outside the app,
 * but a server-side fetch back into this app would have to re-satisfy the Basic
 * Auth middleware with credentials it has no business handling. Reading the
 * store once, here, is both simpler and one round trip cheaper.
 */

import Link from "next/link";
import { Radio, Search, PenLine, ArrowRight } from "lucide-react";
import {
  loadAnalytics,
  EMPTY_ANALYTICS,
  type Analytics,
  type PlatformRow,
  type TopicRow,
} from "@/lib/analytics";
import { CATEGORY_BUYER } from "@/lib/types";
import type { Platform } from "@/lib/types";
import { PlatformIcon, PLATFORM_COLOR, PLATFORM_LABEL } from "../components/PlatformIcon";
import { InfoTip } from "../components/InfoTip";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const metadata = {
  title: "Counts | Pulse",
  description:
    "Running totals of what this app has found, saved and drafted, and which topics bring the most buyers.",
};

/** One fixed locale, so the server-rendered string never depends on where this runs. */
const NUM = new Intl.NumberFormat("en-GB");
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function n(v: number): string {
  return NUM.format(v);
}

/** Dates come out of Postgres as ISO strings; an unparseable one prints as a dash, never as today. */
function day(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? DATE.format(d) : "-";
}

/**
 * Share of a total, as a percentage of the bar's track. Returns 0 rather than
 * NaN when the total is 0, so an empty database draws no bar at all instead of
 * a full one.
 */
function share(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

/** Only the six platforms have a colour and a mark; anything else falls back to neutral. */
function isPlatform(p: string): p is Platform {
  return p in PLATFORM_COLOR;
}

function Figure({
  label,
  value,
  tip,
  accent,
  tipRight,
}: {
  label: string;
  value: number;
  tip: string;
  accent?: boolean;
  /**
   * True for the tiles that sit in the right-hand column of the two-column
   * phone layout. Their bubble hangs off the right of the screen if it opens
   * leftwards from the label, so it opens rightwards from the tile's right
   * edge instead. Below `lg` only: at five columns there is room either way.
   */
  tipRight?: boolean;
}) {
  return (
    <div>
      {/* `relative` so InfoTip's absolutely-positioned bubble resolves against
          this row and is capped at its width, per the component's contract. */}
      <div className="relative flex items-center gap-1.5 mb-1.5">
        <span className="text-[13px] font-medium text-[color:var(--muted)] whitespace-nowrap">{label}</span>
        <InfoTip
          text={tip}
          bubbleClass={"w-[min(20rem,86vw)] " + (tipRight ? "max-lg:left-auto max-lg:right-0" : "")}
        />
      </div>
      <div
        className="text-[2.25rem] leading-none font-bold tracking-[-0.03em] tabular-nums"
        style={accent ? { color: "var(--primary-2)" } : undefined}
      >
        {n(value)}
      </div>
    </div>
  );
}

/** A label, a count, and a bar that is a real share of a real total. */
function Meter({
  label,
  icon,
  value,
  total,
  color,
  sub,
}: {
  label: string;
  icon?: React.ReactNode;
  value: number;
  total: number;
  color: string;
  sub?: string;
}) {
  const pct = share(value, total);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-4 mb-2">
        {/* No decorative bullet when there is no platform mark: the bar
            directly below already carries this row's colour, so a dot would
            only repeat it. */}
        <span className="flex items-center gap-2 min-w-0">
          {icon && (
            <span className="shrink-0 grid place-items-center w-5 h-5" style={{ color }}>
              {icon}
            </span>
          )}
          <span className="text-[15px] font-medium truncate">{label}</span>
        </span>
        <span className="shrink-0 flex items-baseline gap-2">
          <span className="text-[17px] font-semibold tabular-nums">{n(value)}</span>
          <span className="text-[13px] text-[color:var(--muted)] tabular-nums">{pct}%</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      {sub && <div className="mt-1.5 text-[13px] text-[color:var(--muted)]">{sub}</div>}
    </li>
  );
}

function Panel({
  title,
  tip,
  className,
  children,
}: {
  title: string;
  tip: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={"glass rounded-2xl p-6 sm:p-7 " + (className ?? "")}>
      <div className="relative flex items-center gap-2 mb-5">
        <h2 className="text-[17px] font-semibold tracking-tight whitespace-nowrap">{title}</h2>
        <InfoTip text={tip} bubbleClass="w-[min(22rem,86vw)]" />
      </div>
      {children}
    </section>
  );
}

/** What a section says when it has nothing real to show. Never a zeroed row that looks like data. */
function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-[color:var(--muted)]">{children}</p>;
}

export default async function AnalyticsPage() {
  let a: Analytics = EMPTY_ANALYTICS;
  let loadError: string | null = null;

  try {
    a = await loadAnalytics();
  } catch (err) {
    // The raw exception tells Hon nothing he can act on, so it goes to the
    // server log and he gets the state of play instead of a screen of zeroes
    // he would read as real counts.
    console.error(`GET /analytics: ${(err as Error).message}`);
    loadError =
      "Could not reach the place these counts are stored, so nothing below could be read. Rather than show zeroes that would look like real totals, this page is showing nothing at all. Try reloading in a minute.";
  }

  const t = a.totals;
  const counted = t.results_found;
  const nothingYet =
    !loadError &&
    t.searches_run === 0 &&
    t.results_found === 0 &&
    t.posts_saved === 0 &&
    t.drafts_composed === 0;

  // Result counting started when this page shipped. A topic searched before
  // that has a search on the clock and no results against it — say so, rather
  // than let a real 0 read as "that search found nothing".
  const searchedBeforeCounting = !nothingYet && !loadError && t.searches_run > 0 && counted === 0;

  const topics: TopicRow[] = a.byTopic;
  const platforms: PlatformRow[] = a.byPlatform;
  const topBuyerHits = topics.reduce((m, r) => Math.max(m, r.buyer_hits), 0);
  const platformTotal = platforms.reduce((s, r) => s + r.results, 0);

  return (
    // `overflow-x-clip`: the info bubbles are laid out even while hidden, and a
    // bubble hanging off a right-hand tile would otherwise give the whole page a
    // sideways scrollbar at phone width. Clipping costs nothing real here, since
    // the bubble's full text is also the button's aria-label.
    <main className="relative z-10 mx-auto max-w-5xl px-5 sm:px-8 py-10 overflow-x-clip">
      {/* Wraps rather than squeezes: at phone width the brand and both links do
          not fit on one line, and a nav that wraps to its own line reads better
          than a link label broken across two. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-4 mb-10">
        <Link href="/" className="btn flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl grid place-items-center btn-primary">
            <Radio className="w-[18px] h-[18px]" strokeWidth={2.4} />
          </span>
          <span className="leading-tight text-left">
            <span className="block font-bold tracking-tight">Pulse</span>
            <span className="block text-[11px] text-[color:var(--muted)] -mt-0.5">Engagement Studio</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/"
            className="btn inline-flex items-center gap-2 text-sm font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] glass rounded-full px-4 py-2 whitespace-nowrap"
          >
            <Search className="w-4 h-4" strokeWidth={2.2} />
            Find posts
          </Link>
          <Link
            href="/compose"
            className="btn inline-flex items-center gap-2 text-sm font-medium text-[color:var(--muted)] hover:text-[color:var(--text)] glass rounded-full px-4 py-2 whitespace-nowrap"
          >
            <PenLine className="w-4 h-4" strokeWidth={2.2} />
            Compose
          </Link>
        </nav>
      </header>

      <div className="max-w-2xl mb-9">
        <h1 className="text-3xl sm:text-[2.6rem] font-bold tracking-tight leading-[1.08] mb-4">Counted so far</h1>
        <p className="text-[15px] sm:text-base leading-relaxed text-[color:var(--muted)]">
          Running totals of what this app has actually found, saved and drafted. Every figure is a count of
          stored rows, never an estimate, and nothing here resets or rolls over.
        </p>
      </div>

      {loadError && (
        <div
          className="rounded-2xl px-5 py-4 mb-8 text-[15px] leading-relaxed"
          style={{
            background: "rgba(255,107,107,0.10)",
            border: "1px solid rgba(255,107,107,0.38)",
            color: "#ffd7d7",
          }}
        >
          {loadError}
        </div>
      )}

      {nothingYet && (
        <section className="glass rounded-2xl p-7 sm:p-9 max-w-2xl">
          <h2 className="text-xl font-semibold tracking-tight mb-3">Nothing has been counted yet</h2>
          <p className="text-[15px] leading-relaxed text-[color:var(--muted)] mb-2">
            This page only ever shows what you have already done. Run a search and its results are counted by
            category and by platform. Save a post and it is counted. Write a draft in Compose and it is counted.
          </p>
          <p className="text-[15px] leading-relaxed text-[color:var(--muted)] mb-6">
            Until then there is genuinely nothing to show, so nothing is shown. No sample figures, no
            placeholders.
          </p>
          <Link
            href="/"
            className="btn btn-primary inline-flex items-center gap-2 text-[15px] font-semibold rounded-xl px-5 py-3"
          >
            Run your first search
            <ArrowRight className="w-4 h-4" strokeWidth={2.4} />
          </Link>
        </section>
      )}

      {!loadError && !nothingYet && (
        <>
          <section className="glass rounded-2xl p-6 sm:p-8 mb-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-8 gap-y-7">
              <Figure
                label="Searches run"
                value={t.searches_run}
                tip="Every search you have ever run, added up across all topics. Searching the same topic twice counts twice."
              />
              <Figure
                tipRight
                label="Results found"
                value={t.results_found}
                tip="Posts that came back from those searches and were shown to you, added up. The same post surfacing in two searches counts twice."
              />
              <Figure
                label="Buyer results"
                value={t.buyer_results}
                accent
                tip={`Of those results, the ones discovery labelled "${CATEGORY_BUYER}". That label comes from the word filters in the search itself, before any AI is involved.`}
              />
              <Figure
                tipRight
                label="Posts saved"
                value={t.posts_saved}
                tip="Posts you saved with the bookmark button. One row per link, so saving the same post twice does not count twice."
              />
              <Figure
                label="Drafts composed"
                value={t.drafts_composed}
                tip="Posts you wrote on the Compose page. It does not count comments drafted by Generate, because those are never stored and so there is no row to count."
              />
            </div>
          </section>

          {searchedBeforeCounting ? (
            <p className="text-[13px] leading-relaxed text-[color:var(--muted)] mb-8 max-w-2xl">
              Searches were being remembered before results started being counted, so the searches above have no
              results against them yet. The breakdowns below fill in from your next search onwards.
            </p>
          ) : (
            <div className="mb-8" />
          )}

          {/* Two rows against up to six, so the split is 2/5 and 3/5 rather than
              half each, and `items-start` stops the shorter panel being stretched
              to the taller one's height and ending in a field of nothing. */}
          <div className="grid lg:grid-cols-5 items-start gap-4 mb-4">
            <Panel
              className="lg:col-span-2"
              title="By category"
              tip="Which of the two discovery labels your results came back with. Set by the word filters in the search itself, with no AI call, so the same post always gets the same label."
            >
              {a.byCategory.length === 0 ? (
                <Nothing>No results have been counted yet, so there is nothing to split by category.</Nothing>
              ) : (
                <ul className="space-y-5">
                  {a.byCategory.map((c) => (
                    <Meter
                      key={c.category}
                      label={c.category}
                      value={c.results}
                      total={counted}
                      color={c.category === CATEGORY_BUYER ? "var(--primary-2)" : "var(--accent-2)"}
                    />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              className="lg:col-span-3"
              title="By platform"
              tip="Where those results came from. The bar is that platform's share of every result counted. Saved counts your bookmarks, which can include platforms a search never reaches."
            >
              {platforms.length === 0 ? (
                <Nothing>
                  Nothing has been counted from any platform yet. No results found and no posts saved.
                </Nothing>
              ) : (
                <ul className="space-y-5">
                  {platforms.map((p) => (
                    <Meter
                      key={p.platform}
                      label={isPlatform(p.platform) ? PLATFORM_LABEL[p.platform] : p.platform}
                      icon={
                        isPlatform(p.platform) ? (
                          <PlatformIcon platform={p.platform} className="w-[18px] h-[18px]" />
                        ) : undefined
                      }
                      value={p.results}
                      total={platformTotal}
                      color={isPlatform(p.platform) ? PLATFORM_COLOR[p.platform] : "var(--muted)"}
                      sub={`${n(p.buyer_results)} buyer · ${n(p.saved)} saved`}
                    />
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel
            title="Topics by buyer hits"
            tip={`Every topic you have searched, ranked by how many "${CATEGORY_BUYER}" results it has produced in total. Cumulative across every time you searched it, so a topic climbs by being worth searching again.`}
          >
            {topics.length === 0 ? (
              <Nothing>No topic has been searched yet, so there is nothing to rank.</Nothing>
            ) : (
              // Below `sm` the two columns that answer "how often" drop out and
              // the bar beside the buyer count goes with them, leaving rank,
              // topic, buyer hits and all results: the ranking itself, which is
              // what the table is for. Nothing is summarised or rounded to make
              // that fit, the columns are simply not drawn, and every one of
              // them is there at tablet width up.
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full sm:min-w-[34rem] text-left border-collapse">
                  <thead>
                    <tr className="text-[12px] font-semibold uppercase tracking-[0.07em] text-[color:var(--muted)]">
                      <th scope="col" className="font-semibold py-2 px-1 w-8">
                        #
                      </th>
                      <th scope="col" className="font-semibold py-2 px-1">
                        Topic
                      </th>
                      <th scope="col" className="font-semibold py-2 px-1 sm:w-[36%]">
                        Buyer hits
                      </th>
                      <th scope="col" className="font-semibold py-2 px-1 text-right whitespace-nowrap">
                        All results
                      </th>
                      <th scope="col" className="hidden sm:table-cell font-semibold py-2 px-1 text-right">
                        Searches
                      </th>
                      <th
                        scope="col"
                        className="hidden sm:table-cell font-semibold py-2 px-1 text-right whitespace-nowrap"
                      >
                        Last searched
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topics.map((r, i) => (
                      <tr key={r.topic} className="border-t border-[color:var(--border)] align-middle">
                        <td className="py-3.5 px-1 text-[13px] tabular-nums text-[color:var(--muted)]">{i + 1}</td>
                        <td
                          className="py-3.5 px-1 pr-4 text-[15px] font-medium max-w-[8.5rem] sm:max-w-[16rem] truncate"
                          title={r.topic}
                        >
                          {r.topic}
                        </td>
                        <td className="py-3.5 px-1 pr-4">
                          <div className="flex items-center gap-3">
                            <span className="text-[15px] font-semibold tabular-nums w-8 shrink-0">
                              {n(r.buyer_hits)}
                            </span>
                            <span
                              className="hidden sm:block h-1.5 rounded-full flex-1 min-w-[3rem] overflow-hidden"
                              style={{ background: "rgba(255,255,255,0.07)" }}
                            >
                              <span
                                className="block h-full rounded-full"
                                style={{
                                  width: `${share(r.buyer_hits, topBuyerHits)}%`,
                                  background: "var(--primary-2)",
                                }}
                              />
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-1 text-right text-[15px] tabular-nums">{n(r.total_hits)}</td>
                        <td className="hidden sm:table-cell py-3.5 px-1 text-right text-[15px] tabular-nums">
                          {n(r.use_count)}
                        </td>
                        <td className="hidden sm:table-cell py-3.5 px-1 text-right text-[14px] tabular-nums text-[color:var(--muted)] whitespace-nowrap">
                          {day(r.last_used_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </main>
  );
}
