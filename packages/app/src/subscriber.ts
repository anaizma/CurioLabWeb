// -------------------------------------------------------------------------
// SubscriberService — Milestone 3.6: the newsletter subscriber list behind the
// unauthenticated write set (05-api-surface.md): POST /public/newsletter/
// subscribe (double opt-in), the confirm step, and
// GET /public/newsletter/unsubscribe/:token.
//
// This is one of the enumerated actor-less INERT endpoints (05-api-surface.md):
// no AuthContext, never calls `authorize`, writes ONLY to the subscriber list,
// and creates only a row that carries no authority and cannot be escalated.
// Modeled on LeadService (the Stage-1 inert write): the db handle is injected;
// rate limiting and the bot check are HTTP-layer concerns, deferred.
//
// Double opt-in: subscribe creates a PENDING subscriber (confirm_token_hash set,
// confirmed_at null) and returns the raw confirm token — the mailer's seam. Only
// the SHA-256 hash of the confirm and unsubscribe tokens is stored (tokens.ts);
// the raw tokens never touch the database beyond being returned to the caller.
// confirm activates the subscriber (sets confirmed_at); unsubscribe sets
// unsubscribed_at. Both are token-gated (a timing-safe hash compare) and
// idempotent. A second subscribe for a LIVE email (unsubscribed_at IS NULL) is a
// no-op — the partial-unique index (email) WHERE unsubscribed_at IS NULL is the
// idempotency floor, and an unsubscribe frees the slot for a later re-subscribe.
// delivery_status (active|bounced|complained) is a SEPARATE axis, fed only by
// the Resend webhook, never touched here.
// -------------------------------------------------------------------------

import { timingSafeEqual } from 'node:crypto'
import type { Sql } from 'postgres'
import { generateSessionToken, hashToken } from '@curiolab/runtime'
import { InvalidSubscriberTokenError } from './errors.js'

export interface SubscriberServiceDeps {
  sql: Sql
}

export interface SubscribeInput {
  email: string
  /** Where the subscriber signed up (footer form, etc.); optional. */
  source?: string | null
}

export interface SubscribeResult {
  subscriberId: string
  /**
   * The raw confirm token (the mailer's seam) on a FRESH subscribe; null on the
   * idempotent path (a live subscriber already exists — no new token is minted).
   */
  confirmToken: string | null
  /** The raw unsubscribe token (the link in every send); null on the idempotent path. */
  unsubscribeToken: string | null
  /** True when a live subscriber already existed and no new row was created. */
  alreadySubscribed: boolean
}

export interface ConfirmResult {
  subscriberId: string
  /** True once the subscriber is confirmed (idempotent — a replay is still true). */
  confirmed: boolean
}

export interface UnsubscribeResult {
  subscriberId: string
  /** True once the subscriber is unsubscribed (idempotent — a replay is still true). */
  unsubscribed: boolean
}

export class SubscriberService {
  private readonly sql: Sql

  constructor(deps: SubscriberServiceDeps) {
    this.sql = deps.sql
  }

  /**
   * The unauthenticated, INERT double-opt-in write. If a LIVE subscriber already
   * exists for this email (unsubscribed_at IS NULL) it is a no-op returning
   * `alreadySubscribed` — the partial-unique index is the floor. Otherwise it
   * mints a confirm and an unsubscribe token (storing only their hashes), inserts
   * one PENDING subscriber (confirmed_at null, delivery_status 'active'), and
   * returns the raw confirm token. Creates NO account. Safe with no AuthContext.
   */
  async subscribe(input: SubscribeInput): Promise<SubscribeResult> {
    const source = input.source ?? null

    // Idempotency floor: a live subscriber (citext email, case-insensitive) with
    // no unsubscribed_at already holds the unique slot. An unsubscribed row does
    // not count, so a re-subscribe after unsubscribe starts a fresh live row.
    const [existing] = await this.sql`
      select id from newsletter_subscriber
      where email = ${input.email} and unsubscribed_at is null
      limit 1
    `
    if (existing !== undefined) {
      return {
        subscriberId: existing.id as string,
        confirmToken: null,
        unsubscribeToken: null,
        alreadySubscribed: true,
      }
    }

    const confirmToken = generateSessionToken()
    const unsubscribeToken = generateSessionToken()

    const [row] = await this.sql`
      insert into newsletter_subscriber (
        email, source, confirm_token_hash, unsubscribe_token_hash
      ) values (
        ${input.email}, ${source}, ${hashToken(confirmToken)}, ${hashToken(unsubscribeToken)}
      ) returning id
    `
    return {
      subscriberId: row!.id as string,
      confirmToken,
      unsubscribeToken,
      alreadySubscribed: false,
    }
  }

  /**
   * The double-opt-in activation. Resolves the subscriber by confirm-token hash
   * (a defensive timing-safe compare on top of the index probe) and stamps
   * confirmed_at once. Idempotent: a second confirm leaves the original timestamp
   * in place. An unknown token is one opaque error (reveals nothing).
   */
  async confirm(token: string): Promise<ConfirmResult> {
    const tokenHash = hashToken(token)
    const [row] = await this.sql`
      select id, confirm_token_hash, confirmed_at
      from newsletter_subscriber where confirm_token_hash = ${tokenHash}
    `
    if (row === undefined || !hashesEqual(row.confirm_token_hash as string, tokenHash)) {
      throw new InvalidSubscriberTokenError()
    }
    const subscriberId = row.id as string
    // Idempotent: only stamp confirmed_at when it is still null.
    if (row.confirmed_at === null) {
      await this.sql`
        update newsletter_subscriber set confirmed_at = now()
        where id = ${subscriberId} and confirmed_at is null
      `
    }
    return { subscriberId, confirmed: true }
  }

  /**
   * The token-gated unsubscribe (GET /public/newsletter/unsubscribe/:token).
   * Resolves the subscriber by unsubscribe-token hash and stamps unsubscribed_at
   * once. Idempotent: a second call leaves the original timestamp in place. An
   * unknown token is one opaque error.
   */
  async unsubscribe(token: string): Promise<UnsubscribeResult> {
    const tokenHash = hashToken(token)
    const [row] = await this.sql`
      select id, unsubscribe_token_hash, unsubscribed_at
      from newsletter_subscriber where unsubscribe_token_hash = ${tokenHash}
    `
    if (row === undefined || !hashesEqual(row.unsubscribe_token_hash as string, tokenHash)) {
      throw new InvalidSubscriberTokenError()
    }
    const subscriberId = row.id as string
    // Idempotent: only stamp unsubscribed_at when it is still null.
    if (row.unsubscribed_at === null) {
      await this.sql`
        update newsletter_subscriber set unsubscribed_at = now()
        where id = ${subscriberId} and unsubscribed_at is null
      `
    }
    return { subscriberId, unsubscribed: true }
  }
}

/** Constant-time equality for two equal-length hex digest strings. */
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
