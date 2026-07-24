import { cookies, headers } from "next/headers";
import type { ChatMessage } from "./types";

export interface GuardianMessagesView {
  threadId: string | null;
  messages: ChatMessage[];
  live: boolean;
  isSample: boolean;
}

const SAMPLE_MESSAGES: ChatMessage[] = [
  { id: "m1", who: "them", name: "Ms. Alvarez (Mentor)", text: "Hi! Ari did great building the sensor circuit today — bring a USB-C cable next Saturday if you have one.", timeLabel: "Mon 4:12 PM" },
  { id: "m2", who: "me", name: "You", text: "Thanks so much! We'll pack one. Quick question — is there a session the week of the 28th?", timeLabel: "Mon 6:40 PM" },
  { id: "m3", who: "them", name: "Dr. Okoro (Director)", text: "Yes — Saturday as usual that week. I'll post the assignment on Sunday.", timeLabel: "Mon 7:05 PM" },
];

function fmt(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

export async function getGuardianMessages(): Promise<GuardianMessagesView> {
  try {
    const session = (await cookies()).get("cl_session");
    if (!session) return { threadId: null, messages: SAMPLE_MESSAGES, live: false, isSample: true };
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return { threadId: null, messages: SAMPLE_MESSAGES, live: false, isSample: true };
    const cookie = `cl_session=${session.value}`;
    const res = await fetch(`${origin}/api/guardian/messages`, { headers: { cookie }, cache: "no-store" });
    if (!res.ok) return { threadId: null, messages: SAMPLE_MESSAGES, live: false, isSample: true };
    const data = (await res.json()) as { items?: { id?: string; messages?: { id?: string; senderRole?: string; senderName?: string; body?: string; sentAt?: string }[] }[] };
    const first = (data.items ?? [])[0];
    const messages: ChatMessage[] = (first?.messages ?? []).map((m, i) => ({
      id: m.id ?? `m${i}`,
      who: m.senderRole === "guardian" ? "me" : "them",
      name: m.senderRole === "guardian" ? "You" : (m.senderName ?? "CurioLab team"),
      text: m.body ?? "",
      timeLabel: fmt(m.sentAt),
    }));
    return { threadId: first?.id ?? null, messages, live: true, isSample: false };
  } catch {
    return { threadId: null, messages: SAMPLE_MESSAGES, live: false, isSample: true };
  }
}
