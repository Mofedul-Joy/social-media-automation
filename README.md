# Social Media Engagement Automation

Semi-automated engagement across **Reddit, Facebook Groups, and Threads** for
discovery, and **Reddit, Facebook, and Instagram** for commenting. You define a
business context; the system searches public posts **off-account through vendor
APIs**, scores each one on two axes (topic relevance AND buyer intent), and shows
the survivors in a dashboard for approval. Approved comments are posted from the
client's own accounts through a logged-in browser. Every action is logged to
Google Sheets.

Client: **Hon Kwok** - built by Mofedul Joy.

## Architecture

Two lanes, deliberately separate. This split is the central design decision.

```
                      DISCOVERY LANE (read, off-account)
business context -> intent query matrix -> EnsembleData  (Reddit, Threads)
   (topics)           (lib/intent.ts)      SocialAPIs    (Facebook Groups)
                                                   |
                                    Claude: relevance + INTENT + draft
                                                   |
                                             SQLite queue
                                                   |
                                     Next.js dashboard (approval gate)
                                                   |
                      ENGAGEMENT LANE (write, on-account)
                     logged-in Chrome + residential proxy -> comment
                                                   |
                                          Google Sheets log
```

**Why the lanes are separate.** A previous build read posts from the client's own
logged-in account and got the account banned. Discovery now runs entirely on
third-party read APIs over public data, so a block costs a vendor credit instead
of the asset the whole system depends on. Nothing in the discovery lane ever
touches the client's session.

**Why there is no Meta write API.** Graph API only writes to Pages and media you
own, `/search?type=post` was removed in v2.0, and the Content Library is academic
access only. Commenting on a stranger's post requires a logged-in browser. That is
why the engagement lane exists and why it stays low volume and human paced.

**Why queries are intent phrases, not topic nouns.** Searching "home gym" returns
businesses selling home gyms, because that is who publishes about home gyms.
Relevance is not intent. `lib/intent.ts` wraps each client topic in buyer phrasing
("looking for someone to build {topic}") before it reaches an API, which flips the
result set from sellers to people asking. The classifier then scores both axes
separately and rejects anything it reads as a seller, however on-topic it is.

**Why Instagram is discovery-disabled.** Hashtag and account search return sellers
by construction. It stays in the engagement lane only.

### Discovery sources

| Lane | Vendor | Endpoint | Measured yield |
|---|---|---|---|
| Reddit | EnsembleData | `/reddit/keyword/search` | 25 posts / 2 units, cheapest by ~12x |
| Threads | EnsembleData | `/threads/keyword/search` | ~1 unit / post |
| Facebook groups | SocialAPIs | `/facebook/groups/posts` | 3 posts / credit, real timestamps + top comments |
| Facebook group discovery | SocialAPIs | `/facebook/search/posts` | ~1.4 posts / credit, flaky, no timestamps |

`search/posts` is for finding **which groups** the buyers are in, run once via
`npm run fb-groups`. Those group URLs are then polled directly. Search finds
groups, groups find posts.

- **Layer 1 – directive:** `./directives/build_social_engagement_system.md`
- **Layer 2 – orchestration:** the dashboard (`app/`) + posting worker (`agents/worker.ts`)
- **Layer 3 – execution:** deterministic modules in `lib/` + posting agents in `agents/`

## Setup

```bash
cd Hon-SMA
npm install
npx playwright install chrome        # real Chrome, engagement lane only
cp .env.template .env                 # ANTHROPIC_API_KEY, ENSEMBLEDATA_TOKEN,
                                      # SOCIALAPIS_TOKEN, DASHBOARD_PASSWORD
cp config/business_context.example.json config/business_context.json   # then edit
```

Fill `config/business_context.json` with the client's product, audience, keywords,
tone, and which platforms/subreddits/hashtags to monitor. This is the AI's core brief.

### One-time account login (required before POSTING works)
```bash
npm run login   # opens Chrome; sign in to Reddit/Facebook/Instagram once
```
Sessions persist in `CHROME_USER_DATA_DIR` and are used by the engagement lane only.
Discovery never touches them. Create the accounts manually through the same proxy the
VPS will operate from, so the signup IP matches the operating IP.

## Daily workflow

0. **Check the queries** - `npm run queries` prints the intent matrix a pass would
   run. Costs nothing, calls no API. Do this after any change to `topics`.
1. **Discover** - `npm run discover` (scheduled via cron on the VPS). Runs the intent
   queries against the vendor APIs off-account, scores each post on relevance AND
   intent, and queues only what clears both. Add a platform name to limit the pass:
   `npm run discover -- reddit`.
2. **Review** — open the dashboard (`npm run start`, behind auth), read each AI-drafted
   comment, edit if needed, then **Approve** or **Skip**.
3. **Post** - `npm run post` (also cron). Opens Chrome and posts only the approved
   comments, respecting per-platform daily caps and human-like pacing.

### Occasional
- `npm run fb-groups` - find which Facebook Groups the buyers are in, then paste the
  URLs into `platforms.facebook.groups`. Run once per client, not per pass.
- `npm run measure -- reddit 4` - run the intent lane against the noun baseline and
  report buyer hit rate and units per buyer for each. Writes nothing to the queue.
  This is the evidence run.

## Deployment (single VPS)

The dashboard, `discover`, and `post` worker share **one SQLite database**, so they
run on the **same VPS**. This is the deployable target:

1. Provision a VPS with a static residential proxy (`PROXY_URL`) and set `HEADLESS=true`.
2. Set `DASHBOARD_PASSWORD` and a strong secret; set `DATABASE_PATH` to an absolute
   path (so cron jobs and the server hit the same file).
3. Run the dashboard as a service: `npm run build && npm run start` behind a reverse
   proxy with TLS (nginx/Caddy). Auth is enforced by Basic Auth middleware.
4. Schedule `npm run discover` and `npm run post` via cron (they read/write the same DB).

**Why not Vercel (yet):** the sold proposal named Vercel, but a serverless host has an
ephemeral filesystem and can't share the local SQLite file with the VPS worker. To host
the dashboard on Vercel, swap the store to a networked DB the worker also connects to
(libSQL/Turso or Postgres). That swap is isolated to `lib/store.ts` and is tracked as a
Phase 3 option — the single-VPS setup above is the working default.

## Known local gotcha: `#` in the folder path

This repo currently lives under a parent folder named `Workspace - Antigravity #1`.
The `#` breaks Next.js's RSC bundler and `next build` (module ids get truncated at
the `#`). The **CLI tools work fine** (`discover`, `post`, `login` use tsx, not the
Next bundler), but the **dashboard won't `dev`/`build` here**. Fix: copy/clone this
folder to a path without `#` and run the dashboard there (the VPS deploy path is clean).

Verified: on a clean path `next build` is green (all routes + home prerender) and the
UI renders. This is purely a folder-name issue, not a code issue.

## Status

**Done**
- Dashboard, SQLite queue, approval gate, Google Sheets log.
- Discovery lane rebuilt off-account on vendor APIs: Reddit and Threads via
  EnsembleData, Facebook Groups via SocialAPIs. No client account is ever read from.
- Intent query generator (`lib/intent.ts`) and the two-axis classifier. Verified
  end to end: an on-topic seller post scores 1.0 relevance and is rejected, while
  a buyer post scores 0.95 intent and reaches the queue.
- Per-run vendor unit accounting, so cost per client is measured, not estimated.

**Next**
- Run `npm run measure` with live tokens to produce the intent-vs-noun evidence.
- Run `npm run fb-groups` to seed `platforms.facebook.groups`, then enable Facebook.

**Blocked on others**
- AdsPower Professional plan + Local API key, then swap `agents/browser.ts` from
  `launchPersistentContext` to `connectOverCDP`.
- Google service-account JSON for the Sheets log.
- The proxy on file is a datacenter IP (AS10753 Lumen) and is refused at Facebook
  signup. It needs replacing with a residential or mobile-ISP proxy before any
  account is created.

## Env vars

See `.env.template`. Key ones:

| Var | Lane | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | both | Claude, for the two-axis classifier and drafts |
| `ENSEMBLEDATA_TOKEN` | discovery | Reddit + Threads search. HTTP 495 means the daily unit quota is spent, resets 00:00 UTC |
| `SOCIALAPIS_TOKEN` | discovery | Facebook group posts + post search |
| `MAX_POST_AGE_DAYS` | discovery | Drop posts older than this (default 14) |
| `MAX_ANALYZE_PER_RUN` | discovery | Ceiling on classifier calls per pass (default 120) |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | dashboard | Basic Auth on every page and route |
| `DATABASE_PATH` | all | Absolute path; the dashboard, discover and post worker must share one file |
| `ACTIVITY_LOG_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` | log | Google Sheets activity log |
| `CHROME_USER_DATA_DIR` | engagement | Persistent logged-in Chrome profile |
| `PROXY_URL`, `PROXY_USERNAME`, `PROXY_PASSWORD` | engagement | Residential or mobile-ISP proxy. A datacenter IP is refused at Facebook signup |
| `MAX_*_POSTS_PER_DAY`, `ACTION_DELAY_*` | engagement | Volume caps and human pacing |

No published number exists for a safe comments-per-day rate on any of these
platforms. The caps are deliberately conservative; keep the volume low.
