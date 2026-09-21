-- 001_search_topics
--
-- Remembers every topic that has actually been searched, so a past search is
-- one click away instead of being retyped. One row per distinct topic, newest
-- use first, no cap on how many are kept (decided in
-- .scratch/hon-sma-v2/issues/08-saved-topic-list.md).
--
-- HOW TO RUN: paste into the Supabase SQL editor for this project and execute.
-- It is idempotent, so running it twice is safe.
--
-- `topic` is the primary key, and that is what makes the upsert in
-- lib/topics.ts (`onConflict: "topic"`) collapse a repeat search onto the one
-- row and bump its counter, instead of growing an append-only history the list
-- would then have to de-duplicate on every read.

create table if not exists public.search_topics (
  topic        text        primary key,
  last_used_at timestamptz not null default now(),
  use_count    integer     not null default 1
);

-- The list is only ever read newest-first, so this is the one index it needs.
create index if not exists search_topics_last_used_at_idx
  on public.search_topics (last_used_at desc);

-- Reached exclusively by the service-role key from route handlers
-- (lib/supabaseClient.ts is server-side only and is never imported into a
-- client component), never from a browser. So RLS is on with no policies:
-- anon and authenticated get nothing at all, service role bypasses it.
alter table public.search_topics enable row level security;
