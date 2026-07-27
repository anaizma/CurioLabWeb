import { getDirectorContext } from "./session";

/** Identity category shown as a P / M / S / T badge (Team = anyone else in the org). */
export type BadgeRole = "parent" | "mentor" | "student" | "team";
export type MailWho = "me" | "staff" | "mentor" | "student" | "parent" | "guardian";

export interface DirMsg {
  id: string;
  who: MailWho;
  name: string;
  body: string;
  timeLabel: string;
}

export interface OversightParticipant {
  role: BadgeRole;
  name: string;
}

export interface DirThread {
  id: string;
  subject: string;
  counterpart: string;
  /** Role of the counterpart for the P/M/S/T badge; undefined = not identifiable. */
  counterpartRole?: BadgeRole;
  msgs: DirMsg[];
  lastPreview: string;
  lastLabel: string;
  unread: boolean;
  /** Present on oversight threads: the two people talking, tagged by role. */
  participants?: OversightParticipant[];
}

export interface DirMailView {
  inbox: DirThread[];
  sent: DirThread[];
  oversight: DirThread[];
  live: boolean;
  isSample: boolean;
}

function fmt(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---- representative data (full names; no titles/initials) ------------------

const SAMPLE_INBOX: DirThread[] = [];

const SAMPLE_SENT: DirThread[] = [];

const SAMPLE_OVERSIGHT: DirThread[] = [];

const FALLBACK: DirMailView = { inbox: SAMPLE_INBOX, sent: SAMPLE_SENT, oversight: SAMPLE_OVERSIGHT, live: false, isSample: true };

// ---- live read (director's own threads) ------------------------------------

export async function getDirectorMailView(): Promise<DirMailView> {
  const ctx = await getDirectorContext();
  if (!ctx) return FALLBACK;
  try {
    const res = await fetch(`${ctx.origin}/api/ops/messages?chapterId=${encodeURIComponent(ctx.chapterId)}`, { headers: { cookie: ctx.cookie }, cache: "no-store" });
    if (!res.ok) return FALLBACK;
    const data = (await res.json()) as {
      items?: {
        id?: string;
        guardianName?: string;
        subject?: string | null;
        lastMessage?: { body?: string; sentAt?: string } | null;
        lastMessageAt?: string;
        messages?: { id?: string; senderRole?: string; senderName?: string; body?: string; sentAt?: string }[];
      }[];
    };
    const threads: DirThread[] = (data.items ?? []).map((t, i) => {
      const raw = t.messages ?? [];
      const msgs: DirMsg[] = raw.length
        ? raw.map((m, j) => ({
            id: m.id ?? `m${j}`,
            who: m.senderRole === "guardian" ? "parent" : "me",
            name: m.senderRole === "guardian" ? (t.guardianName ?? "Parent") : (m.senderName ?? "You"),
            body: m.body ?? "",
            timeLabel: fmt(m.sentAt),
          }))
        : [{ id: "m0", who: "parent", name: t.guardianName ?? "Parent", body: t.lastMessage?.body ?? "(no messages yet)", timeLabel: fmt(t.lastMessage?.sentAt ?? t.lastMessageAt) }];
      const last = msgs[msgs.length - 1];
      return {
        id: t.id ?? `thr${i}`,
        subject: t.subject ?? "Chapter conversation",
        counterpart: t.guardianName ?? "Parent",
        counterpartRole: "parent" as BadgeRole,
        msgs,
        lastPreview: last ? last.body.slice(0, 80) : "",
        lastLabel: last?.timeLabel ?? "",
        unread: false,
      };
    });
    const sent = threads.filter((t) => t.msgs.some((m) => m.who === "me"));
    return { inbox: threads, sent, oversight: SAMPLE_OVERSIGHT, live: true, isSample: false };
  } catch {
    return FALLBACK;
  }
}
