// -------------------------------------------------------------------------
// Mailer — the backend's transactional-email seam (milestone-1 application
// funnel). The application-service layer stays framework-agnostic: it depends
// on the small `Mailer` interface below and never on Resend directly, so tests
// inject a `FakeMailer` and a deployment with no Resend key still runs.
//
// SANDBOX SENDER CAVEAT: the default from-address `onboarding@resend.dev` is
// Resend's shared sandbox sender — it ONLY delivers to the Resend account
// owner's own verified address. Until a real domain is verified in Resend and
// `APPLY_FROM_EMAIL` is set to an address on it, mail to any other recipient is
// accepted by the API but not delivered. Set `APPLY_FROM_EMAIL` (config.ts) to
// override the from-address once a domain is verified.
// -------------------------------------------------------------------------

import { Resend } from 'resend'
import type { CreateEmailOptions } from 'resend'
import { APPLY_FROM_EMAIL } from './config.js'

/** One transactional message. `html` and/or `text` carries the body. */
export interface MailMessage {
  to: string
  subject: string
  html?: string
  text?: string
}

/** The narrow seam every service depends on: send one message. */
export interface Mailer {
  send(message: MailMessage): Promise<void>
}

/**
 * The real mailer, backed by the installed `resend` package. `from` is the
 * verified (or sandbox) sender; see the SANDBOX SENDER CAVEAT above.
 */
export class ResendMailer implements Mailer {
  private readonly resend: Resend
  private readonly from: string

  constructor(apiKey: string, from: string) {
    this.resend = new Resend(apiKey)
    this.from = from
  }

  async send(message: MailMessage): Promise<void> {
    // Resend requires at least one of html/text; the callers always supply text.
    const payload = {
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    } as CreateEmailOptions
    await this.resend.emails.send(payload)
  }
}

/**
 * The no-key fallback: it does NOT send — it logs the intent so the funnel runs
 * end to end without a Resend key (a fresh dev/CI environment, or before the
 * secret is provisioned). `defaultMailer()` selects this when `RESEND_API_KEY`
 * is unset.
 */
export class NoopMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    console.info(`[NoopMailer] would send to=${message.to} subject=${JSON.stringify(message.subject)} (RESEND_API_KEY unset)`)
    return Promise.resolve()
  }
}

/** A test double: records every send, sends nothing. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = []

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message)
    return Promise.resolve()
  }
}

/**
 * Select the mailer from the environment: a `ResendMailer` when `RESEND_API_KEY`
 * is set (from-address = `APPLY_FROM_EMAIL`, default `onboarding@resend.dev`),
 * otherwise a `NoopMailer` so the system runs with no key. This is the default
 * the services fall back to when no mailer is injected, so the frontend's
 * `/api/apply` route triggers the backend emails with no wiring change while
 * tests inject a `FakeMailer`.
 */
export function defaultMailer(fromAddress: string = APPLY_FROM_EMAIL): Mailer {
  const apiKey = process.env.RESEND_API_KEY
  if (apiKey === undefined || apiKey === '') return new NoopMailer()
  return new ResendMailer(apiKey, fromAddress)
}
