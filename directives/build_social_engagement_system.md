# Directive: Build Social Media Engagement Automation System

**Client:** Hon Kwok
**Contract:** $850, paid upfront. Sold proposal source: `.tmp/proposal_data_hon_social.json`, `.tmp/Social_Media_Engagement_Automation_Proposal.docx` (Drive ID `15vDbCQsKk7kqWRC2Fpi5GK3PdXpt2SLt`).
**Repo:** `Hon-SMA/`

## Goal

A semi-automated social engagement pipeline across Reddit, Facebook, Instagram. Define a business context, the system reads recent relevant posts THROUGH A LOGGED-IN CHROME BROWSER (no scraping service, no platform APIs, no discovery API keys), Claude scores relevance and drafts comments, a Next.js dashboard presents them for human approval, and approved comments are posted from the client's own accounts via the same browser. Every run is logged to Google Sheets. Runs 24/7 on a VPS with a Canadian static residential proxy IP. No platform APIs.

## Architecture (3 layers)

```
Topic / business context
      |
  Logged-in Chrome (Playwright, residential IP)   [SAME browser used for posting]
    reads Reddit (authenticated .json) / Facebook + Instagram (rendered DOM)
      |
  Claude API (relevance score + category tag + comment draft)   [only paid API]
      |
  SQLite queue  (pending -> approved/skipped -> posted)   [shared file on the VPS]
      |
  Next.js dashboard on the VPS, Basic-Auth gated  (human approval gate)
      |
  Playwright + persistent Chrome profile on VPS  (posts approved comments)
      |
  Google Sheets  (activity log)
```

DECISION (2026-07-02, client): dropped Firecrawl / all scraping services. Discovery
reads through the logged-in Chrome — free, real-time, and consistent with the posting
identity (same session + IP). Reddit's unauthenticated public JSON now 403s from plain
servers, confirming the logged-in-browser path is required for all three platforms.
Discovery therefore runs as a CLI/cron job (`npm run discover`), NOT inside the Next
web server (playwright can't/shouldn't run in a route). The `/api/discover` route was
removed; the dashboard is a pure approval gate.

- **Layer 1 (this directive):** what to do.
- **Layer 2 (orchestrator/dashboard + worker):** decides ordering, handles errors.
- **Layer 3 (execution):** `lib/*` deterministic modules + `agents/*` posting scripts.

### Chrome DevTools MCP vs Playwright note
The proposal names "Chrome DevTools MCP" as the posting layer. MCP is how *the agent* drives a browser interactively. For an unattended VPS worker the deterministic equivalent is Playwright driving a real Chrome with a persistent user-data-dir holding the logged-in sessions. Same behavior (real browser, no API, human-like pacing), runnable headless/unattended. Sessions are established once by logging in through the persistent profile.

## Phases

- **Phase 1 (wk 1-2):** Dashboard + discovery pipeline (Firecrawl + Claude) + SQLite store + Reddit posting agent. STATUS: in progress.
- **Phase 2 (wk 2-3):** Facebook + Instagram posting agents.
- **Phase 3 (wk 3-4):** Multi-platform orchestrator + Google Sheets logging + prompt/relevance tuning + handover.

## Inputs required from client (blockers for go-live)
- Business context brief (product, audience, keywords, comment tone) -> `config/business_context.json`. Initial topic config created 2026-07-02 around AI coding tools, AI product builds, AI app builders, AI agents, workflow automation, AI services, and productionizing AI-generated/vibe-coded apps.
- Reddit / Facebook / Instagram accounts in Hon's name (created MANUALLY — see account-creation note), logged into the persistent Chrome profile
- Anthropic API key (the only paid API — discovery is browser-based, no scraper key). A Claude web/desktop subscription can be used by the human/operator for development, but the runtime scoring/drafting path uses the Anthropic SDK and therefore needs an API key unless the code is intentionally changed to a different provider.
- Google service-account / OAuth for the activity-log Sheet
- Canadian static residential proxy IP (used for BOTH account creation and the VPS)
- Dashboard password (`DASHBOARD_PASSWORD`)

## Account creation (2026-07-02)
Create the three accounts MANUALLY, by hand — never automate signup (automated account
creation is the fastest way to an instant ban and is against ToS). Guidance:
- Use Hon's real Gmail (an aged, real inbox helps trust) and his real name.
- Create them from a CANADIAN residential IP (Hon is in Canada) that MATCHES where the
  automation will later run. Prefer a static Canadian residential proxy over a generic
  datacenter/shared VPN — datacenter/VPN IPs are themselves a flag. Ideal: buy the
  residential proxy first, then create the accounts through it, then run the VPS through
  the same proxy so signup IP == operating IP.
- A phone number for SMS verification (FB & IG almost always require it). Use a real
  Canadian number Hon controls; virtual/VOIP numbers are often rejected/flagged.
- Fill each profile out (photo, bio, a few organic posts) and WARM UP for 1-2 weeks
  (especially Instagram) before any automation touches them.
- Geolocation/GPS: for the web + automation path, the IP is what matters, not GPS. No
  special GPS access needed; browser geolocation can be set to match the IP region if a
  platform ever asks.

## Run commands
- `npm install`
- `npm run dev` — dashboard at http://localhost:3000
- `npm run discover` — run a discovery pass (scrape + score + draft, fills the queue)
- `npm run post` — posting worker: drains the approved queue via browser automation

## Learnings / edge cases
- **Workspace path contains `#` (`Workspace - Antigravity #1`).** This breaks Next.js's
  RSC module manifest and `next build` file tracing (module ids get truncated at the `#`,
  e.g. `global-error.js#`). Symptoms: home page HTTP 500 "Could not find the module ... in
  the React Client Manifest"; build fails in `next-trace-entrypoints-plugin` with a null-byte
  path error. The tsx CLIs (`discover`, `worker`, `login`) are unaffected. Fix: run/build the
  dashboard from a path without `#` (verified: builds and renders cleanly on a clean path) —
  e.g. hardlink-clone to a hash-free dir via `cp -al`, or clone the repo onto the VPS (whose
  deploy path is clean). Not a code bug. NOTE: the VPS, not Vercel, is the deployment target
  (see DEPLOYMENT below) — a clean path is about building, not about hosting on Vercel.
- Phase 1 verified 2026-07-01: `tsc --noEmit` clean; `next build` green on clean path (4 routes
  + home prerender); prod server renders the Engagement Console UI; `/api/posts`, `/api/config`,
  `/api/decision` all correct; SQLite store auto-creates; `discover` CLI wires scrape→AI→store
  and fails gracefully on missing keys.
- SECURITY: the dashboard + every API route are gated by HTTP Basic Auth (`middleware.ts`,
  `DASHBOARD_USER`/`DASHBOARD_PASSWORD`). Fails CLOSED (503) if no password is set — an
  unauthenticated console could approve comments (posts to real accounts) or run discovery
  (spends credits). Serve behind TLS (reverse proxy) in production.
- DEPLOYMENT: dashboard + `discover` + `post` worker share ONE SQLite file, so they run on the
  SAME VPS (not Vercel — serverless has an ephemeral FS and can't share the DB with the worker).
  The proposal named Vercel; hosting there requires swapping `lib/store.ts` to a networked DB
  (libSQL/Turso or Postgres) the worker also connects to. Tracked as a Phase 3 option. Set
  `DATABASE_PATH` (absolute) so the server and cron jobs agree on the file.
- Live discovery/posting spend paid credits (Claude only) and touch real accounts —
  per CLAUDE.md, confirm with user before running against real keys/accounts.
- (append as discovered: Firecrawl rate limits, platform selectors that drift, IG warm-up cadence, etc.)
