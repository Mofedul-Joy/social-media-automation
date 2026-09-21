"use client";

/**
 * The compose surface: one post, a list of places Hon posts it himself, and a
 * formatted draft per place.
 *
 * READ THIS BEFORE ADDING ANYTHING HERE. This component must never gain a way
 * to send the post to a platform — no API call, no automation, no scheduling.
 * Its entire job is to format text and remember which targets Hon has already
 * handled by hand. The only fetches in this file go to this app's own
 * /api/compose* routes.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Circle, CircleCheck, Info, Loader2, Plus, Radio, Save, Trash2, X } from "lucide-react";
import type { Platform } from "@/lib/types";
import { PlatformIcon, PLATFORM_COLOR, PLATFORM_LABEL } from "./PlatformIcon";
import { formatForPlatform } from "@/lib/compose";
import { ComposeDraft, type DraftRow } from "./ComposeDraft";
import type { CrosspostTarget, SavedTarget } from "@/lib/composeStore";

const PLATFORMS: Platform[] = ["reddit", "facebook", "instagram", "threads", "hackernews", "stackexchange"];

const keyOf = (platform: Platform, name: string) => `${platform}\u0000${name}`;
const num = (n: number) => n.toLocaleString("en-US");

/**
 * Every call this page makes, and the only calls it may ever make: its own
 * /api/compose* routes. Nothing here can be pointed at a platform.
 *
 * Always throws an Error whose message is fit to show Hon. Without this, a
 * dropped connection surfaced as the browser's raw "Failed to fetch", which
 * tells him nothing about what to do next.
 */
async function callApi<T>(path: `/api/compose${string}`, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data: { error?: string } = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again in a minute.");
  return data as T;
}

const JSON_POST = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function Composer({
  savedTargets,
  initialPost,
  initialTargets,
  loadError,
}: {
  savedTargets: SavedTarget[];
  initialPost: { id: number; body: string } | null;
  initialTargets: CrosspostTarget[];
  loadError: string | null;
}) {
  const [library, setLibrary] = useState<SavedTarget[]>(savedTargets);
  const [body, setBody] = useState(initialPost?.body ?? "");
  const [postId, setPostId] = useState<number | null>(initialPost?.id ?? null);
  const [rows, setRows] = useState<CrosspostTarget[]>(initialTargets);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialTargets.map((t) => keyOf(t.platform, t.target))),
  );
  const [savedBody, setSavedBody] = useState(initialPost?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(loadError);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addPlatform, setAddPlatform] = useState<Platform>("facebook");

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }

  const rowByKey = useMemo(
    () => new Map(rows.map((r) => [keyOf(r.platform, r.target), r])),
    [rows],
  );

  const drafts: DraftRow[] = useMemo(
    () =>
      library
        .filter((t) => selected.has(keyOf(t.platform, t.name)))
        // Same order as the picker on the left, so the two columns line up.
        .sort(
          (a, b) =>
            PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform) || a.name.localeCompare(b.name),
        )
        .map((t) => {
          const row = rowByKey.get(keyOf(t.platform, t.name));
          return {
            key: keyOf(t.platform, t.name),
            platform: t.platform,
            name: t.name,
            url: t.url,
            draft: formatForPlatform(body, t.platform),
            rowId: row?.id ?? null,
            done: row?.done ?? false,
          };
        }),
    [library, selected, body, rowByKey],
  );

  const doneCount = drafts.filter((d) => d.done).length;
  const stale = body !== savedBody;
  const selectionChanged =
    drafts.length !== rows.length || drafts.some((d) => d.rowId === null);
  const unsaved = stale || selectionChanged;

  const byPlatform = useMemo(() => {
    const map = new Map<Platform, SavedTarget[]>();
    for (const p of PLATFORMS) map.set(p, []);
    for (const t of library) map.get(t.platform)?.push(t);
    return map;
  }, [library]);

  // Platforms Hon has actually set up get a full group. The rest collapse into
  // one row of chips, rather than five identical "nothing here" paragraphs.
  const stocked = PLATFORMS.filter((p) => (byPlatform.get(p) ?? []).length > 0);
  const empty = PLATFORMS.filter((p) => (byPlatform.get(p) ?? []).length === 0);

  function toggleSelected(platform: Platform, name: string) {
    const k = keyOf(platform, name);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await callApi<{ post: { id: number; body: string }; targets: CrosspostTarget[] }>(
        "/api/compose",
        JSON_POST({
          postId,
          body,
          targets: drafts.map((d) => ({ platform: d.platform, target: d.name, target_url: d.url })),
        }),
      );
      setPostId(data.post.id);
      setRows(data.targets);
      setSavedBody(data.post.body);
      flash("Draft saved. Nothing has been posted — that part is still yours.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(row: DraftRow) {
    if (row.rowId === null) return;
    setError(null);
    try {
      const data = await callApi<{ target: CrosspostTarget }>("/api/compose/targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.rowId, done: !row.done }),
      });
      setRows((prev) => prev.map((r) => (r.id === data.target.id ? data.target : r)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addTarget(platform: Platform, name: string, url: string) {
    setError(null);
    const data = await callApi<{ target: SavedTarget }>("/api/compose/library", JSON_POST({ platform, name, url }));
    setLibrary((prev) => [...prev.filter((t) => t.id !== data.target.id), data.target]);
    setSelected((prev) => new Set(prev).add(keyOf(data.target.platform, data.target.name)));
    flash(`${data.target.name} added to your list`);
  }

  async function removeTarget(t: SavedTarget) {
    setError(null);
    try {
      await callApi(`/api/compose/library?id=${t.id}`, { method: "DELETE" });
      setLibrary((prev) => prev.filter((x) => x.id !== t.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(keyOf(t.platform, t.name));
        return next;
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-10">
      <header className="flex items-center justify-between gap-4 mb-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl grid place-items-center btn-primary">
            <Radio className="w-[18px] h-[18px]" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-bold tracking-tight">Pulse</div>
            <div className="text-[11px] text-[color:var(--muted)] -mt-0.5">Engagement Studio</div>
          </div>
        </div>
        <Link
          href="/"
          className="btn text-[15px] font-medium px-4 py-2.5 rounded-xl inline-flex items-center gap-2 border border-[color:var(--border-strong)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.09)] text-[color:var(--text)] whitespace-nowrap"
        >
          <ArrowLeft className="w-4 h-4" /> Find posts
        </Link>
      </header>

      <div className="max-w-3xl mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-[1.08] mb-4">
          Write once, post it yourself
        </h1>
        <p className="text-[color:var(--muted)] text-base sm:text-lg leading-relaxed mb-4">
          Write the post one time. Pulse formats a copy for every place you picked, trimmed to that
          platform&rsquo;s limit and its hashtag habits. You open each place, paste it in, and tick it off here.
        </p>
        <NeverPostsTooltip />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-2xl px-4 py-3 mb-6 text-[15px] leading-relaxed"
          style={{ background: "rgba(255,107,107,0.10)", border: "1px solid rgba(255,107,107,0.35)", color: "#ffc4c4" }}
        >
          {error}
        </div>
      )}

      {/* ---- the post ---- */}
      <section className="glass rounded-3xl p-6 sm:p-8 mb-8">
        <label htmlFor="compose-body" className="block text-[15px] font-semibold mb-2 text-[color:var(--text)]">
          Your post
        </label>
        <p className="text-[13px] text-[color:var(--muted)] mb-3 leading-relaxed">
          Write it the way you would on the platform you care about most. Each place gets its own adjusted copy below.
        </p>
        <textarea
          id="compose-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder="What do you want to say?"
          className="w-full text-[15px] rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] focus:border-[color:var(--primary)] outline-none px-4 py-3.5 resize-y text-[color:var(--text)] placeholder:text-[color:var(--muted)] leading-relaxed"
        />

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            type="button"
            onClick={save}
            disabled={saving || (!body.trim() && drafts.length === 0)}
            className="btn btn-primary text-[15px] font-semibold px-5 py-3 rounded-xl inline-flex items-center gap-2 whitespace-nowrap"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving draft…" : "Save draft"}
          </button>
          <span className="text-[13px] text-[color:var(--muted)] tabular-nums">{num(body.length)} characters written</span>
          {unsaved && drafts.length > 0 && (
            <span className="text-[13px] text-[color:var(--primary-2)] font-medium">Unsaved changes</span>
          )}
        </div>

        {drafts.length > 0 && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-4 mb-2">
              <span className="text-[15px] font-semibold text-[color:var(--text)]">
                {doneCount} of {drafts.length} posted by you
              </span>
              <span className="text-[13px] text-[color:var(--muted)] tabular-nums">
                {drafts.length - doneCount} left
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.09)" }}>
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${(doneCount / drafts.length) * 100}%`,
                  background: "var(--green)",
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* ---- picker + drafts ---- */}
      <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
        <section className="glass rounded-3xl p-5 sm:p-6 min-w-0 lg:sticky lg:top-8">
          <h2 className="text-[17px] font-semibold text-[color:var(--text)] mb-1">Where you post</h2>
          <p className="text-[13px] text-[color:var(--muted)] leading-relaxed mb-5">
            Your own list. Add the groups and communities you are already a member of.
          </p>

          {stocked.length === 0 && (
            <p className="text-[15px] text-[color:var(--muted)] leading-relaxed">
              Your list is empty. Add the first place below.
            </p>
          )}

          <div className="flex flex-col gap-5">
            {stocked.map((platform) => (
              <div key={platform}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="shrink-0" style={{ color: PLATFORM_COLOR[platform] }}>
                    <PlatformIcon platform={platform} className="w-4 h-4" />
                  </span>
                  <span className="text-[13px] font-semibold text-[color:var(--text)] whitespace-nowrap">
                    {PLATFORM_LABEL[platform]}
                  </span>
                </div>

                <ul className="flex flex-col gap-1.5">
                  {(byPlatform.get(platform) ?? []).map((t) => {
                    const on = selected.has(keyOf(t.platform, t.name));
                    return (
                      <li key={t.id} className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleSelected(t.platform, t.name)}
                          aria-pressed={on}
                          className="btn flex-1 min-w-0 text-left text-[15px] rounded-xl px-3 py-2.5 border transition-colors inline-flex items-center gap-2"
                          style={
                            on
                              ? {
                                  background: `${PLATFORM_COLOR[t.platform]}24`,
                                  borderColor: `${PLATFORM_COLOR[t.platform]}80`,
                                  color: "var(--text)",
                                }
                              : {
                                  background: "rgba(255,255,255,0.04)",
                                  borderColor: "var(--border)",
                                  color: "var(--text)",
                                }
                          }
                        >
                          {on ? (
                            <CircleCheck className="w-4 h-4 shrink-0" style={{ color: PLATFORM_COLOR[t.platform] }} />
                          ) : (
                            <Circle className="w-4 h-4 shrink-0 text-[color:var(--muted)]" />
                          )}
                          <span className="block truncate">{t.name}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTarget(t)}
                          aria-label={`Remove ${t.name} from your list`}
                          className="btn shrink-0 w-9 h-9 grid place-items-center rounded-xl text-[color:var(--muted)] hover:text-[color:var(--text)] hover:bg-[rgba(255,255,255,0.08)]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-5 border-t border-[color:var(--border)]">
            {adding ? (
              <AddTargetForm
                platform={addPlatform}
                setPlatform={setAddPlatform}
                onCancel={() => setAdding(false)}
                onAdd={addTarget}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="btn w-full text-[15px] font-semibold px-4 py-3 rounded-xl inline-flex items-center justify-center gap-2 border border-[color:var(--border-strong)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.09)] text-[color:var(--text)] whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" /> Add a place
                </button>

                {empty.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[13px] text-[color:var(--muted)] leading-relaxed mb-2">
                      Nothing added for these yet:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {empty.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            setAddPlatform(p);
                            setAdding(true);
                          }}
                          className="btn inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium border border-[color:var(--border)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.09)] text-[color:var(--text)] whitespace-nowrap"
                        >
                          <span style={{ color: PLATFORM_COLOR[p] }}>
                            <PlatformIcon platform={p} className="w-3.5 h-3.5" />
                          </span>
                          {PLATFORM_LABEL[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-5 min-w-0">
          {drafts.length === 0 ? (
            <div className="glass rounded-3xl p-8">
              <h2 className="text-[17px] font-semibold text-[color:var(--text)] mb-2">No places picked yet</h2>
              <p className="text-[15px] text-[color:var(--muted)] leading-relaxed max-w-prose">
                Pick one or more places from the list. Each one gets its own copy of your post here, cut to that
                platform&rsquo;s character limit, with hashtags adjusted to what that platform actually uses. You copy it
                and paste it there yourself.
              </p>
            </div>
          ) : (
            drafts.map((row) => (
              <ComposeDraft key={row.key} row={row} stale={stale} onToggleDone={toggleDone} onToast={flash} />
            ))
          )}
        </section>
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass rounded-xl px-4 py-3 text-[15px] text-[color:var(--text)] max-w-[calc(100vw-2.5rem)]"
        >
          {toast}
        </div>
      )}
    </main>
  );
}

/**
 * The trust statement, on hover and on keyboard focus. Says the thing plainly:
 * this app has no way to post and never will.
 */
function NeverPostsTooltip() {
  return (
    // Anchored to its own left edge, never centred: a centred tooltip runs off
    // the right of a phone screen wherever the trigger happens to land.
    <span className="relative inline-block group max-w-full">
      <button
        type="button"
        aria-describedby="never-posts"
        className="btn inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[15px] font-medium whitespace-nowrap border border-[color:var(--border-strong)] bg-[rgba(255,255,255,0.05)] text-[color:var(--text)] hover:bg-[rgba(255,255,255,0.09)] outline-none focus-visible:border-[color:var(--primary)]"
      >
        <Info className="w-[18px] h-[18px] text-[color:var(--primary-2)]" />
        Pulse never posts for you
      </button>
      <span
        id="never-posts"
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-40 mt-2 w-[min(23rem,calc(100vw-2.5rem))] rounded-xl px-4 py-3 text-left text-[14px] leading-relaxed opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ background: "#16161f", border: "1px solid var(--border-strong)", color: "var(--text)", boxShadow: "0 18px 40px -18px rgba(0,0,0,0.9)" }}
      >
        It is not connected to your accounts and cannot be. Pulse writes the text, you open the platform and paste it
        in yourself, and ticking &ldquo;Posted&rdquo; is just your own note that you did.
      </span>
    </span>
  );
}

/** Inline, not a modal: adding a place is a two-field job, not an interruption. */
function AddTargetForm({
  platform,
  setPlatform,
  onAdd,
  onCancel,
}: {
  platform: Platform;
  setPlatform: (p: Platform) => void;
  onAdd: (platform: Platform, name: string, url: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onAdd(platform, name, url);
      setName("");
      setUrl("");
      onCancel();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full text-[15px] rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] focus:border-[color:var(--primary)] outline-none px-3 py-2.5 text-[color:var(--text)] placeholder:text-[color:var(--muted)]";

  return (
    <form onSubmit={submit}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-[15px] font-semibold text-[color:var(--text)] whitespace-nowrap">Add a place</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel adding a place"
          className="btn w-8 h-8 grid place-items-center rounded-lg text-[color:var(--muted)] hover:text-[color:var(--text)] hover:bg-[rgba(255,255,255,0.08)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <fieldset className="mb-3">
        <legend className="text-[13px] font-medium text-[color:var(--muted)] mb-2">Platform</legend>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => {
            const on = p === platform;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                aria-pressed={on}
                title={PLATFORM_LABEL[p]}
                className="btn w-10 h-10 grid place-items-center rounded-xl border"
                style={
                  on
                    ? { background: `${PLATFORM_COLOR[p]}2e`, borderColor: PLATFORM_COLOR[p], color: PLATFORM_COLOR[p] }
                    : { background: "rgba(255,255,255,0.04)", borderColor: "var(--border)", color: "var(--muted)" }
                }
              >
                <PlatformIcon platform={p} className="w-[18px] h-[18px]" />
              </button>
            );
          })}
        </div>
      </fieldset>

      <label htmlFor="target-name" className="block text-[13px] font-medium text-[color:var(--muted)] mb-1.5">
        What you call it
      </label>
      <input
        id="target-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={platform === "reddit" ? "r/smallbusiness" : "Local Business Owners"}
        className={`${field} mb-3`}
      />

      <label htmlFor="target-url" className="block text-[13px] font-medium text-[color:var(--muted)] mb-1.5">
        Link to it
      </label>
      <input
        id="target-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        inputMode="url"
        placeholder="https://…"
        className={field}
      />
      <p className="text-[13px] text-[color:var(--muted)] leading-relaxed mt-2">
        Saved as a bookmark only. Pulse never opens it or signs in to it.
      </p>

      {err && <p className="text-[13px] leading-relaxed mt-2" style={{ color: "#ffc4c4" }}>{err}</p>}

      <button
        type="submit"
        disabled={busy || !name.trim() || !url.trim()}
        className="btn btn-primary w-full text-[15px] font-semibold px-4 py-3 rounded-xl inline-flex items-center justify-center gap-2 mt-4 whitespace-nowrap"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        {busy ? "Saving…" : "Add to my list"}
      </button>
    </form>
  );
}
