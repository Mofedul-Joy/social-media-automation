"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, Radio } from "lucide-react";

// A same-document path only: rejects `//evil.com` and `/\evil.com`, both of
// which `startsWith("/")` alone would let through as an open redirect after
// a real login (Next's router treats a protocol-relative string as external).
function safeRedirectPath(path: string | null): string {
  if (path && /^\/(?!\/|\\)/.test(path)) return path;
  return "/";
}

const FIELD_CLASS =
  "w-full text-[15px] leading-relaxed rounded-xl bg-[rgba(255,255,255,0.05)] border border-[color:var(--border)] " +
  "focus:border-[color:var(--primary)] focus:shadow-[0_0_0_3px_rgba(225,29,72,0.28)] outline-none px-4 py-3 text-[color:var(--text)] " +
  "placeholder:text-[color:var(--faint)] [color-scheme:dark]";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}) as { ok?: boolean; error?: string });
      if (!res.ok || !data.ok) {
        setError(data.error || "Incorrect username or password.");
        setLoading(false);
        return;
      }
      router.replace(safeRedirectPath(searchParams.get("from")));
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
      setLoading(false);
    }
  }

  return (
    <main className="relative z-10 min-h-dvh flex items-center justify-center px-5">
      <form onSubmit={onSubmit} className="glass w-full max-w-sm rounded-2xl p-8">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl grid place-items-center btn-primary">
            <Radio className="w-[18px] h-[18px]" strokeWidth={2.4} />
          </div>
          <div className="leading-tight">
            <div className="font-bold tracking-tight">Pulse</div>
            <div className="text-[11px] text-[color:var(--faint)] -mt-0.5">Engagement Studio</div>
          </div>
        </div>

        <label className="block mb-4">
          <span className="block text-xs font-medium text-[color:var(--muted)] mb-1.5">Username</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className={FIELD_CLASS}
          />
        </label>

        <label className="block mb-2">
          <span className="block text-xs font-medium text-[color:var(--muted)] mb-1.5">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className={FIELD_CLASS}
          />
        </label>

        {error && (
          <p className="text-sm text-[color:var(--red)] mt-2 mb-2" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="btn btn-primary w-full mt-4 rounded-xl py-3 font-medium inline-flex items-center justify-center gap-2"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.4} />
          ) : (
            <Lock className="w-4 h-4" strokeWidth={2.4} />
          )}
          Sign in
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
