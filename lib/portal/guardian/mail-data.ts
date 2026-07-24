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

const SAMPLE_INBOX: MailThread[] = [
  {
    id: "in_1", subject: "USB-C cable for Saturday", counterpart: "Ms. Alvarez (Mentor)", unread: true, lastLabel: "Mon 4:12 PM",
    lastPreview: "Bring a USB-C cable next Saturday if you have one.",
    msgs: [
      { id: "m1", who: "staff", name: "Ms. Alvarez (Mentor)", body: "Hi! Ari did great building the sensor circuit today — bring a USB-C cable next Saturday if you have one.", timeLabel: "Mon 4:12 PM" },
    ],
  },
  {
    id: "in_2", subject: "Fall enrollment forms", counterpart: "Dr. Okoro (Director)", unread: false, lastLabel: "Jul 19",
    lastPreview: "Forms are due before the first September session.",
    msgs: [
      { id: "m1", who: "staff", name: "Dr. Okoro (Director)", body: "A reminder that fall enrollment forms are due before the first September session. You can complete everything from the Consent tab.", timeLabel: "Jul 18, 9:02 AM" },
      { id: "m2", who: "me", name: "You", body: "Thanks — we'll get them in this week.", timeLabel: "Jul 18, 12:40 PM" },
      { id: "m3", who: "staff", name: "Dr. Okoro (Director)", body: "Perfect. Forms are due before the first September session.", timeLabel: "Jul 19, 8:15 AM" },
    ],
  },
];
const SAMPLE_SENT: MailThread[] = [
  {
    id: "sent_1", subject: "Pickup change this week", counterpart: "CurioLab team", unread: false, lastLabel: "Jul 12",
    lastPreview: "Ari's grandmother will pick up on Saturday.",
    msgs: [
      { id: "m1", who: "me", name: "You", body: "Quick note — Ari's grandmother (Rosa) will pick up on Saturday. She's on the authorized list.", timeLabel: "Jul 12, 3:30 PM" },
      { id: "m2", who: "staff", name: "Ms. Alvarez (Mentor)", body: "Got it, thanks for the heads up — we'll check her in.", timeLabel: "Jul 12, 4:01 PM" },
    ],
  },
];
const SAMPLE_STUDENT: MailThread[] = [
  {
    id: "stu_1", subject: "Recycling robot — sensor help", counterpart: "Ari ↔ Ms. Alvarez", unread: false, lastLabel: "Jul 22",
    lastPreview: "That fixed it!! The readings are steady now.",
    msgs: [
      { id: "m1", who: "student", name: "Ari", body: "My IR sensor keeps giving random values when the motor runs. Is it broken?", timeLabel: "Jul 21, 5:20 PM" },
      { id: "m2", who: "mentor", name: "Ms. Alvarez (Mentor)", body: "Not broken — that's motor noise. Try moving the IR sensor away from the motor and twist the signal wires together.", timeLabel: "Jul 21, 6:05 PM" },
      { id: "m3", who: "student", name: "Ari", body: "That fixed it!! The readings are steady now.", timeLabel: "Jul 22, 4:44 PM" },
    ],
  },
  {
    id: "stu_2", subject: "Newsletter draft feedback", counterpart: "Ari ↔ Dev K.", unread: false, lastLabel: "Jul 15",
    lastPreview: "Second draft reads great — submitting it.",
    msgs: [
      { id: "m1", who: "mentor", name: "Dev K. (Mentor)", body: "Your build-log post is a great newsletter candidate. Can you add a line about what you'd do differently?", timeLabel: "Jul 14, 7:10 PM" },
      { id: "m2", who: "student", name: "Ari", body: "Added it — and a photo of the wiring.", timeLabel: "Jul 15, 4:30 PM" },
      { id: "m3", who: "mentor", name: "Dev K. (Mentor)", body: "Second draft reads great — submitting it.", timeLabel: "Jul 15, 6:12 PM" },
    ],
  },
];

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
