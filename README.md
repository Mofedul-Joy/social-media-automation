# Social Media Engagement Automation

Type a topic, see the live posts on it, then draft a comment for the ones worth
replying to. The system searches public posts **off-account through vendor APIs and
public archives**, lists them immediately, and drafts a comment **one post at a
time, only when you click Generate comment**. That draft scores the post on two
axes (topic relevance AND buyer intent) and returns a ready-to-paste comment.
**There is no auto-poster**, a human copies the comment and posts it from their own
logged-in browser.

Client: **Hon Kwok** - built by Mofedul Joy.

## Architecture (3-way split)

```
 browser ──Basic Auth──▶  Vercel  (Next.js UI)
                             │   /api/topic-search   step 1, sources only, no AI
                             │   /api/analyze-post   step 2, one post, one AI call
                             │   /api/config         the business brief
                             │   /api/topic-reply    legacy one-shot, nothing calls it
                             │
                             ├──▶ Supabase        business_context row (the AI brief)
                             │
                             ├──▶ Arctic Shift    Reddit archive        (free, public)
                             ├──▶ HN Algolia      Hacker News           (free, public)
                             ├──▶ StackExchange   Stack Overflow        (free, public)
                             ├──▶ SocialAPIs      Facebook group posts  (credits)
                             │
                             └──▶ VPS worker      POST /analyze  (bearer token, TLS)
                                      │
                                      └──▶ `claude` CLI  (Hon's subscription)
                                           relevance + intent + draft comment
```

**Why the VPS still exists.** `lib/ai.ts` shells out to the local `claude` CLI,
authenticated by `CLAUDE_CODE_OAUTH_TOKEN`, so classification bills against Hon's
flat Claude subscription instead of a metered API key. Serverless cannot run that
binary. `worker/server.ts` is the entire remaining VPS surface: one authenticated
`POST /analyze` plus an unauthenticated `GET /health`. Nothing else.

**Why fetching and drafting are two steps.** The original `/api/topic-reply` did
both in one request: it searched, then ran the classifier over every match. That
spent an AI call, and sometimes a SocialAPIs credit, on posts the user never looked
at. Now `/api/topic-search` lists the raw posts for free and `/api/analyze-post`
runs the classifier on exactly one post, on an explicit click. A search makes **at
most one SocialAPIs HTTP call** (one group, no retries) and zero AI calls. There is
no schedule and no background job behind either route: nothing runs unless a human
clicks. `/api/topic-reply` still exists, unchanged, but the UI no longer calls it.

**Why nothing is persisted but the config.** Lookups are on-demand and ephemeral.
The old batch-discovery job, candidates queue, approve/skip flow and Google Sheets
log are gone — the on-demand lookup is what the client actually uses.

**Why sources are off-account.** A previous build read posts from the client's own
logged-in account and got the account banned. A block on these sources costs a
vendor credit instead of the asset the whole system depends on.

**Why queries are intent phrases, not topic nouns.** Searching "home gym" returns
businesses selling home gyms, because that is who publishes about home gyms.
Relevance is not intent. `lib/intent.ts` wraps each client topic in buyer phrasing
("looking for someone to build {topic}"), which flips the result set from sellers
to people asking. The classifier then scores both axes separately and rejects
anything it reads as a seller, however on-topic it is.

### Sources

| Source | Vendor | Cost |
|---|---|---|
| Reddit | Arctic Shift (free public archive) | free, ~13s per subreddit, rate-limited by courtesy |
| Hacker News | Algolia HN search | free |
| Stack Overflow | Stack Exchange API | free |
| Facebook groups | SocialAPIs `/facebook/groups/posts` | ~1 credit / 3 posts |
| Facebook group discovery | SocialAPIs `/facebook/search/posts` | flaky, no timestamps — run once via `npm run fb-groups` |

`search/posts` is for finding **which groups** the buyers are in. Those group URLs
are then polled directly. Search finds groups, groups find posts.

## Layout

| Path | Runs on | What |
|---|---|---|
| `app/` | Vercel | UI + API routes |
| `lib/discoverPosts.ts` | Vercel | the shared source fan-out both lookup routes use |
| `middleware.ts` | Vercel Edge | Basic Auth on every page and route |
| `lib/config.ts`, `lib/supabaseClient.ts` | Vercel | business context in Supabase |
| `lib/sources/*` | Vercel | the off-account search adapters |
| `lib/analyzeClient.ts` | Vercel | HTTP client for the VPS worker |
| `worker/server.ts`, `lib/ai.ts` | VPS | the `claude` CLI wrapper |
| `deploy/` | VPS | Caddyfile + pm2 ecosystem file |
| `scripts/fb-groups.ts` | local | one-off Facebook group discovery |

## Supabase schema

Run once in the project's SQL editor:

```sql
create table public.business_context (
  id         int primary key default 1,
  context    jsonb not null,
  updated_at timestamptz not null default now(),
  constraint business_context_single_row check (id = 1)
);
```

RLS is off deliberately: nothing calls Supabase from the browser, only server-side
route handlers using the service role key. `config/business_context.example.json`
is the bundled fallback used until the first save.

## Setup

```bash
npm install
cp .env.template .env          # then fill it in
npm run dev
```

Fill the business context through the dashboard (it writes the Supabase row), or
`POST /api/config` with the client's product, audience, keywords, tone, and which
platforms/subreddits/groups to monitor. This is the AI's core brief.

### VPS worker

```bash
git pull && npm install
cp worker/.env.example worker/.env     # CLAUDE_CODE_OAUTH_TOKEN + WORKER_SHARED_SECRET
pm2 start deploy/ecosystem.worker.config.js && pm2 save
```

Put Caddy in front of it (`deploy/Caddyfile`) so the worker is reachable over TLS
on a subdomain; `AI_WORKER_URL` on Vercel points at that subdomain.

### Occasional

- `npm run fb-groups` — find which Facebook Groups the buyers are in, then paste the
  URLs into the business context under `platforms.facebook.groups`. Run once per
  client, not per lookup.

## Env vars

Two separate sets. See `.env.template` (Vercel) and `worker/.env.example` (VPS).

**Vercel**

| Var | What it is |
|---|---|
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | Basic Auth on every page and route |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key — server-side only, never shipped to the browser |
| `AI_WORKER_URL` | e.g. `https://worker.<hon-domain>`, no trailing slash |
| `AI_WORKER_SECRET` | bearer token; must equal the VPS's `WORKER_SHARED_SECRET` |
| `SOCIALAPIS_TOKEN` | Facebook group posts + post search |
| `MAX_POST_AGE_DAYS` | drop posts older than this (default 14) |

**VPS worker**

| Var | What it is |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | long-lived token from `claude setup-token`; bills the client's subscription |
| `CLAUDE_MODEL` | default `claude-sonnet-5` |
| `WORKER_SHARED_SECRET` | must equal Vercel's `AI_WORKER_SECRET` |
| `WORKER_PORT` | optional, default 8787 |

No published number exists for a safe comments-per-day rate on any of these
platforms. Keep the volume low and human-paced.
