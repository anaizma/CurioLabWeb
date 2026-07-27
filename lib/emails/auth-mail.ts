// Transactional email for the account-security flows: password reset, the
// "your password was changed" notice, and the new-device sign-in notice.
//
// Same shape as lib/emails/apply-mail.ts — Resend, the shared APPLY_FROM_EMAIL
// sender, a build* pair returning { subject, text, html } so the copy is testable
// without sending, and a send* wrapper that THROWS so the caller can decide
// whether the failure matters. It never does here: a password is already reset
// and a session is already minted by the time these run.
//
// Every link is built from a caller-supplied `appUrl` that comes from
// resolveAppUrl(req). Nothing in this file reads an env var for a URL.
//
// SECRET HANDLING: the reset token and the session-revoke token arrive here as
// arguments, are interpolated into exactly one link each, and are never logged.
// Only their SHA-256 hashes exist at rest.
import { Resend } from "resend";
import type { Sql } from "postgres";

const FROM = process.env.APPLY_FROM_EMAIL ?? "CurioLab <onboarding@resend.dev>";

/** Escape the five HTML-significant characters so no value can inject markup. */
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

async function send(to: string, mail: BuiltEmail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  await new Resend(key).emails.send({ from: FROM, to, subject: mail.subject, text: mail.text, html: mail.html });
}

/**
 * The token's remaining life, said the way a person would: "about 30 minutes",
 * "about 1 hour". Switches to hours at the hour mark rather than counting up to
 * 90, because the reset TTL is exactly an hour and "about 60 minutes" is a
 * strange way to say that. Floors at one minute so an already-stale token never
 * produces "about 0 minutes" or a negative.
 */
export function expiryPhrase(expiresAt: Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / 60000));
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

// ---- password reset --------------------------------------------------------

/**
 * The reset link. Says plainly that an unrequested message means someone typed
 * this address into the form and that ignoring it is safe, because the most
 * common recipient of a reset email is someone who did not ask for one.
 */
export function buildPasswordResetEmail(resetUrl: string, expiresAt: Date, now?: Date): BuiltEmail {
  const window = expiryPhrase(expiresAt, now);
  const subject = "Reset your CurioLab password";
  const text = [
    "Someone asked to reset the password on your CurioLab account.",
    "",
    "Set a new password here:",
    resetUrl,
    "",
    `This link works once and expires in ${window}.`,
    "",
    "If you did not ask for this, you can ignore this email. Your password has not",
    "changed and nobody can use this link without opening it from your inbox.",
    "",
    "CurioLab",
  ].join("\n");
  const html = [
    "<p>Someone asked to reset the password on your CurioLab account.</p>",
    `<p><a href="${resetUrl}">Set a new password &rarr;</a></p>`,
    `<p style="color:#666;font-size:12px">This link works once and expires in ${escapeHtml(window)}.</p>`,
    '<p style="color:#666;font-size:12px">If you did not ask for this, you can ignore this email. Your password has not changed, and nobody can use this link without opening it from your inbox.</p>',
    "<p>CurioLab</p>",
  ].join("");
  return { subject, text, html };
}

/** Send the reset link. Throws on failure; the caller keeps its response uniform. */
export async function sendPasswordResetEmail(to: string, resetUrl: string, expiresAt: Date): Promise<void> {
  await send(to, buildPasswordResetEmail(resetUrl, expiresAt));
}

// ---- password changed ------------------------------------------------------

/**
 * The after-the-fact notice. This is the message that makes an UNAUTHORIZED reset
 * visible: whoever completed the reset held the mailbox at that moment, but the
 * real owner still receives something they did not ask for, and it tells them the
 * one thing that helps (every session was signed out, so regaining the mailbox is
 * enough to take the account back).
 */
export function buildPasswordChangedEmail(at: Date, resetUrl: string): BuiltEmail {
  const when = at.toUTCString();
  const subject = "Your CurioLab password was changed";
  const text = [
    "The password on your CurioLab account was just changed.",
    "",
    `When: ${when}`,
    "",
    "Every device that was signed in has been signed out, so anyone using the old",
    "password no longer has access.",
    "",
    "If this was you, nothing else is needed.",
    "",
    "If this was NOT you, reset your password immediately and then contact us:",
    resetUrl,
    "",
    "CurioLab",
  ].join("\n");
  const html = [
    "<p>The password on your CurioLab account was just changed.</p>",
    `<p><strong>When:</strong> ${escapeHtml(when)}</p>`,
    "<p>Every device that was signed in has been signed out, so anyone using the old password no longer has access.</p>",
    "<p>If this was you, nothing else is needed.</p>",
    `<p>If this was <strong>not</strong> you, <a href="${resetUrl}">reset your password immediately</a> and then contact us.</p>`,
    "<p>CurioLab</p>",
  ].join("");
  return { subject, text, html };
}

export async function sendPasswordChangedEmail(to: string, at: Date, resetUrl: string): Promise<void> {
  await send(to, buildPasswordChangedEmail(at, resetUrl));
}

// ---- new-device sign-in ----------------------------------------------------

export interface NewSignInEmailInput {
  at: Date;
  /** Coarse device descriptor ("Chrome on Windows"), or null when unrecognised. */
  deviceLabel: string | null;
  /** The coarse client network (IPv4 /24, IPv6 /48), or null. */
  ipHint: string | null;
  /** The page that revokes exactly this session. */
  revokeUrl: string;
}

/**
 * The new-device notice. Deliberately honest about how coarse the details are: we
 * report the network, not a city, because we do not do geolocation and a
 * confident-sounding "Cleveland, OH" we cannot stand behind is worse than a plain
 * network prefix. "Unrecognised device" is likewise better than guessing.
 */
export function buildNewSignInEmail(input: NewSignInEmailInput): BuiltEmail {
  const when = input.at.toUTCString();
  const device = input.deviceLabel ?? "Unrecognised device";
  const network = input.ipHint ?? "Unknown network";
  const subject = "New sign-in to your CurioLab account";
  const text = [
    "Your CurioLab account was just signed in from a device it has not been used on before.",
    "",
    `When: ${when}`,
    `Device: ${device}`,
    `Network: ${network}`,
    "",
    "(We record the network a sign-in came from, not a precise location.)",
    "",
    "If this was you, nothing else is needed.",
    "",
    "If this was NOT you, end that session now:",
    input.revokeUrl,
    "",
    "Then change your password. If your account uses an authenticator app, whoever",
    "signed in also had a valid code, so treat the device holding it as compromised.",
    "",
    "CurioLab",
  ].join("\n");
  const html = [
    "<p>Your CurioLab account was just signed in from a device it has not been used on before.</p>",
    `<p><strong>When:</strong> ${escapeHtml(when)}<br>`,
    `<strong>Device:</strong> ${escapeHtml(device)}<br>`,
    `<strong>Network:</strong> ${escapeHtml(network)}</p>`,
    '<p style="color:#666;font-size:12px">We record the network a sign-in came from, not a precise location.</p>',
    "<p>If this was you, nothing else is needed.</p>",
    `<p>If this was <strong>not</strong> you, <a href="${input.revokeUrl}">end that session now</a>, then change your password. If your account uses an authenticator app, whoever signed in also had a valid code, so treat the device holding it as compromised.</p>`,
    "<p>CurioLab</p>",
  ].join("");
  return { subject, text, html };
}

export async function sendNewSignInEmail(to: string, input: NewSignInEmailInput): Promise<void> {
  await send(to, buildNewSignInEmail(input));
}

// ---- recipient lookup ------------------------------------------------------

/**
 * The address these notices go to: the account's OWN email, or null when it has
 * none. A student account is identified by a username and deliberately has no
 * email (a minor is not directly contactable), so null is the normal, correct
 * answer for a child and the caller must simply not send. Guardian-routed
 * delivery for a minor is a separate flow and is not built here.
 */
export async function accountEmail(sql: Sql, accountId: string): Promise<string | null> {
  const [row] = await sql`select email from account where id = ${accountId}`;
  const email = (row?.email as string | null) ?? null;
  return email !== null && email !== "" ? email : null;
}
