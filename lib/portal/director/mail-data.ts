import { getDirectorContext } from "./session";

export type MailRole = "me" | "staff" | "mentor" | "student" | "parent" | "guardian";

export interface DirMsg {
  id: string;
  who: MailRole;
  name: string;
  body: string;
  timeLabel: string;
}

export type OversightRole = "mentor" | "student" | "parent";
export interface OversightParticipant {
  role: OversightRole;
  name: string;
}

export interface DirThread {
  id: string;
  subject: string;
  counterpart: string;
  msgs: DirMsg[];
  lastPreview: string;
  lastLabel: string;
  unread: boolean;
  /** Present on oversight threads: who is talking, tagged by role, for search/filter. */
  participants?: OversightParticipant[];
}

export interface DirMailView {
  /** Director's own conversations with parents and members. */
  inbox: DirThread[];
  sent: DirThread[];
  /** Read-only monitoring of mentor ↔ student ↔ parent conversations across the chapter. */
  oversight: DirThread[];
  /** Live inbox/sent (POST reply is wired). Oversight is always representative for now. */
  live: boolean;
  isSample: boolean;
}

function fmt(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---- representative data ---------------------------------------------------

const SAMPLE_INBOX: DirThread[] = [
  {
    id: "in_1", subject: "Session the week of the 28th?", counterpart: "R. Nair (Parent)", unread: true, lastLabel: "Sun 2:00 PM",
    lastPreview: "Is there a session the week of the 28th?",
    msgs: [
      { id: "m1", who: "parent", name: "R. Nair", body: "Is there a session the week of the 28th? Priya has a recital that Saturday.", timeLabel: "Sun 2:00 PM" },
    ],
  },
  {
    id: "in_2", subject: "USB-C cable / thanks", counterpart: "J. Okafor (Parent)", unread: false, lastLabel: "Mon 6:40 PM",
    lastPreview: "Thanks so much! We'll pack one.",
    msgs: [
      { id: "m1", who: "me", name: "You", body: "Ari did great building the sensor circuit today — bring a USB-C cable next Saturday if you have one.", timeLabel: "Mon 4:12 PM" },
      { id: "m2", who: "parent", name: "J. Okafor", body: "Thanks so much! We'll pack one.", timeLabel: "Mon 6:40 PM" },
    ],
  },
  {
    id: "in_3", subject: "Pod roster question", counterpart: "Ms. Alvarez (Mentor)", unread: false, lastLabel: "Jul 22",
    lastPreview: "Can I move Diego into my Saturday pod?",
    msgs: [
      { id: "m1", who: "mentor", name: "Ms. Alvarez (Mentor)", body: "Can I move Diego into my Saturday pod? He and Ari are already collaborating.", timeLabel: "Jul 22, 1:10 PM" },
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
    id: "sent_2", subject: "Newsletter assignments", counterpart: "Dev K. (Mentor)", unread: false, lastLabel: "Jul 15",
    lastPreview: "Can you collect two build-log posts from your pod this week?",
    msgs: [
      { id: "m1", who: "me", name: "You", body: "Can you collect two build-log posts from your pod this week for the newsletter?", timeLabel: "Jul 15, 9:30 AM" },
      { id: "m2", who: "mentor", name: "Dev K. (Mentor)", body: "On it — Ari's is ready, I'll get one more.", timeLabel: "Jul 15, 6:12 PM" },
    ],
  },
];

const SAMPLE_OVERSIGHT: DirThread[] = [
  {
    id: "ov_1", subject: "Recycling robot — sensor help", counterpart: "Ari ↔ Ms. Alvarez", unread: false, lastLabel: "Jul 22",
    lastPreview: "That fixed it!! The readings are steady now.",
    participants: [{ role: "student", name: "Ari Okafor" }, { role: "mentor", name: "Ms. Alvarez" }],
    msgs: [
      { id: "m1", who: "student", name: "Ari", body: "My IR sensor keeps giving random values when the motor runs. Is it broken?", timeLabel: "Jul 21, 5:20 PM" },
      { id: "m2", who: "mentor", name: "Ms. Alvarez (Mentor)", body: "Not broken — that's motor noise. Move the IR sensor away from the motor and twist the signal wires together.", timeLabel: "Jul 21, 6:05 PM" },
      { id: "m3", who: "student", name: "Ari", body: "That fixed it!! The readings are steady now.", timeLabel: "Jul 22, 4:44 PM" },
    ],
  },
  {
    id: "ov_2", subject: "Newsletter draft feedback", counterpart: "Ari ↔ Dev K.", unread: false, lastLabel: "Jul 15",
    lastPreview: "Second draft reads great — submitting it.",
    participants: [{ role: "student", name: "Ari Okafor" }, { role: "mentor", name: "Dev K." }],
    msgs: [
      { id: "m1", who: "mentor", name: "Dev K. (Mentor)", body: "Your build-log post is a great newsletter candidate. Add a line about what you'd do differently?", timeLabel: "Jul 14, 7:10 PM" },
      { id: "m2", who: "student", name: "Ari", body: "Added it — and a photo of the wiring.", timeLabel: "Jul 15, 4:30 PM" },
      { id: "m3", who: "mentor", name: "Dev K. (Mentor)", body: "Second draft reads great — submitting it.", timeLabel: "Jul 15, 6:12 PM" },
    ],
  },
  {
    id: "ov_3", subject: "Fractions game — scoring bug", counterpart: "Priya ↔ Ms. Alvarez", unread: false, lastLabel: "Jul 20",
    lastPreview: "Try resetting the score inside the round loop.",
    participants: [{ role: "student", name: "Priya Nair" }, { role: "mentor", name: "Ms. Alvarez" }],
    msgs: [
      { id: "m1", who: "student", name: "Priya", body: "My score keeps doubling every round. I can't find where.", timeLabel: "Jul 20, 3:00 PM" },
      { id: "m2", who: "mentor", name: "Ms. Alvarez (Mentor)", body: "Sounds like the score adds up across rounds. Try resetting the score inside the round loop.", timeLabel: "Jul 20, 3:40 PM" },
    ],
  },
  {
    id: "ov_4", subject: "First pod meeting", counterpart: "Diego ↔ Dev K.", unread: false, lastLabel: "Jul 18",
    lastPreview: "See you Saturday at 10!",
    participants: [{ role: "student", name: "Diego Santos" }, { role: "mentor", name: "Dev K." }],
    msgs: [
      { id: "m1", who: "mentor", name: "Dev K. (Mentor)", body: "Welcome to the pod, Diego! We meet Saturdays at 10. Bring a notebook.", timeLabel: "Jul 18, 11:00 AM" },
      { id: "m2", who: "student", name: "Diego", body: "See you Saturday at 10!", timeLabel: "Jul 18, 12:15 PM" },
    ],
  },
  {
    id: "ov_5", subject: "Saturday pickup", counterpart: "R. Nair ↔ Ms. Alvarez", unread: false, lastLabel: "Jul 17",
    lastPreview: "Perfect, she's on the authorized list.",
    participants: [{ role: "parent", name: "R. Nair" }, { role: "mentor", name: "Ms. Alvarez" }],
    msgs: [
      { id: "m1", who: "parent", name: "R. Nair", body: "Priya's aunt will pick her up this Saturday — is that okay?", timeLabel: "Jul 17, 2:00 PM" },
      { id: "m2", who: "mentor", name: "Ms. Alvarez (Mentor)", body: "Perfect, she's on the authorized list. We'll check her in.", timeLabel: "Jul 17, 2:20 PM" },
    ],
  },
  {
    id: "ov_6", subject: "Family showcase night", counterpart: "J. Okafor ↔ Dev K.", unread: false, lastLabel: "Jul 16",
    lastPreview: "Yes — families are very welcome!",
    participants: [{ role: "parent", name: "J. Okafor" }, { role: "mentor", name: "Dev K." }],
    msgs: [
      { id: "m1", who: "parent", name: "J. Okafor", body: "Can Ari's grandparents come to the showcase night?", timeLabel: "Jul 16, 6:00 PM" },
      { id: "m2", who: "mentor", name: "Dev K. (Mentor)", body: "Yes — families are very welcome! It's at 6pm in the lab.", timeLabel: "Jul 16, 6:30 PM" },
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
        msgs,
        lastPreview: last ? last.body.slice(0, 80) : "",
        lastLabel: last?.timeLabel ?? "",
        unread: false,
      };
    });
    const sent = threads.filter((t) => t.msgs.some((m) => m.who === "me"));
    // No live oversight endpoint yet — keep the representative monitoring view.
    return { inbox: threads, sent, oversight: SAMPLE_OVERSIGHT, live: true, isSample: false };
  } catch {
    return FALLBACK;
  }
}
