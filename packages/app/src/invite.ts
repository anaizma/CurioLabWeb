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
  writeAccessLedger,
  type AuthorizeDeps,
} from '@curiolab/runtime'
import { type AppConfig, type InviteKindTtl, defaultConfig } from './config.js'
import {
  DirectorInviteRequestNotFoundError,
  DirectorInviteRequestNotPendingError,
  DirectorInviteSameApproverError,
  GuardianInviteEmailMismatchError,
  InvalidInviteError,
  InviteCredentialMismatchError,
  InviteKindNotIssuableError,
  InviteNotFoundError,
  InviteRateLimitError,
} from './errors.js'

export type InviteKind = 'guardian' | 'student' | 'mentor' | 'staff' | 'director' | 'admin'

/** The capabilities the invite issue/resend paths gate through (P2 §1). */
export type InviteCapability = 'member.invite' | 'member.invite_admin' | 'member.invite_director'

/**
 * The injected `authorize` dependency, narrowed to this service's capabilities
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type InviteAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: InviteCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

/** Kinds a platform_admin alone may mint directly (admin, and a director invite). */
const PLATFORM_ADMIN_ONLY_KINDS: ReadonlySet<InviteKind> = new Set(['admin', 'director'])

/**
 * The membership role each ADULT chapter-role invite kind maps to on accept (§2).
 * The invite issuance WAS the authorization (the authority matrix, the two-person
 * director rule, and admin-only-admin all gate ISSUANCE), so accepting one of
 * these stands up an ACTIVE membership directly; first login forces TOTP (§P4).
 *   - mentor -> junior_mentor: the base (entry) mentor teaching role;
 *   - staff  -> comms_associate: the modeled chapter staff role;
 *   - director -> chapter_director;
 *   - admin  -> platform_admin: a platform-scoped role, represented (like every
 *     role) as a membership row attached to the invite's bound chapter — the same
 *     shape bootstrapPlatformAdmin writes.
 * `guardian` and `student` are ABSENT: a guardian accept creates only a pending
 * guardianship edge (no membership), and a student is never stood up by an accept.
 */
const ADULT_ACCEPT_MEMBERSHIP_ROLE: Partial<Record<InviteKind, string>> = {
  mentor: 'junior_mentor',
  staff: 'comms_associate',
  director: 'chapter_director',
  admin: 'platform_admin',
}

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

/** Initiate a two-person director invite (§1). Returns a pending request — no token. */
export interface InitiateDirectorInviteInput {
  chapterId: string
  targetEmail: string
}
export interface InitiateDirectorInviteResult {
  requestId: string
  /** Decision-time expiry of the pending request (adult 72h). */
  expiresAt: Date
}
/** Approve a pending director invite (§1). Mints the token only on a distinct approval. */
export interface ApproveDirectorInviteResult extends IssueInviteResult {
  requestId: string
}

/**
 * The acceptance-context binding checked at REDEMPTION (§4 token hardening). When
 * present, each field must equal the invite's bound value, else the accept is
 * refused with one opaque invalid_token. The accept page derives these from the
 * prior validateInvite; the token itself is opaque random and carries no PII.
 */
export interface AcceptExpectedBinding {
  email?: string | null
  kind?: InviteKind | null
  chapter?: string | null
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
  /**
   * §3 guardian-before-student: on a successful guardian-mediated accept-student,
   * the one-time student setup credential is routed to the guardian, NEVER emailed
   * to the child. The backend mints it bound to the student account but stamps the
   * delivery route as the guardian; the frontend delivers it to the guardian (a
   * seam). Present only on the gated accept-student path; undefined otherwise.
   */
  setupToken?: string
  /** Where the setup credential is delivered: always `guardian` when present. */
  setupTokenRoute?: 'guardian'
  /** The verified guardian the setup credential is routed to (§3). */
  guardianAccountId?: string | null
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

  // ---- issue (POST /ops/invites) -------------------------------------------
  /**
   * Issue one invite: a fresh CSPRNG token (returned opaque; only its hash is
   * stored), `status = 'issued'`, per-kind `expires_at` (§4: adult 72h, guardian
   * 7d), bound to `{ target_email, kind, chapter }` for redemption. The gating
   * capability is chosen per kind (§1):
   *   - `student` is NOT issuable here (originates from a consented guardian via
   *     accept-student) — refused before any authorization or IO.
   *   - `admin`, and a DIRECT `director` mint, require `member.invite_admin`
   *     (platform_admin only; a lone chapter_director denies out_of_scope and must
   *     use the two-person flow).
   *   - `guardian` / `mentor` / `staff` use the base `member.invite`.
   * A guardian invite must bind an enrollment whose application guardian_email
   * equals `targetEmail` — validated here AND enforced by the DB trigger floor.
   * Issuance is rate-limited per issuer (§4). Email delivery is deferred: the
   * returned token is the mailer's seam.
   */
  async issueInvite(input: IssueInviteInput, ctx: AuthContext): Promise<IssueInviteResult> {
    if (input.kind === 'student') {
      throw new InviteKindNotIssuableError('student')
    }
    const resource: Resource = { chapter_id: input.chapterId }
    await this.authorize(ctx, this.issueCapabilityFor(input.kind), resource, { sql: this.sql })

    if (input.kind === 'guardian') {
      await this.assertGuardianEmailMatches(input.enrollmentRecordId ?? null, input.targetEmail ?? null)
    }
    await this.assertUnderRateLimit(ctx.account.id)

    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + this.ttlFor(input.kind))

    // The subject student, when the invite binds an enrollment (guardian/student
    // kinds) — recorded on the ledger's origination row (§8).
    const subjectAccountId = await this.enrollmentStudent(input.enrollmentRecordId ?? null)

    const inviteId = await this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [row] = await tx`
        insert into invite (
          token_hash, kind, target_email, intended_account_id, enrollment_record_id,
          bound_chapter_id, issued_by, expires_at, status, delivery_status
        ) values (
          ${tokenHash}, ${input.kind}, ${input.targetEmail ?? null}, ${input.intendedAccountId ?? null},
          ${input.enrollmentRecordId ?? null}, ${input.chapterId}, ${ctx.account.id}, ${expiresAt}, 'issued',
          ${this.config.inviteInitialDeliveryStatus}
        ) returning id
      `
      const newInviteId = row!.id as string
      // §8: the origination row — who invited whom, the kind, the chapter.
      await writeAccessLedger(tx, {
        event: 'invite.issued',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId,
        chapterId: input.chapterId,
        inviteId: newInviteId,
        inviteKind: input.kind,
        targetEmail: input.targetEmail ?? null,
      })
      return newInviteId
    })

    return { inviteId, token, expiresAt }
  }

  // ---- two-person director invite (POST /ops/invites/director-requests) -----
  /**
   * Initiate a director-invite request (§1). A chapter_director (or a
   * platform_admin via the override) opens a PENDING request; NO token is minted.
   * A second, DISTINCT director must approve it before the director invite exists.
   * Gated by `member.invite_director` on the chapter.
   */
  async initiateDirectorInvite(
    input: InitiateDirectorInviteInput,
    ctx: AuthContext,
  ): Promise<InitiateDirectorInviteResult> {
    const resource: Resource = { chapter_id: input.chapterId }
    await this.authorize(ctx, 'member.invite_director', resource, { sql: this.sql })

    const expiresAt = new Date(Date.now() + this.ttlFor('director'))
    const requestId = await this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into director_invite_request (
          chapter_id, target_email, initiated_by, status, expires_at
        ) values (
          ${input.chapterId}, ${input.targetEmail}, ${ctx.account.id}, 'pending', ${expiresAt}
        ) returning id
      `
      return row!.id as string
    })
    return { requestId, expiresAt }
  }

  /**
   * Approve a pending director-invite request (§1). The approver MUST be a
   * DISTINCT director from the initiator (the two-person rule; the DB CHECK is the
   * floor). On approval the director invite is minted (kind `director`, bound to
   * `{ target_email, chapter }`, adult 72h expiry) and the request is stamped
   * `approved` with the approver + timestamp + minted invite_id, all in one
   * transaction. Gated by `member.invite_director` on the request's chapter, and
   * rate-limited per approver.
   */
  async approveDirectorInvite(
    requestId: string,
    ctx: AuthContext,
  ): Promise<ApproveDirectorInviteResult> {
    const [req] = await this.sql`
      select chapter_id, target_email, initiated_by, status, (expires_at > now()) as not_expired
      from director_invite_request where id = ${requestId}
    `
    if (req === undefined) throw new DirectorInviteRequestNotFoundError(requestId)

    const resource: Resource = { chapter_id: req.chapter_id as string }
    await this.authorize(ctx, 'member.invite_director', resource, { sql: this.sql })

    if (req.status !== 'pending' || req.not_expired !== true) {
      throw new DirectorInviteRequestNotPendingError(requestId)
    }
    if ((req.initiated_by as string) === ctx.account.id) {
      throw new DirectorInviteSameApproverError(requestId)
    }
    await this.assertUnderRateLimit(ctx.account.id)

    const chapterId = req.chapter_id as string
    const targetEmail = req.target_email as string
    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + this.ttlFor('director'))

    const inviteId = await this.sql.begin(async (tx) => {
      assertAuthorized()
      // Claim the request atomically: only a still-pending, distinct-approver row
      // flips (the DB CHECK guarantees approved_by <> initiated_by).
      const claimed = await tx`
        update director_invite_request
           set status = 'approved', approved_by = ${ctx.account.id}, approved_at = now()
         where id = ${requestId} and status = 'pending'
        returning id
      `
      if (claimed.length === 0) throw new DirectorInviteRequestNotPendingError(requestId)
      const [inv] = await tx`
        insert into invite (
          token_hash, kind, target_email, bound_chapter_id, issued_by,
          expires_at, status, delivery_status
        ) values (
          ${tokenHash}, 'director', ${targetEmail}, ${chapterId}, ${ctx.account.id},
          ${expiresAt}, 'issued', ${this.config.inviteInitialDeliveryStatus}
        ) returning id
      `
      const newInviteId = inv!.id as string
      await tx`update director_invite_request set invite_id = ${newInviteId} where id = ${requestId}`
      return newInviteId
    })

    return { requestId, inviteId, token, expiresAt }
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
             coalesce(e.chapter_id, i.bound_chapter_id) as chapter_id
      from invite i
      left join enrollment_record e on e.id = i.enrollment_record_id
      where i.id = ${inviteId}
    `
    if (existing === undefined) throw new InviteNotFoundError(inviteId)

    const kind = existing.kind as InviteKind
    const chapterId = (existing.chapter_id as string | null) ?? null
    const resource: Resource = { chapter_id: chapterId }
    // Per-kind authority (§1): a privileged invite (admin/director) may only be
    // resent by a platform_admin (member.invite_admin); guardian/mentor/staff by
    // the base member.invite. Keeps a director from resending an admin invite.
    await this.authorize(ctx, this.issueCapabilityFor(kind), resource, { sql: this.sql })
    await this.assertUnderRateLimit(ctx.account.id)

    const token = generateSessionToken()
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + this.ttlFor(kind))

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
          bound_chapter_id, issued_by, expires_at, status, delivery_status
        ) values (
          ${tokenHash}, ${existing.kind}, ${existing.target_email ?? null},
          ${existing.intended_account_id ?? null}, ${existing.enrollment_record_id ?? null},
          ${chapterId}, ${ctx.account.id}, ${expiresAt}, 'issued', ${this.config.inviteInitialDeliveryStatus}
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
             coalesce(e.chapter_id, i.bound_chapter_id) as chapter_id
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
  async acceptInvite(
    token: string,
    credentials: AcceptCredentials,
    expected?: AcceptExpectedBinding,
    opts: { clientIp?: string | null } = {},
  ): Promise<AcceptInviteResult> {
    const clientIp = opts.clientIp ?? null
    const tokenHash = hashToken(token)
    const [invite] = await this.sql`
      select invite.id, invite.kind, invite.status, invite.enrollment_record_id,
             invite.target_email, (invite.expires_at > now()) as not_expired,
             coalesce(e.chapter_id, invite.bound_chapter_id) as chapter_id
      from invite
      left join enrollment_record e on e.id = invite.enrollment_record_id
      where invite.token_hash = ${tokenHash}
    `
    if (invite === undefined || invite.status !== 'issued' || invite.not_expired !== true) {
      throw new InvalidInviteError()
    }

    const kind = invite.kind as InviteKind
    const boundEmail = (invite.target_email as string | null) ?? null
    const boundChapter = (invite.chapter_id as string | null) ?? null

    // §4 token hardening — bind {email, kind, chapter} at REDEMPTION. When the
    // acceptance context supplies an expected value, it MUST equal the invite's
    // bound value; a mismatch is refused with the SAME opaque invalid_token as a
    // forged link (never reveals which field diverged).
    if (expected !== undefined) {
      const mismatch =
        // An email binding applies only when the invite actually carries a bound
        // email (adult/guardian kinds); a student invite has none, so a wrong
        // credential SHAPE is caught below as a 400, not masked as invalid_token.
        (expected.email != null && boundEmail !== null && !emailEq(expected.email, boundEmail)) ||
        (expected.kind != null && expected.kind !== kind) ||
        (expected.chapter != null && expected.chapter !== boundChapter)
      if (mismatch) throw new InvalidInviteError()
    }
    // Independent of an explicit expected-binding, a presented credential email
    // must match the invite's bound target_email (the email is bound to the token
    // at issue, never chosen freely at redemption).
    if (boundEmail !== null && isEmailCreds(credentials) && !emailEq(credentials.email, boundEmail)) {
      throw new InvalidInviteError()
    }

    const wantsEmail = kind !== 'student'
    if (wantsEmail && !isEmailCreds(credentials)) {
      throw new InviteCredentialMismatchError(kind, 'email')
    }
    if (!wantsEmail && isEmailCreds(credentials)) {
      throw new InviteCredentialMismatchError(kind, 'username')
    }

    // §3 guardian-before-student (the COPPA ordering invariant). When a student
    // invite's enrollment ALREADY binds a guardian-provisioned student account,
    // accept-student CREDENTIALS that existing account rather than creating one,
    // and it is REFUSED unless (a) a VERIFIED guardianship edge exists for that
    // student (not merely pending) AND (b) the guardian holds the participation
    // consent on file (`platform_participation`, the "may have a platform account"
    // record that exists today). The gate is resolved BEFORE the invite is claimed
    // so a refusal leaves the token usable for a retry once the guardian verifies;
    // the refusal is opaque (the same InvalidInviteError as a forged link).
    let gatedStudent: { studentAccountId: string; guardianAccountId: string } | null = null
    if (kind === 'student') {
      const linked = await this.enrollmentStudent(
        (invite.enrollment_record_id as string | null) ?? null,
      )
      if (linked != null) {
        gatedStudent = await this.assertStudentGuardianGate(linked)
      }
    }

    const passwordHash = await hashPassword(credentials.password)

    const result = await this.sql.begin(async (tx) => {
      // Claim the invite atomically: single-use, and rejects a token that expired
      // or was revoked between the read above and here.
      const claimed = await tx`
        update invite set status = 'accepted', accepted_at = now()
        where id = ${invite.id} and status = 'issued' and expires_at > now()
        returning id
      `
      if (claimed.length === 0) throw new InvalidInviteError()

      let accountId: string
      let setupToken: string | undefined
      let guardianRoutedTo: string | null = null
      if (isEmailCreds(credentials)) {
        // An email-identified adult account. For an ADULT CHAPTER-ROLE kind
        // (mentor/staff/director/admin) the issuance WAS the authorization, so the
        // account is created ACTIVE and an ACTIVE membership is stood up in the same
        // transaction (§2). For a `guardian` kind the account stays `pending` and
        // NO membership is created — the pending guardianship edge below carries no
        // authority until name-match verification (step 4).
        const membershipRole = ADULT_ACCEPT_MEMBERSHIP_ROLE[kind]
        const accountStatus = membershipRole !== undefined ? 'active' : 'pending'
        const [acct] = await tx`
          insert into account (
            email, username, legal_name, display_name, date_of_birth,
            dob_provenance, dob_source_ref, password_hash, credential_owner,
            status, maturation_state
          ) values (
            ${credentials.email}, ${null}, ${credentials.legalName}, ${credentials.displayName},
            ${credentials.dateOfBirth}, 'self_reported', ${null}, ${passwordHash}, 'self_private',
            ${accountStatus}, 'self_managed'
          ) returning id
        `
        accountId = acct!.id as string
        if (membershipRole !== undefined) {
          // The chapter membership the invite authorized. boundChapter is the
          // invite's bound chapter (adult invites carry no enrollment); it is
          // non-null for every issuable adult kind.
          if (boundChapter === null) throw new InvalidInviteError()
          await tx`
            insert into membership (account_id, chapter_id, role, status)
            values (${accountId}, ${boundChapter}, ${membershipRole}, 'active')
          `
        }
      } else if (gatedStudent != null) {
        // §3 SET-path: credential the EXISTING guardian-provisioned student the
        // enrollment already binds (the guardian was onboarded + verified and the
        // participation consent is on file — asserted before the claim). The child
        // sets their username + password with the guardian present; the account
        // stays `pending` (no membership until activate). The one-time credential
        // is then routed to the guardian, NOT emailed to the child.
        accountId = gatedStudent.studentAccountId
        guardianRoutedTo = gatedStudent.guardianAccountId
        const upd = await tx`
          update account
             set username = ${credentials.username}, password_hash = ${passwordHash}
           where id = ${accountId} and status = 'pending'
          returning id
        `
        if (upd.length === 0) throw new InvalidInviteError()
        // The guardian-routed one-time setup token: minted bound to the student
        // account (purpose 'minor_setup') but its delivery route is the guardian.
        // A regenerate supersedes any prior live one. Returned once (the seam a
        // future mailer/frontend consumes to deliver to the guardian).
        setupToken = generateSessionToken()
        await tx`
          update credential_token set consumed_at = now()
          where account_id = ${accountId} and purpose = 'minor_setup' and consumed_at is null
        `
        await tx`
          insert into credential_token (account_id, token_hash, purpose, expires_at)
          values (${accountId}, ${hashToken(setupToken)}, 'minor_setup', now() + ${this.ttlFor('student')} * interval '1 millisecond')
        `
      } else {
        // §5: the old accept-student CREATE path is REMOVED. It created a NEW
        // student account from a student invite with NO verified-guardian check —
        // it could stand up a student ahead of any guardian. It is also now dead:
        // EnrollmentService.create always creates the inert student SHELL (and
        // links the enrollment) at enrollment time, so a student invite always
        // resolves to an existing account and takes the guarded SET path above.
        // A student accept that reaches here (no shell-linked enrollment) can never
        // stand up a student — refused with the SAME opaque error as a forged link,
        // upholding guardian-before-student.
        throw new InvalidInviteError()
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

      // §8: the redemption row — the accepting account, the invite, the chapter,
      // and the trusted client IP threaded from the HTTP layer.
      await writeAccessLedger(tx, {
        event: 'invite.redeemed',
        actorAccountId: accountId,
        subjectAccountId: accountId,
        guardianAccountId: guardianRoutedTo,
        chapterId: boundChapter,
        inviteId: invite.id as string,
        inviteKind: kind,
        targetEmail: boundEmail,
        clientIp,
      })

      // §8/§3: on the gated accept-student, record the consent artifact + method
      // the acceptance referenced (the guardian's participation consent on file),
      // and that the setup credential was guardian-routed.
      if (gatedStudent != null) {
        await writeAccessLedger(tx, {
          event: 'accept_student.consent',
          actorAccountId: accountId,
          subjectAccountId: accountId,
          guardianAccountId: guardianRoutedTo,
          chapterId: boundChapter,
          inviteId: invite.id as string,
          consentMethod: 'guardian_participation_consent',
          clientIp,
          detail: { setupTokenRoute: 'guardian' },
        })
      }

      return {
        accountId,
        guardianshipId,
        ...(setupToken !== undefined
          ? { setupToken, setupTokenRoute: 'guardian' as const, guardianAccountId: guardianRoutedTo }
          : {}),
      }
    })
    return result
  }

  /**
   * §3 gate: delegates to the shared {@link assertStudentGuardianGate}. Kept as a
   * thin method so the SET path reads unchanged; the guardian-originated mint
   * (StudentSetupService) reuses the same exported floor.
   */
  private async assertStudentGuardianGate(
    studentAccountId: string,
  ): Promise<{ studentAccountId: string; guardianAccountId: string }> {
    return assertStudentGuardianGate(this.sql, studentAccountId)
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

  /** The linked student of an enrollment record (null when unbound or unlinked). */
  private async enrollmentStudent(enrollmentRecordId: string | null): Promise<string | null> {
    if (enrollmentRecordId == null) return null
    const [row] = await this.sql`
      select student_account_id from enrollment_record where id = ${enrollmentRecordId}
    `
    return (row?.student_account_id as string | null | undefined) ?? null
  }

  /**
   * The capability that gates issuing (or resending) a given kind (§1):
   *   - admin, and a direct director mint -> member.invite_admin (platform_admin
   *     only; a lone chapter_director denies out_of_scope);
   *   - guardian / mentor / staff -> member.invite (director/comms/admin).
   * `student` never reaches here (refused before authorization).
   */
  private issueCapabilityFor(kind: InviteKind): InviteCapability {
    return PLATFORM_ADMIN_ONLY_KINDS.has(kind) ? 'member.invite_admin' : 'member.invite'
  }

  /** The per-kind token lifetime in ms (§4: adult 72h, guardian/student ~7d). */
  private ttlFor(kind: InviteKind): number {
    return this.config.inviteTtlMsByKind[kind as InviteKindTtl] ?? this.config.inviteTtlMs
  }

  /**
   * Per-issuer rate limit (§4): refuse if this issuer has minted at least
   * `inviteRateLimitMax` invites within the rolling `inviteRateLimitWindowMs`
   * window, counted at decision time over the invites it has issued (matching the
   * lead-dedupe decision-time counting). A privileged/runaway issuer cannot spray.
   */
  private async assertUnderRateLimit(issuerAccountId: string): Promise<void> {
    const windowStart = new Date(Date.now() - this.config.inviteRateLimitWindowMs)
    const [row] = await this.sql`
      select count(*)::int as n from invite
      where issued_by = ${issuerAccountId} and created_at > ${windowStart}
    `
    if ((row?.n as number) >= this.config.inviteRateLimitMax) {
      throw new InviteRateLimitError(issuerAccountId)
    }
  }
}

/**
 * §3 guardian-before-student gate (the COPPA ordering invariant). A guardian-
 * provisioned student may be credentialed only when a VERIFIED guardianship edge
 * exists for them AND the guardian's `platform_participation` consent is currently
 * active. Returns the verified guardian's account id (for guardian-routing the
 * setup credential). Any failure — no edge, a merely-pending edge, or missing
 * participation consent — throws the SAME opaque InvalidInviteError as a forged
 * link (never revealing which gate failed). Shared by the accept-student SET path
 * and the guardian-originated setup-credential mint (StudentSetupService).
 */
export async function assertStudentGuardianGate(
  sql: Sql,
  studentAccountId: string,
): Promise<{ studentAccountId: string; guardianAccountId: string }> {
  const [g] = await sql`
    select guardian_account_id from guardianship
    where student_account_id = ${studentAccountId} and status = 'verified'
    order by verified_at desc nulls last
    limit 1
  `
  const guardianAccountId = (g?.guardian_account_id as string | null | undefined) ?? null
  if (guardianAccountId == null) throw new InvalidInviteError()

  const [c] = await sql`
    select active from consent_current
    where student_account_id = ${studentAccountId} and type = 'platform_participation'
  `
  if (c?.active !== true) throw new InvalidInviteError()
  return { studentAccountId, guardianAccountId }
}

/** Case-insensitive email equality, mirroring the citext DB columns. */
function emailEq(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false
  return a.toLowerCase() === b.toLowerCase()
}

/** Constant-time equality for two equal-length hex digest strings. */
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
