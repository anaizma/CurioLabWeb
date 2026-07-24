// Transactional email for CurioLab invites (frontend-owned delivery — §12 of the
// backend handoff). Mirrors lib/emails/apply-mail.ts: Resend, APPLY_FROM_EMAIL
// sender. The backend issues the token; the frontend emails the link, so the
// backend needs no mailer integration.
import { Resend } from "resend";

const FROM = process.env.APPLY_FROM_EMAIL ?? "CurioLab <onboarding@resend.dev>";

export type InviteKind = "guardian" | "mentor" | "staff" | "director" | "admin";

const ROLE_PHRASE: Record<InviteKind, string> = {
  guardian: "a parent/guardian",
  mentor: "a mentor",
  staff: "a staff member",
  director: "a chapter director",
  admin: "an administrator",
};

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** The account-creation email an invitee receives. The URL carries only the
 *  opaque token — no name or email — so nothing identifying is in the link. */
export function buildInviteEmail(kind: InviteKind, inviteUrl: string): BuiltEmail {
  const role = ROLE_PHRASE[kind] ?? "a member";
  const subject = "Your CurioLab invitation";
  const text = [
    `You've been invited to join CurioLab as ${role}.`,
    "",
    "Create your account here:",
    inviteUrl,
    "",
    "This link is single-use and will expire. If you weren't expecting this, you can safely ignore this email.",
    "",
    "— CurioLab",
  ].join("\n");
  const html = [
    `<p>You've been invited to join CurioLab as ${role}.</p>`,
    `<p><a href="${inviteUrl}">Create your account &rarr;</a></p>`,
    '<p style="color:#666;font-size:12px">This link is single-use and will expire. If you weren\'t expecting this, you can safely ignore this email.</p>',
    "<p>&mdash; CurioLab</p>",
  ].join("");
  return { subject, text, html };
}

/** Email an invitee their account-creation link. Throws on failure (missing key
 *  or Resend error) — callers treat sending as best-effort so a delivery failure
 *  never undoes an already-issued invite. */
export async function sendInviteEmail(to: string, kind: InviteKind, inviteUrl: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const { subject, text, html } = buildInviteEmail(kind, inviteUrl);
  await new Resend(key).emails.send({ from: FROM, to, subject, text, html });
}
