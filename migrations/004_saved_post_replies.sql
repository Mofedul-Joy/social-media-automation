-- 004_saved_post_replies
--
-- Reply notifications. A saved post (003_saved_posts.sql) is "a thread Hon
-- engaged with"; this table is the memory of which replies on that thread have
-- already been seen, so the next poll can tell a NEW reply from one that was
-- already there. There is no separate "engaged with" list and no read-back of
-- Hon's own account — everything here comes from the same public per-source
-- reply endpoints discovery already uses (lib/sources/*.ts `fetchReplies`).
--
-- HOW TO RUN: paste into the Supabase SQL editor for this project and execute.
-- It is idempotent, so running it twice is safe.
--
-- `(saved_post_id, reply_id)` carries the unique constraint, and that is what
-- makes the insert in lib/replies.ts (`onConflict: "saved_post_id,reply_id"`,
-- `ignoreDuplicates: true`) collapse an already-stored reply onto the existing
-- row instead of raising a duplicate-key error or appending the whole comment
-- tree again on every poll. `reply_id` is the source's own comment id, scoped
-- per post rather than globally, because two sources can hand back the same
-- numeric id for different comments.
--
-- `snippet` is a short excerpt, not the comment. This table is a notification
-- feed: it has to say enough to decide whether to click, and the comment
-- itself is re-read by opening `url`, so nothing stored here can drift out of
-- sync with the platform.
--
-- `posted_at` is nullable on purpose. Facebook's comments endpoint exposes no
-- per-comment timestamp (see lib/sources/socialapis.ts), and inheriting the
-- parent post's date would misreport when the reply actually arrived. The feed
-- therefore orders by `first_seen_at` — when WE first saw it — which every row
-- has.

create table if not exists public.saved_post_replies (
  id            uuid        primary key default gen_random_uuid(),
  saved_post_id uuid        not null references public.saved_posts (id) on delete cascade,
  reply_id      text        not null,
  author        text,
  snippet       text        not null,
  url           text        not null,
  posted_at     timestamptz,
  first_seen_at timestamptz not null default now(),
  seen_by_user  boolean     not null default false,
  unique (saved_post_id, reply_id)
);

-- The feed is read unseen-first, newest-first, and the bell count is a
-- `where seen_by_user = false` count. This one index serves both.
create index if not exists saved_post_replies_unseen_idx
  on public.saved_post_replies (seen_by_user, first_seen_at desc);

-- Deleting a saved post cascades through this; the FK needs its own index or
-- that delete degenerates into a sequential scan of the whole reply table.
create index if not exists saved_post_replies_saved_post_id_idx
  on public.saved_post_replies (saved_post_id);

-- Reached exclusively by the service-role key from route handlers
-- (lib/supabaseClient.ts is server-side only and is never imported into a
-- client component), never from a browser. So RLS is on with no policies:
-- anon and authenticated get nothing at all, service role bypasses it.
alter table public.saved_post_replies enable row level security;

-- When each saved post was last polled — successfully OR not. Two jobs:
--
--   1. Cooldown. Polling runs on page open, so this stops a reload loop from
--      re-hitting every source. It is stamped on a FAILED poll too, and that
--      is deliberate: a Facebook post whose vendor call times out would
--      otherwise be retried on every single page open forever, and an
--      abandoned in-flight SocialAPIs call still charges its credit. Measured
--      live on 2026-09-22 — the vendor's comments endpoint was aborting at its
--      5s cap, and without this the same post was re-called on every reload.
--   2. Rotation. Facebook is capped per run; polling oldest-polled-first means
--      the cap walks through the whole saved list instead of pinning the same
--      few posts forever.
alter table public.saved_posts
  add column if not exists last_polled_at timestamptz;

create index if not exists saved_posts_last_polled_at_idx
  on public.saved_posts (last_polled_at asc nulls first);

-- When the post's comment tree was first stored. This is what decides
-- baselining, and it is a SEPARATE column from `last_polled_at` precisely
-- because that one now moves on failure.
--
-- On the first SUCCESSFUL poll of a post the whole existing comment tree is
-- stored already-seen. Without that, saving one busy Reddit thread would put a
-- 155-unread badge on the bell for comments that were there before Hon ever
-- saved it — a reply is only news if it appeared after we started watching.
-- Left null by a failed poll and by a poll whose insert failed, so the
-- baseline still happens on the first poll that actually stores something
-- rather than being silently consumed by an outage.
alter table public.saved_posts
  add column if not exists baselined_at timestamptz;

-- Backfill, for a database where an earlier revision of this file already ran
-- and baselined some posts off `last_polled_at` alone. A post that has stored
-- replies and a poll timestamp was baselined then; say so, or the next poll
-- would baseline it a second time and swallow every genuinely new reply as
-- already-seen. A no-op on a fresh database and on a re-run.
update public.saved_posts sp
   set baselined_at = sp.last_polled_at
 where sp.baselined_at is null
   and sp.last_polled_at is not null
   and exists (select 1 from public.saved_post_replies r where r.saved_post_id = sp.id);
