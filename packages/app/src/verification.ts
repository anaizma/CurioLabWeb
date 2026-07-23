// -------------------------------------------------------------------------
// VerificationService — Milestone 3.3: the revocable, unguessable verification
// URL behind the public GET /verify/:token, and its regenerate path
// (02-data-model.md verification_token; 03-authorization.md
// verification.regenerate; 04-state-machines.md the verification-URL rules).
//
//   - regenerate(subjectAccountId, ctx): verification.regenerate (scope own or
//     guardian). Mints a fresh CSPRNG token (the SAME generate+hash the session
//     tokens use — the plaintext is returned ONCE and only its SHA-256 hash is
//     stored) and REVOKES the prior live token, so the old link stops resolving.
//     The `one_live_per_subject` partial-unique index enforces at most one live
//     token; the revoke-then-insert order keeps within it.
//
//   - view(token): the PUBLIC, unauthenticated, token-gated read. It returns the
//     MINIMAL verified record (display name = first name + last initial, tier
//     reached, verified project titles + dates, mentor hours) ONLY when the
//     subject's public_profile consent is CURRENTLY active. When the token is
//     unknown, revoked, or public_profile is inactive, it returns an IDENTICAL
//     neutral "not currently shared" response — not-shared and not-existent must
//     be indistinguishable, so existence never leaks (a single frozen constant is
//     returned in all three cases). The shape is marked `noindex`.
//
// The token compare is timing-safe: the plaintext is SHA-256 hashed first and the
// lookup is an indexed equality on that hash (the Lucia pattern the session
// tokens use), with a defensive constant-time compare of the stored hash.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP route
// (M3.7) is wired later.
// -------------------------------------------------------------------------

import { timingSafeEqual } from 'node:crypto'
import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, generateSessionToken, hashToken, type AuthorizeDeps } from '@curiolab/runtime'
import { VerificationSubjectNotFoundError } from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's one capability
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type VerificationAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'verification.regenerate',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface VerificationServiceDeps {
  sql: Sql
  authorize: VerificationAuthorizeFn
}

export interface RegenerateVerificationResult {
  subjectAccountId: string
  tokenId: string
  /** The plaintext token, returned ONCE. Only its hash is stored. */
  token: string
}

/** One verified/public_listed project on the shared record (title + date). */
export interface VerificationProject {
  title: string
  verifiedAt: string | null
}

/** The minimal verified record shown when public_profile is active. */
export interface VerificationRecord {
  /** first name + last initial (02-data-model.md; legal_name is never rendered). */
  displayName: string
  tierReached: string | null
  projects: VerificationProject[]
  mentorHours: number
}

export type VerificationView =
  | { shared: true; noindex: true; record: VerificationRecord }
  | { shared: false; noindex: true; notice: string }

/**
 * The single neutral response for EVERY not-currently-shared case — an unknown
 * token, a revoked token, and an inactive-consent subject alike. Returned by
 * reference (frozen) so the three are byte-identical and existence never leaks.
 */
const NOT_SHARED: VerificationView = Object.freeze({
  shared: false as const,
  noindex: true as const,
  notice: 'This record is not currently shared.',
})

/** A timestamptz column (a JS Date from `postgres`) as an ISO string, or null. */
function isoOrNull(value: unknown): string | null {
  return value == null ? null : new Date(value as string | Date).toISOString()
}

/** Constant-time equality for two equal-length hex digest strings. */
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export class VerificationService {
  private readonly sql: Sql
  private readonly authorize: VerificationAuthorizeFn

  constructor(deps: VerificationServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * POST /profile/verification-token — verification.regenerate (scope own or
   * guardian). Revokes the prior live token and mints a fresh one in ONE
   * transaction; the new plaintext is returned once.
   */
  async regenerate(
    subjectAccountId: string,
    ctx: AuthContext,
  ): Promise<RegenerateVerificationResult> {
    const age = await this.loadSubjectAge(subjectAccountId)
    // Own path: the student regenerates their own (ownerAccountId = actor).
    // Guardian path: the subject is the guardian's verified child, barred at 18.
    const resource: Resource = {
      ownerAccountId: subjectAccountId,
      subjectAccountId,
      subjectAge: age,
      subjectIsMinor: age < 18,
    }
    await this.authorize(ctx, 'verification.regenerate', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      // Revoke the prior live token FIRST so the one-live partial-unique index
      // admits the insert (regeneration invalidates the old link).
      await tx`
        update verification_token set revoked_at = now()
        where subject_account_id = ${subjectAccountId} and revoked_at is null
      `
      const token = generateSessionToken()
      const tokenHash = hashToken(token)
      const [row] = await tx`
        insert into verification_token (subject_account_id, token_hash, issued_by)
        values (${subjectAccountId}, ${tokenHash}, ${ctx.account.id})
        returning id
      `
      return { subjectAccountId, tokenId: row!.id as string, token }
    }) as Promise<RegenerateVerificationResult>
  }

  /**
   * GET /verify/:token — PUBLIC, unauthenticated, token-gated. Returns the
   * minimal verified record only when the token is LIVE and the subject's
   * public_profile consent is currently active; otherwise the neutral NOT_SHARED
   * response, indistinguishable across unknown / revoked / inactive-consent.
   */
  async view(token: string): Promise<VerificationView> {
    const tokenHash = hashToken(token)
    const [row] = await this.sql`
      select subject_account_id, token_hash from verification_token
      where token_hash = ${tokenHash} and revoked_at is null
    `
    // Unknown or revoked token -> neutral (no existence signal).
    if (row === undefined) return NOT_SHARED
    // Defensive constant-time compare of the stored hash against the computed one.
    if (!hashesEqual(row.token_hash as string, tokenHash)) return NOT_SHARED

    const subject = row.subject_account_id as string
    const [consent] = await this.sql`
      select active from consent_current
      where student_account_id = ${subject} and type = 'public_profile'
    `
    // public_profile inactive (or never granted) -> the SAME neutral response.
    if (consent === undefined || consent.active !== true) return NOT_SHARED

    return { shared: true, noindex: true, record: await this.composeRecord(subject) }
  }

  private async composeRecord(subjectAccountId: string): Promise<VerificationRecord> {
    const [acct] = await this.sql`select display_name from account where id = ${subjectAccountId}`
    const [mem] = await this.sql`
      select current_tier from membership
      where account_id = ${subjectAccountId} and role = 'student'
      order by created_at desc limit 1
    `
    const projects = await this.sql`
      select p.title, p.verified_at
      from project p
      join membership m on m.id = p.owner_membership_id
      where m.account_id = ${subjectAccountId} and p.status in ('verified', 'public_listed')
      order by p.verified_at desc nulls last, p.created_at desc
    `
    return {
      displayName: (acct?.display_name as string | undefined) ?? '',
      tierReached: (mem?.current_tier as string | null | undefined) ?? null,
      projects: projects.map((p) => ({
        title: p.title as string,
        verifiedAt: isoOrNull(p.verified_at),
      })),
      mentorHours: 0, // honest zero placeholder — no mentor-hours source yet
    }
  }

  /** The subject's age (from DOB) for the guardian-scope bound; loaded before authorize. */
  private async loadSubjectAge(subjectAccountId: string): Promise<number> {
    const [row] = await this.sql`select date_of_birth as dob from account where id = ${subjectAccountId}`
    if (row === undefined) throw new VerificationSubjectNotFoundError(subjectAccountId)
    const dob = new Date(row.dob as string)
    const at = new Date()
    let age = at.getUTCFullYear() - dob.getUTCFullYear()
    const m = at.getUTCMonth() - dob.getUTCMonth()
    if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
    return age
  }
}
