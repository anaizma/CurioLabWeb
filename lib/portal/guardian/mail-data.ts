import { cookies, headers } from "next/headers";

export interface MailMsg {
  id: string;
  who: "me" | "staff" | "student" | "mentor";
  name: string;
  body: string;
  timeLabel: string;
}
export interface MailThread {
  id: string;
  subject: string;
  counterpart: string;
  msgs: MailMsg[];
  lastPreview: string;
  lastLabel: string;
  unread: boolean;
}
export interface MailView {
  inbox: MailThread[];
  sent: MailThread[];
  student: MailThread[];
  live: boolean;
  isSample: boolean;
}

function fmt(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const SAMPLE_INBOX: MailThread[] = [];
const SAMPLE_SENT: MailThread[] = [];
const SAMPLE_STUDENT: MailThread[] = [];

/** Guardian mail view. Inbox/Sent map the live guardian↔staff threads
 *  (GET /api/guardian/messages) when a session exists. The student↔mentor
 *  transparency section is representative until its guardian read endpoint
 *  lands. */
export async function getMailView(): Promise<MailView> {
  const fallback: MailView = { inbox: SAMPLE_INBOX, sent: SAMPLE_SENT, student: SAMPLE_STUDENT, live: false, isSample: true };
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return fallback;
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return fallback;
    const res = await fetch(`${origin}/api/guardian/messages`, { headers: { cookie: `cl_session=${session.value}` }, cache: "no-store" });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { items?: { id?: string; subject?: string | null; messages?: { id?: string; senderRole?: string; senderName?: string; body?: string; sentAt?: string }[] }[] };
    const threads: MailThread[] = (data.items ?? []).map((t, i) => {
      const msgs: MailMsg[] = (t.messages ?? []).map((m, j) => ({
        id: m.id ?? `m${j}`,
        who: m.senderRole === "guardian" ? "me" : "staff",
        name: m.senderRole === "guardian" ? "You" : m.senderName ?? "CurioLab team",
        body: m.body ?? "",
        timeLabel: fmt(m.sentAt),
      }));
      const last = msgs[msgs.length - 1];
      const staffNames = msgs.filter((m) => m.who === "staff").map((m) => m.name);
      return {
        id: t.id ?? `thr${i}`,
        subject: t.subject ?? "Chapter conversation",
        counterpart: staffNames[staffNames.length - 1] ?? "CurioLab team",
        msgs,
        lastPreview: last ? last.body.slice(0, 80) : "",
        lastLabel: last?.timeLabel ?? "",
        unread: false,
      };
    });
    const sent = threads.filter((t) => t.msgs.some((m) => m.who === "me"));
    return { inbox: threads, sent, student: SAMPLE_STUDENT, live: true, isSample: false };
  } catch {
    return fallback;
  }
}
