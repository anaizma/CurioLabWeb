// Transactional email for the apply funnel (frontend-owned Stage 1).
// Uses Resend, matching app/api/contact/route.ts. Sender defaults to the
// Resend sandbox address, which only delivers to the Resend account's own
// verified email until a domain is verified — set APPLY_FROM_EMAIL to a
// verified "Name <addr@your-domain>" for real delivery to any parent.
import { Resend } from "resend";

const FROM = process.env.APPLY_FROM_EMAIL ?? "CurioLab <onboarding@resend.dev>";

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
