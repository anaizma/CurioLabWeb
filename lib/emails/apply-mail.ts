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

// ---------------------------------------------------------------------------
// The SUBMITTED-application notice.
//
// Two jobs, and the second is the important one:
//
//  1. It tells the director a completed application has arrived. Without it a
//     submission lands silently and is only seen by someone opening the portal.
//
//  2. It is an INDEPENDENT, OFF-SITE COPY of the submission. The full set of
//     answers is written into the message body, so every application also exists
//     in a mailbox that does not share failure modes with the application
//     database. If the database were lost between backups, each submission could
//     still be reconstructed from this mail.
//
// PRIVACY NOTE: because of (2) this message necessarily contains the child's
// details (name, date of birth, school) alongside the guardian's contact
// details. That is the same information the director already reads in the
// portal, sent to the director's own address — but it does place it in a mail
// provider. Set APPLICATION_EMAIL_INCLUDE_ANSWERS=false to reduce this message
// to a bare "an application arrived, open the portal" pointer, which keeps the
// notification and gives up the off-site copy.
// ---------------------------------------------------------------------------

export interface SubmittedAnswer {
  question: string;
  answer: string;
}

export interface ApplicationSubmittedInput {
  applicationId: string;
  /** The applicant's full name, for the subject line. */
  studentName: string | null;
  guardianName: string | null;
  guardianEmail: string | null;
  /** Parent (2A) answers, labelled against the stamped form. */
  parentAnswers: SubmittedAnswer[];
  /** Student (2B) answers, labelled against the stamped form. */
  studentAnswers: SubmittedAnswer[];
  /** Site origin used to build the portal link. */
  appUrl: string;
}

/** Whether the notice carries the answers themselves (see PRIVACY NOTE above). */
export function includeAnswersInSubmitEmail(): boolean {
  return process.env.APPLICATION_EMAIL_INCLUDE_ANSWERS !== "false";
}

export function buildApplicationSubmittedEmail(input: ApplicationSubmittedInput): BuiltEmail {
  const who = input.studentName?.trim() || "a new applicant";
  const detailUrl = `${input.appUrl}/portal/director/applications/${input.applicationId}`;
  const subject = `New CurioLab application: ${who}`;
  const withAnswers = includeAnswersInSubmitEmail();

  const textLines = [
    `A completed CurioLab application has been submitted for ${who}.`,
    "",
    `Guardian: ${input.guardianName ?? "-"}`,
    `Guardian email: ${input.guardianEmail ?? "-"}`,
    "",
    `Open it here:`,
    detailUrl,
  ];
  const htmlParts = [
    `<p>A completed CurioLab application has been submitted for <strong>${escapeHtml(who)}</strong>.</p>`,
    `<p><strong>Guardian:</strong> ${escapeHtml(input.guardianName ?? "-")}<br>`,
    `<strong>Guardian email:</strong> ${escapeHtml(input.guardianEmail ?? "-")}</p>`,
    `<p><a href="${detailUrl}">Open the application &rarr;</a></p>`,
  ];

  if (withAnswers) {
    const section = (title: string, rows: SubmittedAnswer[]) => {
      if (rows.length === 0) return;
      textLines.push("", `--- ${title} ---`);
      htmlParts.push(`<h3 style="margin-bottom:4px">${escapeHtml(title)}</h3>`);
      for (const r of rows) {
        textLines.push("", r.question, r.answer);
        htmlParts.push(
          `<p style="margin:0 0 10px 0"><span style="color:#666;font-size:12px">${escapeHtml(r.question)}</span><br>` +
            `${escapeHtml(r.answer).replace(/\n/g, "<br>")}</p>`,
        );
      }
    };
    htmlParts.push(
      '<hr style="border:none;border-top:1px solid #ddd;margin:20px 0">',
      '<p style="color:#666;font-size:12px">A full copy of the submission follows, so this message is also an off-site record of it.</p>',
    );
    textLines.push(
      "",
      "A full copy of the submission follows, so this message is also an off-site record of it.",
    );
    section("Parent / guardian section", input.parentAnswers);
    section("Student section", input.studentAnswers);
  }

  textLines.push("", "CurioLab");
  htmlParts.push("<p>CurioLab</p>");
  return { subject, text: textLines.join("\n"), html: htmlParts.join("") };
}

/**
 * Send the director the completed application. Throws on failure — the caller
 * treats it as best-effort, because the application row is already committed and
 * a mail failure must never turn a successful submit into an error for the family.
 */
export async function sendApplicationSubmittedNotification(
  input: ApplicationSubmittedInput,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const { subject, text, html } = buildApplicationSubmittedEmail(input);
  await new Resend(key).emails.send({ from: FROM, to: directorNotifyRecipient(), subject, text, html });
}
