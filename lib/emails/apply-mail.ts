// Transactional email for the apply funnel (frontend-owned Stage 1).
// Uses Resend, matching app/api/contact/route.ts. Sender defaults to the
// Resend sandbox address, which only delivers to the Resend account's own
// verified email until a domain is verified — set APPLY_FROM_EMAIL to a
// verified "Name <addr@your-domain>" for real delivery to any parent.
import { Resend } from "resend";

const FROM = process.env.APPLY_FROM_EMAIL ?? "CurioLab <onboarding@resend.dev>";

/** Escape the five HTML-significant characters so untrusted form input can't inject markup. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** The Stage-1 "continue your application" email a parent-filler receives. */
export function buildParentContinueEmail(continueUrl: string): BuiltEmail {
  const subject = "Continue your CurioLab application";
  const text = [
    "Thanks for starting an application with CurioLab.",
    "",
    "Pick up where you left off — open your application here:",
    continueUrl,
    "",
    "If you did not start this, you can safely ignore this email.",
    "",
    "— CurioLab",
  ].join("\n");
  const html = [
    "<p>Thanks for starting an application with CurioLab.</p>",
    `<p><a href="${continueUrl}">Continue your application &rarr;</a></p>`,
    '<p style="color:#666;font-size:12px">If you did not start this, you can safely ignore this email.</p>',
    "<p>&mdash; CurioLab</p>",
  ].join("");
  return { subject, text, html };
}

/**
 * Send the parent their continue link. Throws on failure (Resend error or a
 * missing key) — the caller treats sending as best-effort so a delivery
 * failure never loses the already-created lead.
 */
export async function sendParentContinueEmail(to: string, continueUrl: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const { subject, text, html } = buildParentContinueEmail(continueUrl);
  await new Resend(key).emails.send({ from: FROM, to, subject, text, html });
}

export interface DirectorLeadNotificationInput {
  /** The parent/guardian email captured on the Apply form. */
  leadEmail: string;
  /** The selected chapter CODE (may be "another-school"). */
  chapter: string;
  /** Who filled Stage 1. */
  fillerRole: "parent" | "student";
  /** "How did you hear" (optional). */
  source: string | null;
  /** Site origin used to build the applications-page link. */
  appUrl: string;
}

/** The internal "someone applied" alert sent to the director on every fresh lead. */
export function buildDirectorLeadNotification(input: DirectorLeadNotificationInput): BuiltEmail {
  const applicationsUrl = `${input.appUrl}/portal/director/applications`;
  const source = input.source && input.source.trim() ? input.source.trim() : "-";
  const subject = `New CurioLab lead: ${input.leadEmail}`;
  const text = [
    "Someone just started an application on CurioLab.",
    "",
    `Email: ${input.leadEmail}`,
    `Chapter: ${input.chapter}`,
    `Started by: ${input.fillerRole}`,
    `How did you hear: ${source}`,
    "",
    "They show up as Interested in the applications list until they finish:",
    applicationsUrl,
    "",
    "CurioLab",
  ].join("\n");
  const html = [
    "<p>Someone just started an application on CurioLab.</p>",
    `<p><strong>Email:</strong> ${escapeHtml(input.leadEmail)}<br>`,
    `<strong>Chapter:</strong> ${escapeHtml(input.chapter)}<br>`,
    `<strong>Started by:</strong> ${input.fillerRole}<br>`,
    `<strong>How did you hear:</strong> ${escapeHtml(source)}</p>`,
    `<p>They show up as Interested in the applications list until they finish:<br>`,
    `<a href="${applicationsUrl}">${applicationsUrl}</a></p>`,
    "<p>CurioLab</p>",
  ].join("");
  return { subject, text, html };
}

/**
 * The recipient of the director notification: DIRECTOR_NOTIFY_EMAIL, or the
 * director's address as the default. Exported for reuse by the route.
 */
export function directorNotifyRecipient(): string {
  return process.env.DIRECTOR_NOTIFY_EMAIL ?? "esong@acuriolab.org";
}

/**
 * Send the director the "someone applied" alert. Throws on failure (Resend error
 * or missing key) — the caller treats sending as best-effort so a delivery
 * failure never loses the already-created lead.
 */
export async function sendDirectorLeadNotification(input: DirectorLeadNotificationInput): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const { subject, text, html } = buildDirectorLeadNotification(input);
  await new Resend(key).emails.send({ from: FROM, to: directorNotifyRecipient(), subject, text, html });
}
