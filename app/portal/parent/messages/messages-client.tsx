"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MailMsg, MailThread, MailView } from "@/lib/portal/guardian/mail-data";

type Folder = "inbox" | "sent" | "drafts" | "student";
interface Draft { id: string; subject: string; body: string; }

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function nowStamp(): string {
  const d = new Date();
  let h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${DOW[d.getDay()]} ${h}:${mm} ${ap}`;
}

function Avatar({ name, tone }: { name: string; tone: "me" | "them" }) {
  return (
    <div className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-semibold text-white shrink-0" style={{ background: tone === "me" ? "var(--pt-accent)" : "#7c8aa0" }}>
      {(name.trim().charAt(0) || "?").toUpperCase()}
    </div>
  );
}

export default function MessagesClient({ view, childName }: { view: MailView; childName: string }) {
  const router = useRouter();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [compose, setCompose] = useState<{ draftId: string | null; subject: string; body: string } | null>(null);
  const [reply, setReply] = useState("");
  const [localMsgs, setLocalMsgs] = useState<Record<string, MailMsg[]>>({});
  const [localSent, setLocalSent] = useState<MailThread[]>([]);
  const [busy, setBusy] = useState(false);

  const unread = view.inbox.filter((t) => t.unread).length;
  const boxes: { key: Folder; label: string; count: number | null }[] = [
    { key: "inbox", label: "Inbox", count: unread || null },
    { key: "sent", label: "Sent", count: null },
    { key: "drafts", label: "Drafts", count: drafts.length || null },
  ];

  const threads: MailThread[] = folder === "inbox" ? view.inbox : folder === "sent" ? [...localSent, ...view.sent] : folder === "student" ? view.student : [];
  const open = openId ? [...view.inbox, ...view.sent, ...localSent, ...view.student].find((t) => t.id === openId) ?? null : null;
  const openMsgs = open ? [...open.msgs, ...(localMsgs[open.id] ?? [])] : [];
  const openIsStudent = open ? view.student.some((t) => t.id === open.id) : false;

  function go(f: Folder) {
    setFolder(f);
    setOpenId(null);
    setCompose(null);
  }
  function saveDraft() {
    if (!compose) return;
    const d: Draft = { id: compose.draftId ?? `d_${Date.now()}`, subject: compose.subject, body: compose.body };
    setDrafts((prev) => [d, ...prev.filter((x) => x.id !== d.id)]);
    setCompose(null);
    setFolder("drafts");
  }
  async function sendCompose() {
    if (!compose || !compose.body.trim()) return;
    setBusy(true);
    try {
      if (view.live) {
        const res = await fetch("/api/guardian/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: compose.body.trim(), subject: compose.subject.trim() || undefined }),
        });
        if (res.ok) {
          if (compose.draftId) setDrafts((p) => p.filter((x) => x.id !== compose.draftId));
          setCompose(null);
          setFolder("sent");
          router.refresh();
        }
      } else {
        const t: MailThread = {
          id: `local_${Date.now()}`,
          subject: compose.subject.trim() || "(no subject)",
          counterpart: "CurioLab team",
          unread: false,
          lastLabel: nowStamp(),
          lastPreview: compose.body.trim().slice(0, 80),
          msgs: [{ id: `m_${Date.now()}`, who: "me", name: "You", body: compose.body.trim(), timeLabel: nowStamp() }],
        };
        setLocalSent((p) => [t, ...p]);
        if (compose.draftId) setDrafts((p) => p.filter((x) => x.id !== compose.draftId));
        setCompose(null);
        setFolder("sent");
      }
    } finally {
      setBusy(false);
    }
  }
  async function sendReply() {
    if (!open || !reply.trim()) return;
    setBusy(true);
    try {
      if (view.live) {
        const res = await fetch("/api/guardian/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: reply.trim(), threadId: open.id }),
        });
        if (res.ok) {
          setReply("");
          router.refresh();
        }
      } else {
        setLocalMsgs((p) => ({ ...p, [open.id]: [...(p[open.id] ?? []), { id: `m_${Date.now()}`, who: "me", name: "You", body: reply.trim(), timeLabel: nowStamp() }] }));
        setReply("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-black/[.08] rounded-lg grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] min-h-[520px] overflow-hidden">
      <aside className="border-b md:border-b-0 md:border-r border-black/[.06] p-3 flex flex-row md:flex-col gap-1 items-stretch overflow-x-auto">
        <button type="button" onClick={() => { setCompose({ draftId: null, subject: "", body: "" }); setOpenId(null); }} className="rounded-md px-3 py-2 text-[12.5px] font-semibold text-center shrink-0 md:mb-2" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>
        Compose
        </button>
        {boxes.map((b) => (
          <button key={b.key} type="button" onClick={() => go(b.key)} className={`rounded-md px-3 py-1.5 text-[12.5px] text-left flex items-center justify-between gap-2 shrink-0 ${folder === b.key && !compose ? "font-bold bg-cream" : "text-muted hover:text-ink"}`}>
            {b.label}
            {b.count !== null && <span className="font-mono text-[10px] rounded-full px-1.5" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>{b.count}</span>}
          </button>
        ))}
        <div className="hidden md:block border-t border-black/[.06] my-2" />
        <div className="hidden md:block label text-[9.5px] px-3 pb-1">Student</div>
        <button type="button" onClick={() => go("student")} className={`rounded-md px-3 py-1.5 text-[12.5px] text-left shrink-0 ${folder === "student" && !compose ? "font-bold bg-cream" : "text-muted hover:text-ink"}`}>
          {childName} ↔ mentors
        </button>
      </aside>

      <section className="min-w-0 flex flex-col">
        {compose ? (
          <div className="p-4 flex flex-col gap-3 flex-1">
            <div className="label text-[10.5px]">New message · to the CurioLab team</div>
            <input value={compose.subject} onChange={(e) => setCompose((c) => c && { ...c, subject: e.target.value })} placeholder="Subject" className="rounded-md border border-black/[.12] px-3 py-2 text-[13.5px] bg-white" />
            <textarea value={compose.body} onChange={(e) => setCompose((c) => c && { ...c, body: e.target.value })} placeholder="Write your message…" className="rounded-md border border-black/[.12] px-3 py-2 text-[13.5px] bg-white flex-1 min-h-[220px] resize-y" />
            <div className="flex items-center gap-2">
              <button type="button" onClick={sendCompose} disabled={busy || !compose.body.trim()} className="rounded-md px-4 py-2 text-[12.5px] font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>{busy ? "Sending…" : "Send"}</button>
              <button type="button" onClick={saveDraft} className="rounded-md px-3 py-2 text-[12.5px] font-semibold border border-black/15 text-muted">Save draft</button>
              <button type="button" onClick={() => setCompose(null)} className="rounded-md px-3 py-2 text-[12.5px] font-semibold text-muted">Discard</button>
            </div>
          </div>
        ) : open ? (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-4 py-3 border-b border-black/[.06] flex items-center gap-3">
              <button type="button" onClick={() => setOpenId(null)} className="text-[12px] font-semibold shrink-0" style={{ color: "var(--pt-accent)" }}>← Back</button>
              <div className="min-w-0">
                <div className="text-[14px] font-bold truncate">{open.subject}</div>
                <div className="font-mono text-[10.5px] text-muted">{open.counterpart}</div>
              </div>
            </div>
            {openIsStudent && (
              <div className="px-4 py-2 text-[11.5px] border-b border-black/[.06]" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
                Read-only transparency view — the chapter conversation between {childName} and their mentors. Nothing outside the chapter is shown.
              </div>
            )}
            <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
              {openMsgs.map((m) => (
                <div key={m.id} className="border border-black/[.06] rounded-md p-3">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <Avatar name={m.name} tone={m.who === "me" || m.who === "student" ? "me" : "them"} />
                    <div>
                      <div className="text-[12.5px] font-semibold leading-none">{m.name}</div>
                      <div className="font-mono text-[10px] text-muted mt-0.5">{m.timeLabel}</div>
                    </div>
                  </div>
                  <p className="text-[13.5px] leading-relaxed">{m.body}</p>
                </div>
              ))}
            </div>
            {!openIsStudent && (
              <div className="p-3 border-t border-black/[.06] flex gap-2">
                <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void sendReply(); }} placeholder="Reply…" className="flex-1 rounded-md border border-black/[.12] px-3 py-2 text-[13px] bg-white" />
                <button type="button" onClick={sendReply} disabled={busy} className="rounded-md px-4 py-2 text-[12.5px] font-semibold disabled:opacity-50" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>{busy ? "…" : "Send"}</button>
              </div>
            )}
          </div>
        ) : folder === "drafts" ? (
          <div className="flex-1">
            {drafts.length === 0 ? (
              <p className="p-6 text-[13px] text-muted">No drafts.</p>
            ) : (
              drafts.map((d) => (
                <button key={d.id} type="button" onClick={() => setCompose({ draftId: d.id, subject: d.subject, body: d.body })} className="w-full text-left px-4 py-2.5 border-b border-black/[.04] hover:bg-cream flex items-center gap-3">
                  <span className="text-[12.5px] font-semibold text-muted w-24 shrink-0">Draft</span>
                  <span className="text-[13px] truncate flex-1 min-w-0"><b>{d.subject || "(no subject)"}</b><span className="text-muted"> — {d.body.slice(0, 60)}</span></span>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="flex-1">
            {folder === "student" && (
              <div className="px-4 py-2 text-[11.5px] border-b border-black/[.06]" style={{ background: "var(--pt-accent-soft)", color: "var(--pt-accent-fg)" }}>
                Transparency view — {childName}&apos;s chapter conversations with mentors, read-only.
              </div>
            )}
            {threads.length === 0 ? (
              <p className="p-6 text-[13px] text-muted">Nothing here yet.</p>
            ) : (
              threads.map((t) => (
                <button key={t.id} type="button" onClick={() => { setOpenId(t.id); setReply(""); }} className="w-full text-left px-4 py-2.5 border-b border-black/[.04] hover:bg-cream flex items-center gap-3">
                  <span className={`text-[12.5px] w-36 shrink-0 truncate ${t.unread ? "font-bold" : "font-medium text-muted"}`}>{t.counterpart}</span>
                  <span className="text-[13px] truncate flex-1 min-w-0">
                    <span className={t.unread ? "font-bold" : "font-medium"}>{t.subject}</span>
                    <span className="text-muted"> — {t.lastPreview}</span>
                  </span>
                  <span className="font-mono text-[10.5px] text-muted shrink-0">{t.lastLabel}</span>
                </button>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
