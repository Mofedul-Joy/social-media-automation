# Architecture - Social Engagement Automation (Hon Kwok)

> **Version 3, 2026-08-31 supersedes section 2a below.** Discovery no longer runs
> through the client's logged-in browser. It runs off-account on third-party read
> APIs, and queries are generated intent phrases rather than topic nouns. The
> current design is documented in README.md ("Two lanes"). Sections 2a and the
> per-platform scraping notes are kept for the decision history only.
>
> What changed and why:
> - Reading from the client's own session is what got a previous build's account
>   banned. A block on the discovery lane must cost a vendor credit, not the account.
> - Reddit is blocked to direct requests from the VPS, so it goes through EnsembleData.
> - There is no Meta post-search or comment-write API. Facebook discovery is
>   SocialAPIs; Facebook commenting stays in the logged-in browser.
> - Instagram was dropped from discovery: its search surfaces sellers, not buyers.
> - Topic nouns return the businesses selling the thing. Intent phrases return the
>   people asking. See lib/intent.ts.

Version 2, 2026-07-02. Supersedes the Firecrawl/Vercel/API-key assumptions in the
original proposal. This is the plan we build and deploy against.

## 1. What the system does (in one paragraph)

Hon (or Mofedul) types a **topic/interest** into a form on a private web app — e.g.
"AI agents for small business", "AI automation for e-commerce". A background AI agent
opens Hon's **real, logged-in** Reddit / Facebook / Instagram in a browser and finds
**recent** posts on that topic. Each post is scored for relevance and a natural,
human-sounding comment is drafted. The posts + drafts appear in the web app as a
review list. Hon clicks **Approve** (or edits, or skips). Approved comments are posted
by the same logged-in browser, from Hon's own accounts, with human-like pacing. Every
action is logged to a Google Sheet. It runs 24/7 on a VPS behind a Canadian residential
IP so it behaves like Hon using his own laptop from home.

## 2. The core decisions (and why)

### 2a. Scraping: logged-in real browser — NOT Perplexity, NOT any scraping API
We use the **same logged-in Chrome (Playwright) for both discovery and posting**.
Reasons:
- We must post *from Hon's accounts* anyway, so the logged-in browser already exists.
  Using it for discovery too means discovery sees exactly what Hon sees (real-time,
  including content behind login) with zero extra cost and one consistent identity/IP.
- **Perplexity is not suitable here** (researched 2026-07-02): its "Social" focus only
  searches **Reddit**, it does **not** read live Instagram/Facebook, users report it
  "won't search live data and hallucinates like crazy" for social analysis, and it
  **cannot post/engage**. It could at best be a weak supplemental Reddit signal — not
  worth the added dependency. Decision: **skip Perplexity.**
- **No third-party scraper / no platform API** — avoids cost, key management, API
  policy changes, and the account-linking that APIs expose.

Per platform:
- **Reddit** — inside the logged-in session, read the authenticated `.json` endpoints
  (clean structured data). Public JSON now 403s from plain servers, so it must run
  inside the browser session.
- **Facebook / Instagram** — navigate in-app search / hashtag / feed pages and read the
  rendered post text (DOM). Selectors need live tuning against the real accounts.

### 2b. The AI brain: Claude Code CLI on the VPS (subscription) — not the API key
The "AI" does two things: **score relevance** and **write the comment**. Per Hon/Mofedul
direction we do **not** use a metered Anthropic API key. Instead we run the **Claude Code
CLI headless on the VPS, authenticated with a Claude Max subscription**, and call it as a
text-in → JSON-out function (the same way we'd call the API, but billed to the flat
subscription).

Why this works cleanly here:
- Our browser work is plain **Node + Playwright — it does NOT use MCP**. That matters
  because headless `claude -p` is unreliable at loading MCP servers. By keeping the
  browser in Node and using Claude Code *only* as a language model (no MCP, no tools),
  we sidestep that limitation entirely.
- This mirrors the proven pattern already running in this workspace (the Sanjoy LinkedIn
  automation uses Claude headless with a per-run OAuth-refresh wrapper on a server).
- **The AI layer is pluggable.** `lib/ai.ts` becomes an adapter with three backends:
  `claude` (CLI subscription, default), `codex` (GPT-5.x CLI subscription), or `api`
  (Anthropic key, fallback). Scaling to a $100 Claude Max or Codex/GPT-5.5 subscription
  is just a config switch.
- Efficiency: batch several posts into one `claude -p` call (one prompt returns an array
  of {relevance, category, comment}) to stay well within subscription rate limits.

### 2c. Deployment: single VPS, browser-based, cron-driven
Dashboard (Next.js) + discovery + posting all run on **one VPS**, sharing one SQLite
file. Not Vercel (serverless can't run a persistent browser or share the DB). Discovery
and posting are **cron jobs** driving the browser; the dashboard is the human approval
gate, protected by a password.

## 3. Data flow

```
                         ┌─────────────────────────────────────────────────┐
                         │                  VPS  (Canada exit via proxy)    │
                         │                                                  │
  Hon types a topic ───▶ │  [Next.js dashboard]  ◀── password (Basic Auth)  │
  in the web form        │        │  writes topic + reads queue             │
                         │        ▼                                         │
                         │   [SQLite queue]  (topics, candidates, decisions)│
                         │        ▲                                         │
                         │        │                                         │
   cron: discover ─────▶ │  [Playwright + logged-in Chrome]                 │
                         │   reads Reddit(.json) / FB+IG(DOM) for the topic │
                         │        │ post text                               │
                         │        ▼                                         │
                         │   [Claude Code CLI  (Max subscription)]          │
                         │   relevance score + category + draft comment     │
                         │        │                                         │
                         │        ▼  relevant ones ──▶ queue (status=pending)│
                         │                                                  │
        Hon reviews ───▶ │  dashboard: Approve / Edit / Skip                │
                         │        │ status=approved                         │
                         │        ▼                                         │
   cron: post ────────▶  │  [Playwright + logged-in Chrome] posts comment   │
                         │        │ (human pacing, daily caps)              │
                         │        ▼                                         │
                         │   Google Sheets  ◀── every action logged         │
                         └─────────────────────────────────────────────────┘
                                     ▲
                                     │ all social traffic egresses through
                          [Canadian STATIC RESIDENTIAL proxy]  (same IP used to
                                     create the accounts)
```

## 4. The form (what Hon interacts with)

A single private web page, two areas:
1. **Topic input** — a text box ("What should we engage on today?") plus persistent
   settings (default keywords, tone, which subreddits/hashtags/FB pages, daily caps).
   Submitting a topic enqueues a discovery run.
2. **Review queue** — cards showing: platform, category tag (new buyer / question /
   complaint / discussion), an AI one-line summary, the original post link, and the
   editable draft comment, with **Approve / Skip** buttons. Tabs for pending / approved
   / posted / skipped, and a live activity count.

(The dashboard shell, queue, approval API, and auth are already built and verified. The
topic-input form + "enqueue a discovery run for this topic" is the main new UI piece.)

## 5. Recommendations (proxy + VPS)

### Proxy — Canadian STATIC RESIDENTIAL (ISP) proxy, dedicated
Not a consumer VPN and not a datacenter IP (both are themselves flags). We want one
**stable, dedicated Canadian ISP/residential IP** — a real person uses FB/IG/Reddit from
one home IP, so all three accounts sharing Hon's single dedicated CA IP is correct.

- **Budget / simplest:** IPRoyal (static residential / "royal" sticky), Webshare or
  Proxy-Cheap static ISP — roughly **$2–5 per dedicated IP / month**. Good for 1 person.
- **Premium / most reliable:** Oxylabs ISP or Bright Data ISP — bigger, cleaner pools,
  ~$/GB or per-IP, pricier. Overkill for one user but rock-solid.
- **Recommendation:** start with **one dedicated Canadian ISP proxy from IPRoyal**
  (cheap, static, sticky sessions, easy dashboard). Upgrade to Oxylabs/Bright Data only
  if we ever see flags.

The one rule that matters most: **buy the proxy first, create the accounts through it,
then run the VPS through the same proxy.** Signup IP == operating IP.

### VPS — needs RAM for a real Chrome; location irrelevant (we exit via the proxy)
Requirement: 1 headless Chrome (RAM-hungry) + Next.js + cron ⇒ **≥ 4 GB RAM, 2 vCPU,
~40–80 GB disk; 8 GB comfortable.**

- **Best value: Hetzner** — CX32 (4 vCPU / 8 GB / 80 GB, ~€7–8/mo) or CX22 (2 vCPU /
  4 GB, ~€4/mo). Best price/performance, reliable.
- **Hostinger** — KVM 2 (2 vCPU / 8 GB) is fine and has a friendly panel; slightly
  pricier per performance, resells datacenters. Acceptable if you prefer their support.
- **Avoid Contabo** for this — cheap RAM but oversold/slower and flakier for always-on
  browser work.
- **Recommendation:** **Hetzner CX32 (8 GB)**. Location can be anywhere (EU is cheapest)
  because all social traffic leaves through the Canadian residential proxy.

Total monthly running cost target: ~**$8 VPS + $3–5 proxy + $0 Claude (subscription)** ≈
**$12–15/mo** (down from the original ~$37–68 once Firecrawl + API metering are gone).

## 6. What changes in the code vs what exists

Already built + verified: dashboard, auth, SQLite queue, approval flow, browser-based
discovery wiring, Reddit/FB/IG posting agents, Google Sheets logging.

To build for this v2:
1. **AI adapter** (`lib/ai.ts`): add `claude -p` (subscription) and `codex` backends +
   batching; keep API as fallback. **[main new work]**
2. **Topic-input form** in the dashboard + a `topics` table + "enqueue discovery for
   topic" (cron picks up queued topics, or a local trigger runs discover for that topic).
3. **Proxy wiring** for account creation (browser launched with `--proxy-server`) and the
   VPS worker (already reads `PROXY_URL`).
4. **VPS provisioning**: install Node + Playwright Chrome + Claude Code CLI (logged into
   Max), set cron for discover/post, run the dashboard behind nginx/Caddy + TLS + auth.
5. **FB/IG selector tuning** against the real accounts (Phase 2), once they exist.

## 7. Open confirmations from Hon
- The engagement **topic/niche** (working assumption: AI agents / AI automation for
  business — confirm and give 5–10 seed keywords + any target subreddits/hashtags/pages).
- His **phone** for FB/IG SMS verification (Hon's number — you'll do signup).
- Go-ahead to **buy the proxy** (one dedicated CA ISP IP) and **spin up the VPS**.
