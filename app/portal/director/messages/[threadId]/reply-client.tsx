"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReplyClient({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/messages/${threadId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? "You don't have permission to reply." : "Could not send the reply.");
        return;
      }
      setBody("");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Reply to this guardian…"
          className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white"
        />
        <button type="button" onClick={send} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
          {busy ? "…" : "Send"}
        </button>
      </div>
      {error && <p className="text-xs" style={{ color: "var(--pt-accent-fg)" }}>{error}</p>}
    </div>
  );
}
