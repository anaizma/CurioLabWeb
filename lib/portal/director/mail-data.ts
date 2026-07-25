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

const SAMPLE_INBOX: DirThread[] = [
  {
    id: "in_1", subject: "Session the week of the 28th?", counterpart: "Rohan Nair", counterpartRole: "parent", unread: true, lastLabel: "Sun 2:00 PM",
    lastPreview: "Is there a session the week of the 28th? Priya has a recital that Saturday.",
    msgs: [
      { id: "m1", who: "parent", name: "Rohan Nair", body: "Is there a session the week of the 28th? Priya has a recital that Saturday.", timeLabel: "Sun 2:00 PM" },
    ],
  },
  {
    id: "in_2", subject: "USB-C cable for Saturday", counterpart: "Jordan Okafor", counterpartRole: "parent", unread: false, lastLabel: "Mon 6:40 PM",
    lastPreview: "Thanks so much! We'll pack one.",
    msgs: [
      { id: "m1", who: "me", name: "You", body: "Ari did great building the sensor circuit today — bring a USB-C cable next Saturday if you have one.", timeLabel: "Mon 4:12 PM" },
      { id: "m2", who: "parent", name: "Jordan Okafor", body: "Thanks so much! We'll pack one.", timeLabel: "Mon 6:40 PM" },
    ],
  },
  {
    id: "in_3", subject: "Pod roster question", counterpart: "Elena Alvarez", counterpartRole: "mentor", unread: false, lastLabel: "Jul 22",
    lastPreview: "Can I move Diego into my Saturday pod?",
    msgs: [
      { id: "m1", who: "mentor", name: "Elena Alvarez", body: "Can I move Diego into my Saturday pod? He and Ari are already collaborating.", timeLabel: "Jul 22, 1:10 PM" },
    ],
  },
];

const SAMPLE_SENT: DirThread[] = [
  {
    id: "sent_1", subject: "Fall enrollment reminder", counterpart: "All guardians", unread: false, lastLabel: "Jul 19",
    lastPreview: "Fall enrollment forms are due before the first September session.",
    msgs: [
      { id: "m1", who: "me", name: "You", body: "A reminder that fall enrollment forms are due before the first September session. You can complete everything from the Consent tab.", timeLabel: "Jul 19, 8:15 AM" },
    ],
  },
  {
    id: "sent_2", subject: "Newsletter assignments", counterpart: "Dev Kapoor", counterpartRole: "mentor", unread: false, lastLabel: "Jul 15",
    lastPreview: "Can you collect two build-log posts from your pod this week?",
    msgs: [
      { id: "m1", who: "me", name: "You", body: "Can you collect two build-log posts from your pod this week for the newsletter?", timeLabel: "Jul 15, 9:30 AM" },
      { id: "m2", who: "mentor", name: "Dev Kapoor", body: "On it — Ari's is ready, I'll get one more.", timeLabel: "Jul 15, 6:12 PM" },
    ],
  },
];

const SAMPLE_OVERSIGHT: DirThread[] = [
  {
    id: "ov_1", subject: "Recycling robot — sensor help", counterpart: "Ari Okafor · Elena Alvarez", unread: false, lastLabel: "Jul 22",
    lastPreview: "That fixed it!! The readings are steady now.",
    participants: [{ role: "student", name: "Ari Okafor" }, { role: "mentor", name: "Elena Alvarez" }],
    msgs: [
      { id: "m1", who: "student", name: "Ari Okafor", body: "My IR sensor keeps giving random values when the motor runs. Is it broken?", timeLabel: "Jul 21, 5:20 PM" },
      { id: "m2", who: "mentor", name: "Elena Alvarez", body: "Not broken — that's motor noise. Move the IR sensor away from the motor and twist the signal wires together.", timeLabel: "Jul 21, 6:05 PM" },
      { id: "m3", who: "student", name: "Ari Okafor", body: "That fixed it!! The readings are steady now.", timeLabel: "Jul 22, 4:44 PM" },
    ],
  },
  {
    id: "ov_2", subject: "Newsletter draft feedback", counterpart: "Ari Okafor · Dev Kapoor", unread: false, lastLabel: "Jul 15",
    lastPreview: "Second draft reads great — submitting it.",
    participants: [{ role: "student", name: "Ari Okafor" }, { role: "mentor", name: "Dev Kapoor" }],
    msgs: [
      { id: "m1", who: "mentor", name: "Dev Kapoor", body: "Your build-log post is a great newsletter candidate. Add a line about what you'd do differently?", timeLabel: "Jul 14, 7:10 PM" },
      { id: "m2", who: "student", name: "Ari Okafor", body: "Added it — and a photo of the wiring.", timeLabel: "Jul 15, 4:30 PM" },
      { id: "m3", who: "mentor", name: "Dev Kapoor", body: "Second draft reads great — submitting it.", timeLabel: "Jul 15, 6:12 PM" },
    ],
  },
  {
    id: "ov_3", subject: "Fractions game — scoring bug", counterpart: "Priya Nair · Elena Alvarez", unread: false, lastLabel: "Jul 20",
    lastPreview: "Try resetting the score inside the round loop.",
    participants: [{ role: "student", name: "Priya Nair" }, { role: "mentor", name: "Elena Alvarez" }],
    msgs: [
      { id: "m1", who: "student", name: "Priya Nair", body: "My score keeps doubling every round. I can't find where.", timeLabel: "Jul 20, 3:00 PM" },
      { id: "m2", who: "mentor", name: "Elena Alvarez", body: "Sounds like the score adds up across rounds. Try resetting the score inside the round loop.", timeLabel: "Jul 20, 3:40 PM" },
    ],
  },
  {
    id: "ov_4", subject: "First pod meeting", counterpart: "Diego Santos · Dev Kapoor", unread: false, lastLabel: "Jul 18",
    lastPreview: "See you Saturday at 10!",
    participants: [{ role: "student", name: "Diego Santos" }, { role: "mentor", name: "Dev Kapoor" }],
    msgs: [
      { id: "m1", who: "mentor", name: "Dev Kapoor", body: "Welcome to the pod, Diego! We meet Saturdays at 10. Bring a notebook.", timeLabel: "Jul 18, 11:00 AM" },
      { id: "m2", who: "student", name: "Diego Santos", body: "See you Saturday at 10!", timeLabel: "Jul 18, 12:15 PM" },
    ],
  },
  {
    id: "ov_5", subject: "Saturday pickup", counterpart: "Rohan Nair · Elena Alvarez", unread: false, lastLabel: "Jul 17",
    lastPreview: "Perfect, she's on the authorized list.",
    participants: [{ role: "parent", name: "Rohan Nair" }, { role: "mentor", name: "Elena Alvarez" }],
    msgs: [
      { id: "m1", who: "parent", name: "Rohan Nair", body: "Priya's aunt will pick her up this Saturday — is that okay?", timeLabel: "Jul 17, 2:00 PM" },
      { id: "m2", who: "mentor", name: "Elena Alvarez", body: "Perfect, she's on the authorized list. We'll check her in.", timeLabel: "Jul 17, 2:20 PM" },
    ],
  },
  {
    id: "ov_6", subject: "Family showcase night", counterpart: "Jordan Okafor · Dev Kapoor", unread: false, lastLabel: "Jul 16",
    lastPreview: "Yes — families are very welcome!",
    participants: [{ role: "parent", name: "Jordan Okafor" }, { role: "mentor", name: "Dev Kapoor" }],
    msgs: [
      { id: "m1", who: "parent", name: "Jordan Okafor", body: "Can Ari's grandparents come to the showcase night?", timeLabel: "Jul 16, 6:00 PM" },
      { id: "m2", who: "mentor", name: "Dev Kapoor", body: "Yes — families are very welcome! It's at 6pm in the lab.", timeLabel: "Jul 16, 6:30 PM" },
    ],
  },
];

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
