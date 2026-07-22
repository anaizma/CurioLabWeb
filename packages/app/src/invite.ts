// -------------------------------------------------------------------------
// InviteService — Milestone 1 step 3: invite issue, validate, accept, resend
// (04-state-machines "Invite"; 05-api-surface; 06-onboarding-flows Flows A/B/C/E).
//
// Two authorized ops writes gated through `authorize` under `member.invite`
// (POST /ops/invites, /ops/invites/:id/resend), and three UNAUTHENTICATED,
// actor-less, INERT endpoints that carry no AuthContext and never call
// `authorize` (GET /invites/:token, POST /invites/:token/accept,
// /accept-student). The inert set creates only a `pending` account and, for a
// guardian, a `pending` guardianship edge — zero authority until staff verify
// (step 4) or activate (step 6), neither built here.
//
// Tokens follow the runtime CSPRNG + hash pattern (tokens.ts): a high-entropy
// opaque token is returned to the caller (the seam a future mailer consumes),
// and ONLY its SHA-256 hash is stored. Passwords are argon2id (password.ts).
// Email DELIVERY (Resend) and the HTTP route layer are deferred.
//
// Framework-agnostic: the db handle, `authorize`, and config are injected.
// -------------------------------------------------------------------------

import { timingSafeEqual } from 'node:crypto'
import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import {
  assertAuthorized,
  generateSessionToken,
  hashPassword,
  hashToken,
  type AuthorizeDeps,
} from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import {
  GuardianInviteEmailMismatchError,
  InvalidInviteError,
  InviteCredentialMismatchError,
  InviteNotFoundError,
} from './errors.js'

export type InviteKind = 'guardian' | 'student' | 'mentor' | 'staff'

/**
 * The injected `authorize` dependency, narrowed to this service's one
 * capability (structurally the runtime `authorize` wrapper; taken by injection
 * so the deny/backstop paths are testable without HTTP).
 */
export type InviteAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'member.invite',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface InviteServiceDeps {
  sql: Sql
  authorize: InviteAuthorizeFn
  /** Optional overrides for the config-not-code tunables. */
  config?: Partial<AppConfig>
}

export interface IssueInviteInput {
  kind: InviteKind
  /** The chapter the invite is issued into; the authorization scope. */
  chapterId: string
  /** Required for a guardian invite; must equal the bound enrollment email. */
  targetEmail?: string | null
  /** Binds the invite to an enrollment (required for guardian; carries chapter). */
  enrollmentRecordId?: string | null
  /** Optional pre-linked account. */
  intendedAccountId?: string | null
}

export interface IssueInviteResult {
  inviteId: string
  /** The opaque token handed to the caller (only its hash is stored). */
  token: string
  expiresAt: Date
}

/** The public validate result (GET /invites/:token). Uniform shape always. */
export interface ValidateInviteResult {
  usable: boolean
  kind: InviteKind | null
  /** The chapter id, derivable via the bound enrollment; null otherwise. */
  chapter: string | null
}

/** email + password, for guardian / mentor / staff invites. Plus profile fields
 * the NOT-NULL `account` columns require (name and DOB the setup form collects). */
export interface EmailCredentials {
  email: string
  password: string
  legalName: string
  displayName: string
  /** ISO date `YYYY-MM-DD`. */
  dateOfBirth: string
}

/** username + password, for a guardian-mediated student invite (no email). */
export interface UsernameCredentials {
  username: string
  password: string
  legalName: string
  displayName: string
  /**
   * IGNORED for the student path. The canonical DOB is copied from the bound
   * seeding enrollment record with `dob_provenance='enrollment_record'`, never
   * self-reported at setup (02-data-model.md; decision-log.md "DOB on the
   * enrollment record, reversed and refined"). Kept optional for callers that
   * still pass it; the value is not read.
   */
  dateOfBirth?: string
}

export type AcceptCredentials = EmailCredentials | UsernameCredentials

export interface AcceptInviteResult {
  accountId: string
  /** The pending guardianship edge id, for a guardian invite; null otherwise. */
  guardianshipId: string | null
}

function isEmailCreds(c: AcceptCredentials): c is EmailCredentials {
  return typeof (c as EmailCredentials).email === 'string'
}

const NOT_USABLE: ValidateInviteResult = { usable: false, kind: null, chapter: null }

export class InviteService {
  private readonly sql: Sql
  private readonly authorize: InviteAuthorizeFn
  private readonly config: AppConfig

  constructor(deps: InviteServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.config = { ...defaultConfig, ...deps.config }
  }

  // ---- issue (POST /ops/invites, member.invite) ----------------------------
  /**
   * Issue one invite: a fresh CSPRNG token (returned opaque; only its hash is
   * stored), `status = 'issued'`, `expires_at = now + 14 days` (config). A
   * guardian invite must bind an enrollment whose application guardian_email
   * equals `targetEmail` — validated here AND enforced by the DB trigger floor.
   * Email delivery is deferred: the returned token is the mailer's seam.
   */
  async issueInvite(input: IssueInviteInput, ctx: AuthContext): Promise<IssueInviteResult> {
    const resource: Resource = { chapter_id: input.chapterId }
    await this.authorize(ctx, 'member.invite', resource, { sql: this.sql })

    if (input.kind === 'guardian') {
      await this.assertGuardianEmailMatches(input.enrollmentRecordId ?? null, input.targetEmail ?? null)
    }

    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + this.config.inviteTtlMs)

    const inviteId = await this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [row] = await tx`
        insert into invite (
          token_hash, kind, target_email, intended_account_id, enrollment_record_id,
          issued_by, expires_at, status, delivery_status
        ) values (
          ${tokenHash}, ${input.kind}, ${input.targetEmail ?? null}, ${input.intendedAccountId ?? null},
          ${input.enrollmentRecordId ?? null}, ${ctx.account.id}, ${expiresAt}, 'issued',
          ${this.config.inviteInitialDeliveryStatus}
        ) returning id
      `
      return row!.id as string
    })

    return { inviteId, token, expiresAt }
  }

  // ---- resend (POST /ops/invites/:id/resend, member.invite) ----------------
  /**
   * Resend: mint a new token and SUPERSEDE the old invite — the old row moves
   * `issued -> revoked` (its hash can no longer validate) and a fresh `issued`
   * row is inserted with a reset 14-day clock, both in one transaction
   * (04-state-machines: "issued -> revoked on resend"). Only an `issued` invite
   * may be resent. The chapter scope is derived from the invite's bound
   * enrollment record.
   */
  async resendInvite(inviteId: string, ctx: AuthContext): Promise<IssueInviteResult> {
    const [existing] = await this.sql`
      select i.kind, i.target_email, i.intended_account_id, i.enrollment_record_id, i.status,
             e.chapter_id as chapter_id
      from invite i
      left join enrollment_record e on e.id = i.enrollment_record_id
      where i.id = ${inviteId}
    `
    if (existing === undefined) throw new InviteNotFoundError(inviteId)

    const resource: Resource = { chapter_id: (existing.chapter_id as string | null) ?? null }
    await this.authorize(ctx, 'member.invite', resource, { sql: this.sql })

    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + this.config.inviteTtlMs)

    const newId = await this.sql.begin(async (tx) => {
      assertAuthorized()
      // Supersede: revoke the old row only if still issued (guards double-resend).
      const revoked = await tx`
        update invite set status = 'revoked' where id = ${inviteId} and status = 'issued' returning id
      `
      if (revoked.length === 0) throw new InvalidInviteError()
      const [row] = await tx`
        insert into invite (
          token_hash, kind, target_email, intended_account_id, enrollment_record_id,
          issued_by, expires_at, status, delivery_status
        ) values (
          ${tokenHash}, ${existing.kind}, ${existing.target_email ?? null},
          ${existing.intended_account_id ?? null}, ${existing.enrollment_record_id ?? null},
          ${ctx.account.id}, ${expiresAt}, 'issued', ${this.config.inviteInitialDeliveryStatus}
        ) returning id
      `
      return row!.id as string
    })

    return { inviteId: newId, token, expiresAt }
  }

  // ---- validate (GET /invites/:token, UNAUTHENTICATED) ---------------------
  /**
   * Timing-safe validate. Returns ONLY `{ usable, kind, chapter }` and NEVER a
   * name or any child detail. Invalid, expired, revoked, and already-accepted
   * tokens ALL return the identical not-usable result — the same shape and
   * signal as a forged link (05-api-surface). Expiry is evaluated at decision
   * time against `now()`.
   */
  async validateInvite(token: string): Promise<ValidateInviteResult> {
    const tokenHash = hashToken(token)
    const [row] = await this.sql`
      select i.token_hash, i.kind, i.status, (i.expires_at > now()) as not_expired,
             e.chapter_id as chapter_id
      from invite i
      left join enrollment_record e on e.id = i.enrollment_record_id
      where i.token_hash = ${tokenHash}
    `
    if (row === undefined) return NOT_USABLE
    // Defensive constant-time compare of the stored hash against the computed one
    // (they are equal-length hex digests); do not branch on a partial match.
    if (!hashesEqual(row.token_hash as string, tokenHash)) return NOT_USABLE

    const usable = row.status === 'issued' && row.not_expired === true
    if (!usable) return NOT_USABLE
    return { usable: true, kind: row.kind as InviteKind, chapter: (row.chapter_id as string | null) ?? null }
  }

  // ---- accept (POST /invites/:token/accept[-student], UNAUTHENTICATED) ------
  /**
   * Single-use accept. Creates a `pending` account with the credential identity
   * (email XOR username) and an argon2id password hash; for a guardian invite it
   * also creates a `pending` guardianship edge to the bound enrollment's child.
   * Acceptance confers NO authority: no membership, and the guardian edge holds
   * none until name-match verification (step 4). The invite is claimed atomically
   * (`issued -> accepted`), so a second accept with the same token fails. An
   * invalid, expired, or revoked token is rejected with one opaque error.
   */
  async acceptInvite(token: string, credentials: AcceptCredentials): Promise<AcceptInviteResult> {
    const tokenHash = hashToken(token)
    const [invite] = await this.sql`
      select id, kind, status, enrollment_record_id, (expires_at > now()) as not_expired
      from invite where token_hash = ${tokenHash}
    `
    if (invite === undefined || invite.status !== 'issued' || invite.not_expired !== true) {
      throw new InvalidInviteError()
    }

    const kind = invite.kind as InviteKind
    const wantsEmail = kind !== 'student'
    if (wantsEmail && !isEmailCreds(credentials)) {
      throw new InviteCredentialMismatchError(kind, 'email')
    }
    if (!wantsEmail && isEmailCreds(credentials)) {
      throw new InviteCredentialMismatchError(kind, 'username')
    }

    const passwordHash = await hashPassword(credentials.password)

    return this.sql.begin(async (tx) => {
      // Claim the invite atomically: single-use, and rejects a token that expired
      // or was revoked between the read above and here.
      const claimed = await tx`
        update invite set status = 'accepted', accepted_at = now()
        where id = ${invite.id} and status = 'issued' and expires_at > now()
        returning id
      `
      if (claimed.length === 0) throw new InvalidInviteError()

      let accountId: string
      if (isEmailCreds(credentials)) {
        // guardian / mentor / staff: an email-identified adult account, pending.
        const [acct] = await tx`
          insert into account (
            email, username, legal_name, display_name, date_of_birth,
            dob_provenance, dob_source_ref, password_hash, credential_owner,
            status, maturation_state
          ) values (
            ${credentials.email}, ${null}, ${credentials.legalName}, ${credentials.displayName},
            ${credentials.dateOfBirth}, 'self_reported', ${null}, ${passwordHash}, 'self_private',
            'pending', 'self_managed'
          ) returning id
        `
        accountId = acct!.id as string
      } else {
        // student (guardian-mediated): a username-identified minor account, no
        // email, pending. The `email XOR username` constraint is respected.
        //
        // The DOB is NOT taken from caller input. It is copied from the bound
        // SEEDING enrollment record (the form's DOB, living there until now) with
        // dob_provenance='enrollment_record' and dob_source_ref=signed_form_ref,
        // which is exactly what the decision-4 trigger requires of any account
        // that later holds an active student membership (02-data-model.md;
        // decision-log.md "DOB on the enrollment record, reversed and refined").
        const [enr] = await tx`
          select date_of_birth::text as date_of_birth, signed_form_ref
          from enrollment_record where id = ${invite.enrollment_record_id}
        `
        const dob = enr?.date_of_birth as string | null | undefined
        const signedFormRef = enr?.signed_form_ref as string | null | undefined
        if (invite.enrollment_record_id == null || dob == null || signedFormRef == null) {
          // A student accept must bind a seeding enrollment carrying the form DOB.
          throw new InvalidInviteError()
        }
        const [acct] = await tx`
          insert into account (
            email, username, legal_name, display_name, date_of_birth,
            dob_provenance, dob_source_ref, password_hash, credential_owner,
            status, maturation_state
          ) values (
            ${null}, ${credentials.username}, ${credentials.legalName}, ${credentials.displayName},
            ${dob}, 'enrollment_record', ${signedFormRef}, ${passwordHash},
            'guardian_provisioned', 'pending', 'minor'
          ) returning id
        `
        accountId = acct!.id as string
        // Linkage backfill: bind the seeding enrollment to the new account. This
        // touches only student_account_id — the enrollment's write-once DOB is
        // left equal, so its write-once trigger is not tripped.
        await tx`
          update enrollment_record set student_account_id = ${accountId}
          where id = ${invite.enrollment_record_id}
        `
      }

      let guardianshipId: string | null = null
      if (kind === 'guardian') {
        const [enr] = await tx`
          select student_account_id from enrollment_record where id = ${invite.enrollment_record_id}
        `
        const studentAccountId = enr?.student_account_id as string | null | undefined
        if (studentAccountId == null) {
          // A guardian invite must resolve to the enrollment's child; without it
          // the pending edge cannot be formed.
          throw new InvalidInviteError()
        }
        const [edge] = await tx`
          insert into guardianship (
            guardian_account_id, student_account_id, relationship, status,
            verification_method, verified_by, source_ref, verified_at
          ) values (
            ${accountId}, ${studentAccountId}, ${this.config.guardianRelationshipDefault}, 'pending',
            ${this.config.guardianVerificationMethod}, ${null}, ${null}, ${null}
          ) returning id
        `
        guardianshipId = edge!.id as string
      }

      return { accountId, guardianshipId }
    })
  }

  /**
   * Service-layer floor for the guardian-invite binding: the bound enrollment's
   * application guardian_email must equal the invite target_email. The DB trigger
   * enforces the same at insert (defence in depth); this yields a typed error.
   */
  private async assertGuardianEmailMatches(
    enrollmentRecordId: string | null,
    targetEmail: string | null,
  ): Promise<void> {
    if (enrollmentRecordId == null || targetEmail == null) {
      throw new GuardianInviteEmailMismatchError()
    }
    const [row] = await this.sql`
      select a.guardian_email as guardian_email
      from enrollment_record e
      join application a on a.id = e.application_id
      where e.id = ${enrollmentRecordId}
    `
    // citext equality: compare case-insensitively to mirror the DB column.
    const bound = (row?.guardian_email as string | null) ?? null
    if (bound === null || bound.toLowerCase() !== targetEmail.toLowerCase()) {
      throw new GuardianInviteEmailMismatchError()
    }
  }
}

/** Constant-time equality for two equal-length hex digest strings. */
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
