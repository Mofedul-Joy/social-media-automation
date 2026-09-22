/**
 * Uptime check and Supabase keep-alive, in one pass.
 *
 * Why this exists: on 2026-09-22 the whole product was found down. The Supabase
 * project had no DNS record at all and the Vercel app would not answer. Nobody
 * noticed, because nothing was watching. Free-tier Supabase pauses after about
 * seven days with no database activity, so the outage was self-inflicted and
 * will recur without this.
 *
 * The Supabase probe is a real read against `business_context`, the same table
 * `lib/config.ts` uses. That is deliberate: the read IS the keep-alive, so one
 * call does both jobs and there is no second thing to maintain.
 *
 * This is NOT discovery. It never calls a social source, never runs
 * `discoverPosts`, and never spends a SocialAPIs credit. The standing ban on
 * scheduled discovery is untouched.
 *
 * No dependencies on purpose. Node 18+ has global fetch.
 *
 * Usage:  node scripts/healthcheck.mjs
 * Exits 0 when everything is up, 1 when anything is down.
 */

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  AI_WORKER_URL,
  APP_URL,
  ALERT_WEBHOOK,
} = process.env;

const TIMEOUT_MS = 15000;

async function probe(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    return { name, up: true, ms: Date.now() - started, detail };
  } catch (err) {
    return { name, up: false, ms: Date.now() - started, detail: err.message };
  }
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return res;
}

function required(name, value) {
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const checks = [
  // A real row read. Keeps the free project awake and proves the DB answers.
  probe("supabase", async () => {
    const base = required("SUPABASE_URL", SUPABASE_URL);
    const key = required("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
    const res = await get(`${base}/rest/v1/business_context?select=id&limit=1`, {
      apikey: key,
      Authorization: `Bearer ${key}`,
    });
    // 200 is a healthy read. 404 means the table is missing but the project is
    // awake and reachable, which is still a pass for uptime purposes.
    if (res.status !== 200 && res.status !== 404) {
      throw new Error(`http ${res.status}`);
    }
    return res.status === 404 ? "reachable, business_context missing" : "read ok";
  }),

  // The dashboard. Basic Auth means an anonymous request should be challenged,
  // so 401 is the healthy answer and 200 would mean the gate is off.
  probe("app", async () => {
    const url = required("APP_URL", APP_URL);
    const res = await get(url);
    if (res.status === 401) return "401, auth gate up";
    if (res.status === 200) return "200, WARNING auth gate appears to be off";
    throw new Error(`http ${res.status}`);
  }),

  // The VPS worker that runs the AI. Any HTTP answer means the process is alive;
  // its root path is not a route, so 404 is expected and fine.
  probe("worker", async () => {
    const url = required("AI_WORKER_URL", AI_WORKER_URL);
    const res = await get(url);
    return `http ${res.status}`;
  }),
];

const results = await Promise.all(checks);
const down = results.filter((r) => !r.up);
const stamp = new Date().toISOString();

for (const r of results) {
  console.log(`${stamp} ${r.name.padEnd(9)} ${r.up ? "UP  " : "DOWN"} ${String(r.ms).padStart(5)}ms  ${r.detail}`);
}

if (down.length && ALERT_WEBHOOK) {
  const body = `Hon-SMA down: ${down.map((d) => `${d.name} (${d.detail})`).join(", ")}`;
  try {
    await fetch(ALERT_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`${stamp} alert     FAILED to notify: ${err.message}`);
  }
}

process.exit(down.length ? 1 : 0);
