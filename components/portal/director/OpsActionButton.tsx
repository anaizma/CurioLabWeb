"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function OpsActionButton({
  method,
  url,
  body,
  label,
  variant = "outline",
  confirmText,
}: {
  method: "POST" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  label: string;
  variant?: "accent" | "outline";
  confirmText?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (confirmText && typeof window !== "undefined" && !window.confirm(confirmText)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        setErr(res.status === 409 ? "Not allowed in current state." : res.status === 403 ? "No permission." : "Action failed.");
        return;
      }
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 border"
        style={variant === "accent" ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)", borderColor: "transparent" } : { borderColor: "rgba(3,35,68,.15)", color: "var(--pt-accent-fg)", background: "transparent" }}
      >
        {busy ? "…" : label}
      </button>
      {err && <span className="text-[10px]" style={{ color: "var(--pt-accent-fg)" }}>{err}</span>}
    </span>
  );
}
