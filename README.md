# Social Media Engagement Automation

Semi-automated engagement across **Reddit, Facebook, and Instagram**. You define a
business context; the system reads recent relevant posts **through a logged-in Chrome
browser** (no scraping service, no platform APIs, no API keys for discovery), uses
Claude to score relevance and draft comments, and shows them in a dashboard for
approval. Approved comments are posted from the client's own accounts through the same
browser. Every action is logged to Google Sheets.

Client: **Hon Kwok** · Built by Mofedul Joy.

## Architecture

```
business context ─▶ logged-in Chrome (Playwright) reads Reddit/FB/IG ─▶ Claude (relevance + draft)
                       (same browser used for posting; residential IP)          │
                                                                            SQLite queue
                                                                                │
                            Google Sheets ◀── logged-in Chrome (post) ◀── Next.js dashboard
                              (activity log)     approved comments          (approval gate)
```

**Discovery uses no third-party scraper and no API keys.** The same real, logged-in
Chrome that posts comments also reads each platform's native search/feed:
- **Reddit** — authenticated `.json` endpoints via the logged-in session (public JSON
  now 403s from plain servers, so we read it inside the browser session).
- **Facebook / Instagram** — rendered post text from in-app search/hashtag pages (DOM).

- **Layer 1 – directive:** `./directives/build_social_engagement_system.md`
- **Layer 2 – orchestration:** the dashboard (`app/`) + posting worker (`agents/worker.ts`)
- **Layer 3 – execution:** deterministic modules in `lib/` + posting agents in `agents/`

## Setup

```bash
cd Hon-SMA
npm install
npx playwright install chrome        # real Chrome — used for BOTH discovery and posting
cp .env.template .env                 # set ANTHROPIC_API_KEY, DASHBOARD_PASSWORD, etc.
cp config/business_context.example.json config/business_context.json   # then edit
```

Fill `config/business_context.json` with the client's product, audience, keywords,
tone, and which platforms/subreddits/hashtags to monitor. This is the AI's core brief.

### One-time account login (required before discovery works)
```bash
npm run login   # opens Chrome; sign in to Reddit/Facebook/Instagram once
```
Sessions persist in `CHROME_USER_DATA_DIR`. Discovery and posting both rely on these
logged-in sessions — discovery reads each platform as the logged-in user.

## Daily workflow

1. **Discover** — `npm run discover` (scheduled via cron on the VPS). Opens the
   logged-in Chrome, reads recent posts on each enabled platform, scores them with
   Claude, and queues the relevant ones. *(Not triggered from the web dashboard — it
   drives a real browser, so it runs as a CLI/cron job, not inside the Next server.)*
2. **Review** — open the dashboard (`npm run start`, behind auth), read each AI-drafted
   comment, edit if needed, then **Approve** or **Skip**.
3. **Post** — `npm run post` (also cron). Opens Chrome and posts only the approved
   comments, respecting per-platform daily caps and human-like pacing.

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

- **Phase 1 (done):** dashboard, discovery pipeline, SQLite queue, Reddit agent.
- **Phase 2:** Facebook + Instagram agents (implemented; selectors need live tuning).
- **Phase 3:** multi-platform orchestrator, Google Sheets polish, prompt tuning, handover.

## Env vars

See `.env.template`. Key ones: `ANTHROPIC_API_KEY` (the only paid API — discovery uses
no scraping service), `DASHBOARD_USER`/`DASHBOARD_PASSWORD`, `DATABASE_PATH`,
`ACTIVITY_LOG_SHEET_ID` + `GOOGLE_SERVICE_ACCOUNT_JSON`, `CHROME_USER_DATA_DIR`,
`PROXY_URL` (Canadian static residential proxy), and the per-platform daily caps.
