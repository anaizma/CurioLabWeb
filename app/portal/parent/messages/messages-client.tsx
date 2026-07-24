"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChatMessage } from "@/lib/portal/guardian/types";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function nowStamp(): string {
  const d = new Date();
  let h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${DOW[d.getDay()]} ${h}:${mm} ${ap}`;
}

export default function MessagesClient({ seed, threadId, live }: { seed: ChatMessage[]; threadId: string | null; live: boolean }) {
  const router = useRouter();
  const [thread, setThread] = useState<ChatMessage[]>(seed);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (live) {
      setBusy(true);
      try {
        const res = await fetch("/api/guardian/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: text, threadId: threadId ?? undefined }),
        });
        if (res.ok) {
          setDraft("");
          router.refresh();
        }
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
      return;
    }
    setThread((t) => [...t, { id: `local_${t.length}_${Date.now()}`, who: "me", name: "You", text, timeLabel: nowStamp() }]);
    setDraft("");
    setTimeout(() => {
      setThread((t) => [
        ...t,
        { id: `reply_${Date.now()}`, who: "them", name: "CurioLab team", text: "Thanks for your message — a mentor will get back to you shortly. This thread is saved to your family's record.", timeLabel: nowStamp() },
      ]);
    }, 1100);
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5">
      <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto pr-1">
        {thread.length === 0 ? (
          <p className="text-sm text-ink/50 py-6 text-center">No messages yet — start a conversation below.</p>
        ) : (
          thread.map((m) => (
            <div key={m.id} className={m.who === "me" ? "self-end max-w-[80%] flex flex-col items-end" : "self-start max-w-[80%] flex flex-col items-start"}>
              {m.who === "them" && <span className="text-[11px] text-ink/50 mb-0.5 px-1">{m.name}</span>}
              <div
                className={m.who === "me" ? "px-3 py-2 rounded-2xl text-sm" : "px-3 py-2 rounded-2xl text-sm bg-cream border border-ink/10 text-ink"}
                style={m.who === "me" ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)", borderBottomRightRadius: 4 } : { borderBottomLeftRadius: 4 }}
              >
                {m.text}
              </div>
              <span className="text-[10px] text-ink/40 mt-0.5 px-1">{m.timeLabel}</span>
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2 mt-4">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Write a message to the team…"
          className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm bg-white"
        />
        <button type="button" onClick={send} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
