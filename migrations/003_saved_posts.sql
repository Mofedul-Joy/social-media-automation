-- 003_saved_posts
--
-- The manually saved-post list: a post a human decided was worth keeping,
-- kept as a LINK and nothing more. Deliberately no `body`, no `external_id`
-- and no relevance/intent scores — a saved row is a bookmark, not a copy of
-- the post. The post itself is re-read by opening the url, so nothing here
-- can go stale or drift out of sync with the platform, and re-saving the
-- same post is a no-op rather than a second snapshot.
--
-- HOW TO RUN: paste into the Supabase SQL editor for this project and execute.
-- It is idempotent, so running it twice is safe.
--
-- `url` carries the unique constraint, and that is what makes the upsert in
-- lib/savedPosts.ts (`onConflict: "url"`) collapse a repeat save onto the one
-- row instead of raising a duplicate-key error the UI would have to interpret.
-- `saved_at` is never part of that upsert payload, so a repeat save leaves the
-- original timestamp alone: the first save is the truth.

create table if not exists public.saved_posts (
  id       uuid        primary key default gen_random_uuid(),
  platform text        not null,
  url      text        not null unique,
  title    text,
  author   text,
  saved_at timestamptz not null default now()
);

-- The list is only ever read newest-first, so this is the one index it needs.
create index if not exists saved_posts_saved_at_idx
  on public.saved_posts (saved_at desc);

-- Reached exclusively by the service-role key from route handlers
-- (lib/supabaseClient.ts is server-side only and is never imported into a
-- client component), never from a browser. So RLS is on with no policies:
-- anon and authenticated get nothing at all, service role bypasses it.
alter table public.saved_posts enable row level security;
