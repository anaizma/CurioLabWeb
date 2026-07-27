"use client";

// "Account & security" — where you are signed in, and how to end it.
//
// Reads GET /api/auth/sessions, which is scoped to the caller's own account in
// the controller. Nothing is invented: when the read fails it says so, and when a
// device or network could not be recognised it says THAT rather than filling in a
// plausible-looking value. "Unrecognised device" is the honest answer for a
// session minted before this shipped, or by a client that sent no user agent.

import { useEffect, useState } from "react";

interface SessionItem {
  id: string;
  deviceLabel: string | null;
  ipHint: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
}

type LoadState = "loading" | "ok" | "unauthenticated" | "error";

function formatWhen(iso: string | null): string {
  if (iso === null) return "Not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not recorded";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ActiveSessions() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  // Bumped to re-run the fetch effect after a revoke, so the list reload lives in
  // exactly one place instead of being a function the effect and the handlers
  // both call.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/sessions", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 403 || res.status === 401) {
          setState("unauthenticated");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }
        const data = (await res.json()) as { sessions?: SessionItem[] };
        if (cancelled) return;
        setSessions(data.sessions ?? []);
        setState("ok");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function revokeOne(id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      const data = (await res.json()) as { endedCurrent?: boolean };
      if (data.endedCurrent) {
        window.location.assign("/login");
        return;
      }
      setReloadKey((k) => k + 1);
    } catch {
      setState("error");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeAll() {
    setBusyId("all");
    try {
      await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      // "Everywhere" includes this browser, on purpose: someone who suspects a
      // compromise wants one button that ends everything.
      window.location.assign("/login");
    } catch {
      setState("error");
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">Where you&apos;re signed in</h2>
        <p className="text-ink/60 text-sm mt-1">
          Every device with a live CurioLab session on your account. We record the device family and
          the network a sign-in came from, never a precise location.
        </p>
      </div>

      {state === "loading" && <p className="text-sm text-ink/50">Loading your sessions…</p>}

      {state === "unauthenticated" && (
        <p className="text-sm text-ink/50 rounded-sm border border-ink/10 bg-white px-4 py-6 text-center">
          Sign in to see your active sessions.
        </p>
      )}

      {state === "error" && (
        <div className="rounded-sm border border-ink/10 bg-white px-4 py-6 text-center">
          <p className="text-sm text-ink/60">We couldn&apos;t load your sessions.</p>
          <button
            type="button"
            onClick={() => {
              setState("loading");
              setReloadKey((k) => k + 1);
            }}
            className="mt-2 text-xs font-semibold"
            style={{ color: "var(--pt-accent)" }}
          >
            Try again
          </button>
        </div>
      )}

      {state === "ok" && sessions.length === 0 && (
        <p className="text-sm text-ink/50 rounded-sm border border-ink/10 bg-white px-4 py-6 text-center">
          No active sessions.
        </p>
      )}

      {state === "ok" && sessions.length > 0 && (
        <>
          <ul className="rounded-sm border border-ink/10 bg-white divide-y divide-ink/5">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-4 px-4 py-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {s.deviceLabel ?? "Unrecognised device"}
                    {s.current && (
                      <span
                        className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                        style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent)" }}
                      >
                        This device
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink/55 mt-0.5">
                    Network {s.ipHint ?? "not recorded"} · Last seen {formatWhen(s.lastSeenAt)}
                  </p>
                  <p className="text-xs text-ink/40 mt-0.5">Signed in {formatWhen(s.createdAt)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => revokeOne(s.id)}
                  disabled={busyId !== null}
                  className="text-xs font-semibold text-coral hover:underline disabled:opacity-50 shrink-0"
                >
                  {busyId === s.id ? "Signing out…" : s.current ? "Sign out here" : "Sign out"}
                </button>
              </li>
            ))}
          </ul>

          <div className="rounded-sm border border-ink/10 bg-white px-4 py-4">
            <p className="text-sm font-medium">Sign out everywhere</p>
            <p className="text-xs text-ink/55 mt-1 mb-3">
              Ends every session on your account, including this one. Use this if you think someone
              else has access. You will need to sign in again.
            </p>
            {confirmingAll ? (
              <div className="flex gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={revokeAll}
                  disabled={busyId !== null}
                  className="bg-coral text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-coral-dark transition-colors disabled:opacity-50"
                >
                  {busyId === "all" ? "Signing out…" : "Yes, sign out everywhere"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingAll(false)}
                  disabled={busyId !== null}
                  className="border border-black/20 px-4 py-2 rounded-md text-sm font-medium hover:bg-cream transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingAll(true)}
                className="border border-black/20 px-4 py-2 rounded-md text-sm font-medium hover:bg-cream transition-colors"
              >
                Sign out everywhere
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
