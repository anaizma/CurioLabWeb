// -------------------------------------------------------------------------
// Public newsletter subscribe/confirm/unsubscribe controllers — Milestone 3.6
// (05-api-surface.md "Public site": POST /public/newsletter/subscribe (double
// opt-in), GET /public/newsletter/unsubscribe/:token, plus the confirm step the
// double opt-in requires).
//
// All three are UNAUTHENTICATED and actor-less (05-api-surface.md the enumerated
// inert set): thin wrappers over SubscriberService run under `runPublic`. The
// raw confirm/unsubscribe tokens are the MAILER's seam — they are returned by the
// service to the edge that sends the email, and are NEVER surfaced in an HTTP
// response body. subscribe answers 202 (accepted, pending confirmation); confirm
// and unsubscribe answer 200. An unknown/forged token is one opaque 401
// (InvalidSubscriberTokenError -> respond.ts), revealing nothing.
// -------------------------------------------------------------------------

import { SubscriberService } from '@curiolab/app'
import { runPublic } from '../run.js'
import { optStr, reqStr } from '../respond.js'
import type { ControllerResult, PublicInputBase } from '../types.js'

export interface SubscribeNewsletterInput extends PublicInputBase {
  body: { email?: unknown; source?: unknown }
}

export interface SubscribeNewsletterResult {
  subscriberId: string
  alreadySubscribed: boolean
}

/**
 * POST /public/newsletter/subscribe — the inert double-opt-in write. Returns
 * 202 with only `{ subscriberId, alreadySubscribed }`; the confirm token stays
 * server-side (emailed, never returned). A missing email is a 400 (reqStr).
 */
export function subscribeNewsletter(
  input: SubscribeNewsletterInput,
): Promise<ControllerResult<SubscribeNewsletterResult>> {
  return runPublic(async () => {
    const email = reqStr(input.body?.email, 'email')
    const source = optStr(input.body?.source)
    const r = await new SubscriberService({ sql: input.sql }).subscribe({ email, source })
    return {
      status: 202,
      body: { subscriberId: r.subscriberId, alreadySubscribed: r.alreadySubscribed },
    }
  })
}

export interface NewsletterTokenInput extends PublicInputBase {
  params: { token?: unknown }
}

/** GET /public/newsletter/confirm/:token — activate a pending subscriber. */
export function confirmNewsletter(
  input: NewsletterTokenInput,
): Promise<ControllerResult<{ confirmed: true }>> {
  return runPublic(async () => {
    const token = reqStr(input.params?.token, 'token')
    await new SubscriberService({ sql: input.sql }).confirm(token)
    return { status: 200, body: { confirmed: true } }
  })
}

/** GET /public/newsletter/unsubscribe/:token — flip one subscriber row. */
export function unsubscribeNewsletter(
  input: NewsletterTokenInput,
): Promise<ControllerResult<{ unsubscribed: true }>> {
  return runPublic(async () => {
    const token = reqStr(input.params?.token, 'token')
    await new SubscriberService({ sql: input.sql }).unsubscribe(token)
    return { status: 200, body: { unsubscribed: true } }
  })
}
