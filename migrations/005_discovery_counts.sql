-- 005_discovery_counts
--
-- The counts behind /analytics. COUNTS ONLY: no timestamps, no event log, no
-- time series (decided in .scratch/hon-sma-v2/issues/10-analytics-trend-dashboard.md).
--
-- WHY A TABLE AT ALL: discovery results are never persisted. `/api/topic-search`
-- returns the ScrapedPost objects straight to the browser and forgets them, so
-- by the time anyone opens the dashboard there is nothing left to count. The
-- only moment the numbers exist is the instant the search returns, so that is
-- where they get recorded.
--
-- WHY ONE COUNTS TABLE AND NOT A `buyer_hits` COLUMN ON search_topics: the
-- dashboard needs three different breakdowns — per topic (the leaderboard),
-- per category, and per platform. A `buyer_hits` column answers only the first,
-- so the other two would need a second mechanism, and then the same result is
-- counted into two places that can drift apart the moment one write succeeds
-- and the other does not. One row per (topic, platform, category) answers all
-- three by summing the same column along a different axis: one source of truth,
-- nothing counted twice, and a number that can only ever be wrong the way the
-- writer was wrong.
--
-- HOW TO RUN: paste into the Supabase SQL editor for this project and execute.
-- It is idempotent, so running it twice is safe.

-- The composite primary key IS the grain, and that is what makes the upsert in
-- lib/analytics.ts (`onConflict: "topic,platform,category"`) accumulate onto one
-- row per bucket instead of appending a row per search. `hits` is a running
-- total, never a delta.
--
-- The FK to search_topics is what keeps the leaderboard honest: /api/topic-search
-- records the topic before it records counts, so every counted row has a topic
-- row to join to, and deleting a topic takes its counts with it rather than
-- leaving orphans the totals would still be summing.
create table if not exists public.discovery_counts (
  topic    text    not null references public.search_topics (topic) on delete cascade,
  platform text    not null,
  category text    not null,
  hits     integer not null default 0,
  primary key (topic, platform, category)
);

-- The PK already covers lookups by topic (it is the leading column). The
-- category rollup has no such prefix, so it gets the one extra index.
create index if not exists discovery_counts_category_idx
  on public.discovery_counts (category);

-- Reached exclusively by the service-role key from route handlers
-- (lib/supabaseClient.ts is server-side only and is never imported into a
-- client component), never from a browser. So RLS is on with no policies:
-- anon and authenticated get nothing at all, service role bypasses it.
alter table public.discovery_counts enable row level security;

-- ---------------------------------------------------------------------------
-- Read views. ALL aggregation lives here, never in TypeScript and never in the
-- browser: the numbers are computed by the one thing that can see every row.
--
-- SECURITY, AND IT IS NOT OPTIONAL: in this project `anon` and `authenticated`
-- hold full table grants, and it is RLS-with-no-policies — not the grants —
-- that actually stops them reading anything. A view created the default way
-- (security_definer semantics) runs as its OWNER, `postgres`, which would
-- bypass that RLS and hand `anon` the very rows the tables refuse it. So every
-- view below is created `with (security_invoker = true)` — it runs as whoever
-- is querying, and hits the same RLS wall the tables do — AND has its grants
-- revoked from anon/authenticated as a second, independent lock. Either one
-- alone would do the job; both are here because the cost of the analytics
-- surface being the hole in an otherwise closed database is not worth saving a
-- line.
--
-- Dropped and recreated rather than `create or replace`, because replace
-- refuses any change to the column list — this file has to stay re-runnable
-- even after a view's shape changes.
--
-- THE BUYER LITERAL: 'high-potential customer' below MUST stay in sync with
-- `CATEGORY_BUYER` in lib/types.ts. It is the deterministic label discovery
-- stamps on a buyer-signal result; if that constant is ever renamed, these
-- views silently start reporting 0 buyers, because a category that matches
-- nothing is not an error in SQL. Change both together or not at all.
-- ---------------------------------------------------------------------------

-- Exactly one row, always, even on a completely empty database. Every figure is
-- coalesced to 0 so the dashboard can render "0" honestly instead of having to
-- decide what a NULL or a missing row means — a blank tile is the one thing
-- worse than a zero, because it reads as "broken" rather than "nothing yet".
drop view if exists public.analytics_totals;
create view public.analytics_totals with (security_invoker = true) as
select
  -- Searches RUN, not topics known: a topic searched five times is five searches.
  coalesce((select sum(use_count) from public.search_topics), 0)::bigint        as searches_run,
  coalesce((select sum(hits) from public.discovery_counts), 0)::bigint          as results_found,
  coalesce((select sum(hits) from public.discovery_counts
             where category = 'high-potential customer'), 0)::bigint            as buyer_results,
  (select count(*) from public.saved_posts)::bigint                             as posts_saved,
  (select count(*) from public.composed_posts)::bigint                          as drafts_composed;

revoke all on public.analytics_totals from anon, authenticated;

-- The category breakdown. Categories are open-ended by design — discovery
-- stamps one of two deterministic labels, but /api/analyze-post can overwrite
-- one with whatever the model called it — so this groups by whatever is
-- actually stored rather than by a fixed list that would quietly drop the rest.
drop view if exists public.analytics_by_category;
create view public.analytics_by_category with (security_invoker = true) as
select
  category,
  coalesce(sum(hits), 0)::bigint as results
from public.discovery_counts
group by category
order by results desc, category;

revoke all on public.analytics_by_category from anon, authenticated;

-- The platform breakdown. FULL OUTER JOIN, not a left join either way: a
-- platform can have saved posts and no discovery counts (anything with a URL
-- can be bookmarked, including the two platforms discovery never reaches), and
-- it can have discovery counts and no saves (found plenty, kept none). An inner
-- or one-sided join would silently drop one of those two real cases, which is
-- the same as reporting a number that is wrong.
drop view if exists public.analytics_by_platform;
create view public.analytics_by_platform with (security_invoker = true) as
with discovered as (
  select
    platform,
    sum(hits)                                                          as results,
    sum(hits) filter (where category = 'high-potential customer')      as buyer_results
  from public.discovery_counts
  group by platform
),
bookmarked as (
  select platform, count(*) as saved
  from public.saved_posts
  group by platform
)
select
  -- coalesce, because on a full outer join exactly one side is NULL per
  -- unmatched row and the platform name lives on whichever side matched.
  coalesce(d.platform, b.platform)    as platform,
  coalesce(d.results, 0)::bigint      as results,
  coalesce(d.buyer_results, 0)::bigint as buyer_results,
  coalesce(b.saved, 0)::bigint        as saved
from discovered d
full outer join bookmarked b on b.platform = d.platform
order by results desc, platform;

revoke all on public.analytics_by_platform from anon, authenticated;

-- The per-topic leaderboard, cumulative. LEFT JOIN from search_topics, never
-- an inner one: a topic that was searched and returned nothing is a real and
-- interesting answer ("this topic brings no buyers"), and an inner join would
-- delete it from the list entirely — which reads as though it was never
-- searched. It shows 0, and the coalesces are what make it 0 rather than NULL.
drop view if exists public.analytics_by_topic;
create view public.analytics_by_topic with (security_invoker = true) as
select
  t.topic,
  coalesce(sum(c.hits) filter (where c.category = 'high-potential customer'), 0)::bigint as buyer_hits,
  coalesce(sum(c.hits), 0)::bigint                                                       as total_hits,
  t.use_count,
  t.last_used_at
from public.search_topics t
left join public.discovery_counts c on c.topic = t.topic
group by t.topic, t.use_count, t.last_used_at
-- Buyers first, because that is the question the leaderboard answers. Ties
-- break on recency so the tail (every topic on 0) is still in a useful order.
order by buyer_hits desc, t.last_used_at desc;

revoke all on public.analytics_by_topic from anon, authenticated;
