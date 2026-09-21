-- 002_compose.sql — compose + per-target cross-post checklist.
--
-- NOTHING IN HERE POSTS ANYWHERE. These tables record what Hon drafted and
-- which targets he has ticked off after pasting the draft himself. There is no
-- platform write anywhere in this feature and no read-back from any platform:
-- `done` is a human's checkbox, not a confirmation that a post is live.
--
-- Run as the project owner in the Supabase SQL editor. Every table is reached
-- only through the service-role key from server code, so RLS is enabled with no
-- policies: the service role bypasses RLS, anon/authenticated get nothing.

-- The target library Hon manages himself. Deliberately NOT pre-filled with
-- Facebook groups: no group URL may ever be invented, so Facebook starts empty
-- and Hon adds his own groups in the UI. The two Reddit seeds are the
-- subreddits already configured in config/business_context.snapshot.json.
create table if not exists crosspost_saved_targets (
  id          bigserial primary key,
  platform    text        not null,
  name        text        not null,
  url         text        not null,
  created_at  timestamptz not null default now(),
  unique (platform, url),
  -- The name is an identity, not a label: the UI and crosspost_targets both key
  -- a target by (platform, name). Two places sharing a name on one platform
  -- would collapse into one row and silently lose the other one's tracking.
  unique (platform, name)
);

-- One drafted post. Hon writes once; every target formats from this body.
create table if not exists composed_posts (
  id          bigserial primary key,
  body        text        not null default '',
  created_at  timestamptz not null default now()
);

-- One row per target this draft is going out to, holding the
-- platform-formatted version and the human's done checkbox.
create table if not exists crosspost_targets (
  id                bigserial   primary key,
  composed_post_id  bigint      not null references composed_posts (id) on delete cascade,
  platform          text        not null,
  target            text        not null,
  -- The link Hon opens to paste into. Never fetched, never written to.
  target_url        text        not null default '',
  formatted_body    text        not null default '',
  done              boolean     not null default false,
  done_at           timestamptz,
  unique (composed_post_id, platform, target)
);

create index if not exists crosspost_targets_post_idx
  on crosspost_targets (composed_post_id);

alter table crosspost_saved_targets enable row level security;
alter table composed_posts          enable row level security;
alter table crosspost_targets       enable row level security;

-- Seeds. Real subreddits, taken from the existing business context. Re-runnable.
insert into crosspost_saved_targets (platform, name, url) values
  ('reddit', 'r/smallbusiness', 'https://www.reddit.com/r/smallbusiness/'),
  ('reddit', 'r/marketing',     'https://www.reddit.com/r/marketing/')
on conflict (platform, url) do nothing;
