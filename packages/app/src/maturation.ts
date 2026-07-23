// -------------------------------------------------------------------------
// MaturationService — Milestone 4: the coming-of-age (maturation) flow and the
// 16+ credential privatization (06-onboarding-flows Flow D; 04-state-machines
// account_maturation `minor -> maturation_pending -> self_managed`, and the
// coupled guardianship `verified -> lapsed`).
//
// Five operations, three shapes of gating:
//   - addEmail / privatizeCredential are SELF-initiated: they flow from the
//     student's own authenticated session and are gated by self-ownership + an
//     age floor (no registry capability, so no `authorize`/audit path).
//   - confirmMaturation / reissueSetup are OPS writes gated through `authorize`
//     (chapter-scoped, Chapter Director) — `maturation.confirm` / `account.recover`.
//   - sweepMaturationBackstop is a SYSTEM job (no actor -> not through `authorize`,
//     like sweepExpiredLeads / runScheduledNewsletters), with a `notify` seam.
//
// The automatic-at-18 write-authority flip is already handled by decision-time
// age logic in `can` (the guardian consent-write bar at 18); this service owns
// the explicit state changes and the guardianship-edge lapse.
//
// Framework-agnostic: the db handle, `authorize`, and config are injected; the
// HTTP routes (POST /auth/email/add, /ops/maturations/:id/confirm,
// /ops/accounts/:id/reissue-setup) are wired later. Token/email DELIVERY is a
// mailer seam (the returned token); password-reset delivery is a seam too.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, CredentialOwner, Resource } from '@curiolab/core'
import { canTransition } from '@curiolab/core'
import {
  assertAuthorized,
  generateSessionToken,
  writeAudit,
  type AuthorizeDeps,
} from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import {
  CredentialWitnessInvalidError,
  CredentialWitnessIsGuardianError,
  CredentialWitnessRequiredError,
  IllegalMaturationTransitionError,
  MaturationAccountNotFoundError,
  MaturationAgeError,
  MaturationChapterNotFoundError,
  MaturationNotSelfError,
  ReissueActiveMembershipError,
} from './errors.js'

/** Age floors (config-not-code candidates, kept local as the spec's fixed floors). */
const ADD_EMAIL_MIN_AGE = 18
const PRIVATIZE_MIN_AGE = 16

/**
 * The chapter roles that may WITNESS a 16+ privatization: an active teaching or
 * staff membership in the student's chapter ("a mentor or instructor present";
 * "a chapter adult who is not a guardian", 06-onboarding-flows). `student` and
 * `alumni` are excluded; adulthood is enforced separately (a minor mentor cannot
 * witness).
 */
const WITNESS_ROLES = [
  'chapter_director',
  'lead_instructor',
  'senior_instructor',
  'junior_mentor',
  'comms_associate',
] as const

/**
 * The injected `authorize` dependency, narrowed to this service's two gated
 * capabilities (structurally the runtime `authorize` wrapper; taken by injection
 * so the deny/backstop paths are testable without HTTP).
 */
export type MaturationAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'maturation.confirm' | 'account.recover',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface MaturationServiceDeps {
  sql: Sql
  authorize: MaturationAuthorizeFn
  /** Optional overrides for the config-not-code tunables (e.g. the token TTL). */
  config?: Partial<AppConfig>
}

export interface AddEmailResult {
  accountId: string
  email: string
  maturationState: 'maturation_pending'
}

export interface ConfirmMaturationResult {
  accountId: string
  chapterId: string
  /** The number of `verified` guardianship edges lapsed by this confirmation. */
  edgesLapsed: number
}

export interface ReissueSetupResult {
  accountId: string
  chapterId: string
  /** The opaque setup token, returned ONCE (the mailer seam). */
  token: string
  expiresAt: Date
}

export interface PrivatizeCredentialResult {
  accountId: string
  credentialOwner: 'self_private'
  witnessedBy: string
  /** Where a password reset now routes (encodes the post-privatization decision). */
  passwordResetRoute: 'chapter_director'
}

/** The `notify` seam payload for the 30-day-prior backstop notice. */
export interface MaturationLapseNotice {
  accountId: string
  guardianshipId: string
  /** When the edge will auto-lapse (the 18th birthday + 90 days). */
  lapsesAt: Date | string
}

export interface SweepMaturationDeps {
  sql: Sql
  /** The 30-day-prior notice seam. Fired post-commit for each in-window account. */
  notify?: (notice: MaturationLapseNotice) => Promise<void> | void
}

export interface SweepMaturationResult {
  /** Account ids whose verified guardianship edge lapsed on this run. */
  lapsed: string[]
  /** Account ids notified 30 days before their lapse on this run. */
  notified: string[]
}

/**
 * The password-reset routing decision after the 16+ privatization: once a
 * credential is `self_private`, reset routes to the Chapter Director rather than
 * to guardians (06-onboarding-flows: "password reset for that account routes to
 * the Chapter Director rather than to guardians"). A pure function so the routing
 * rule is one place, testable, and reusable by the (deferred) reset delivery.
 */
export function passwordResetRoute(credentialOwner: CredentialOwner): 'chapter_director' | 'guardian' {
  return credentialOwner === 'self_private' ? 'chapter_director' : 'guardian'
}

export class MaturationService {
  private readonly sql: Sql
  private readonly authorize: MaturationAuthorizeFn
  private readonly config: AppConfig

  constructor(deps: MaturationServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.config = { ...defaultConfig, ...deps.config }
  }

  // ---- addEmail (POST /auth/email/add; SELF, 18+) --------------------------
  /**
   * Flow D step 2. The 18+ student adds their email, moving the account
   * `minor -> maturation_pending`. Self-initiated (the acting account must be the
   * subject) and age-gated (18+). The email replaces the username identity (the
   * account is `email XOR username`), but the guardianship edge is NOT lapsed yet
   * — guardian READ persists through `maturation_pending`, ending only at confirm
   * or the 90-day backstop.
   */
  async addEmail(accountId: string, email: string, ctx: AuthContext): Promise<AddEmailResult> {
    if (ctx.account.id !== accountId) throw new MaturationNotSelfError(accountId, ctx.account.id)
    if (ctx.account.age < ADD_EMAIL_MIN_AGE) {
      throw new MaturationAgeError('add_email', ADD_EMAIL_MIN_AGE, ctx.account.age)
    }

    const [acct] = await this.sql`select maturation_state from account where id = ${accountId}`
    if (acct === undefined) throw new MaturationAccountNotFoundError(accountId)

    const from = acct.maturation_state as string
    const legal = canTransition('account_maturation', from, 'maturation_pending')
    if (!legal.allowed) {
      throw new IllegalMaturationTransitionError(from, 'maturation_pending', legal.reason)
    }

    // Set the email and clear the username (the account becomes email-identified),
    // and move to maturation_pending. The status guard makes it safe against a
    // concurrent add.
    const updated = await this.sql`
      update account
      set email = ${email}, username = ${null}, maturation_state = 'maturation_pending'
      where id = ${accountId} and maturation_state = 'minor'
      returning id
    `
    if (updated.length === 0) {
      throw new IllegalMaturationTransitionError(from, 'maturation_pending', 'illegal_transition')
    }
    return { accountId, email, maturationState: 'maturation_pending' }
  }

  // ---- confirmMaturation (POST /ops/maturations/:id/confirm; maturation.confirm)
  /**
   * Flow D step 3. Gated through `authorize` under `maturation.confirm` (chapter-
   * scoped, Chapter Director). In one transaction the account moves
   * `maturation_pending -> self_managed` (email-capable) AND every `verified`
   * guardianship edge for the student lapses (`verified -> lapsed`), so the
   * guardian's `view_child_record` no longer resolves. Audited.
   */
  async confirmMaturation(accountId: string, ctx: AuthContext): Promise<ConfirmMaturationResult> {
    const [row] = await this.sql`
      select
        a.maturation_state as maturation_state,
        (
          select chapter_id from enrollment_record
          where student_account_id = a.id order by created_at desc limit 1
        ) as chapter_id
      from account a where a.id = ${accountId}
    `
    if (row === undefined) throw new MaturationAccountNotFoundError(accountId)
    const chapterId = row.chapter_id as string | null
    if (chapterId === null) throw new MaturationChapterNotFoundError(accountId)

    // Authorize against the enrolling chapter (writes one permission.denied and
    // throws Forbidden on deny), BEFORE any mutation or transaction.
    const resource: Resource = { id: accountId, chapter_id: chapterId }
    await this.authorize(ctx, 'maturation.confirm', resource, { sql: this.sql })

    const from = row.maturation_state as string
    const legal = canTransition('account_maturation', from, 'self_managed')
    if (!legal.allowed) {
      throw new IllegalMaturationTransitionError(from, 'self_managed', legal.reason)
    }

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision

      const accUpd = await tx`
        update account set maturation_state = 'self_managed'
        where id = ${accountId} and maturation_state = 'maturation_pending'
        returning id
      `
      if (accUpd.length === 0) {
        throw new IllegalMaturationTransitionError(from, 'self_managed', 'illegal_transition')
      }

      // Lapse the guardianship edge(s): the coupled `verified -> lapsed`.
      const lapsed = await tx`
        update guardianship set status = 'lapsed'
        where student_account_id = ${accountId} and status = 'verified'
        returning id
      `

      await writeAudit(tx, {
        action: 'maturation.confirm',
        subjectType: 'account',
        subjectId: accountId,
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail: { edgesLapsed: lapsed.length },
      })

      return { accountId, chapterId, edgesLapsed: lapsed.length }
    }) as Promise<ConfirmMaturationResult>
  }

  // ---- sweepMaturationBackstop (the system job; NO actor) ------------------
  /**
   * The 90-day backstop (04-state-machines: the edge lapses automatically if
   * maturation is not completed within 90 days of the 18th birthday, with a
   * notice to both parties 30 days prior). Computed from `date_of_birth`:
   *   - LAPSE when the 18th birthday + 90 days is strictly in the past
   *     (`birthday + 90d < now`) and the account is not yet `self_managed`.
   *   - NOTICE (30 days prior) when the 18th birthday + 60 days has arrived but
   *     the lapse has not (`birthday + 60d <= now < birthday + 90d`).
   * No actor -> NOT through `authorize` (like the other system sweeps). The
   * `notify` seam fires post-commit. `now` defaults to the wall clock; tests pass
   * it explicitly. Idempotent: a lapsed/self_managed account is not revisited.
   */
  async sweepMaturationBackstop(
    deps: SweepMaturationDeps,
    now: Date = new Date(),
  ): Promise<SweepMaturationResult> {
    // Compare on dates (UTC), so the 90/60-day marks are tz-independent.
    const nowDate = now.toISOString().slice(0, 10)

    const lapsedRows = await deps.sql.begin(async (tx) => {
      return tx`
        update guardianship g set status = 'lapsed'
        from account a
        where a.id = g.student_account_id
          and g.status = 'verified'
          and a.maturation_state <> 'self_managed'
          and (a.date_of_birth + interval '18 years' + interval '90 days') < ${nowDate}::date
        returning g.student_account_id as student
      `
    })
    const lapsed = lapsedRows.map((r) => r.student as string)

    // The 30-day-prior notice window: birthday + 60d has arrived, birthday + 90d
    // has not (still verified, still unmatured).
    const noticeRows = await deps.sql`
      select
        g.student_account_id as student,
        g.id as guardianship_id,
        (a.date_of_birth + interval '18 years' + interval '90 days')::date as lapses_at
      from guardianship g
      join account a on a.id = g.student_account_id
      where g.status = 'verified'
        and a.maturation_state <> 'self_managed'
        and (a.date_of_birth + interval '18 years' + interval '60 days') <= ${nowDate}::date
        and (a.date_of_birth + interval '18 years' + interval '90 days') > ${nowDate}::date
    `
    const notified = noticeRows.map((r) => r.student as string)
    if (deps.notify !== undefined) {
      for (const r of noticeRows) {
        await deps.notify({
          accountId: r.student as string,
          guardianshipId: r.guardianship_id as string,
          lapsesAt: r.lapses_at as Date | string,
        })
      }
    }

    return { lapsed, notified }
  }

  // ---- reissueSetup (POST /ops/accounts/:id/reissue-setup; account.recover) --
  /**
   * Flow D step 4. Gated through `authorize` under `account.recover` (chapter-
   * scoped, Chapter Director). For a LOCKED-OUT adult FORMER student — one with NO
   * active membership — mint a fresh setup token (they add an email and set a new
   * password) returned once (the mailer seam), and audit the recovery. REJECTED
   * against any account that still holds an active membership. The token store /
   * consumption (the setup endpoint) is a deferred seam, like the mailer.
   */
  async reissueSetup(accountId: string, ctx: AuthContext): Promise<ReissueSetupResult> {
    const [row] = await this.sql`
      select
        a.id as id,
        (
          select chapter_id from enrollment_record
          where student_account_id = a.id order by created_at desc limit 1
        ) as chapter_id
      from account a where a.id = ${accountId}
    `
    if (row === undefined) throw new MaturationAccountNotFoundError(accountId)
    const chapterId = row.chapter_id as string | null
    if (chapterId === null) throw new MaturationChapterNotFoundError(accountId)

    // Authorize against the enrolling chapter, BEFORE any mutation.
    const resource: Resource = { id: accountId, chapter_id: chapterId }
    await this.authorize(ctx, 'account.recover', resource, { sql: this.sql })

    // Recovery is for a locked-out FORMER student: reject an active membership.
    const [active] = await this.sql`
      select count(*)::int as n from membership where account_id = ${accountId} and status = 'active'
    `
    if ((active?.n as number) > 0) throw new ReissueActiveMembershipError(accountId)

    const token = generateSessionToken()
    const expiresAt = new Date(Date.now() + this.config.inviteTtlMs)

    await this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      // Record the recovery (references only, never PII).
      await writeAudit(tx, {
        action: 'account.recover',
        subjectType: 'account',
        subjectId: accountId,
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail: { reason: 'reissue_setup', method: 'documented_identity_check' },
      })
    })

    return { accountId, chapterId, token, expiresAt }
  }

  // ---- privatizeCredential (the 16+ self_private transition; SELF) ----------
  /**
   * The 16+ credential privatization (06-onboarding-flows "The `self_private`
   * transition"). Self-initiated from the student's own authenticated session
   * (16+), it sets `credential_owner = self_private`. It REQUIRES a `witnessedBy`
   * that is an active NON-guardian chapter adult (a teaching/staff membership),
   * because a guardian holding the child's credentials is cryptographically
   * indistinguishable from the child. Rejected under 16, without a witness, or
   * when the witness is a guardian of that student. Afterwards, password reset
   * routes to the Chapter Director (`passwordResetRoute`), recorded in the audit.
   */
  async privatizeCredential(
    accountId: string,
    ctx: AuthContext,
    options: { witnessedBy?: string | null },
  ): Promise<PrivatizeCredentialResult> {
    if (ctx.account.id !== accountId) throw new MaturationNotSelfError(accountId, ctx.account.id)
    if (ctx.account.age < PRIVATIZE_MIN_AGE) {
      throw new MaturationAgeError('privatize_credential', PRIVATIZE_MIN_AGE, ctx.account.age)
    }
    const witnessedBy = options.witnessedBy ?? null
    if (witnessedBy === null) throw new CredentialWitnessRequiredError()

    // Resolve the student's enrolling chapter (the witness must be active there).
    const [enr] = await this.sql`
      select chapter_id from enrollment_record
      where student_account_id = ${accountId} order by created_at desc limit 1
    `
    if (enr === undefined) throw new MaturationChapterNotFoundError(accountId)
    const chapterId = enr.chapter_id as string
    const nowDate = new Date().toISOString().slice(0, 10)

    // Witness facts: adulthood, whether they are a guardian of this student, and
    // whether they hold an active teaching/staff membership in the chapter.
    const [w] = await this.sql`
      select
        (a.date_of_birth + interval '18 years' <= ${nowDate}::date) as is_adult,
        exists(
          select 1 from guardianship g
          where g.guardian_account_id = ${witnessedBy} and g.student_account_id = ${accountId}
            and g.status = 'verified'
        ) as is_guardian,
        exists(
          select 1 from membership m
          where m.account_id = ${witnessedBy} and m.chapter_id = ${chapterId}
            and m.status = 'active' and m.role in ${this.sql(WITNESS_ROLES as unknown as string[])}
        ) as has_staff_membership
      from account a where a.id = ${witnessedBy}
    `
    if (w === undefined) throw new CredentialWitnessInvalidError(witnessedBy)
    if (w.is_guardian === true) throw new CredentialWitnessIsGuardianError(witnessedBy, accountId)
    if (w.is_adult !== true || w.has_staff_membership !== true) {
      throw new CredentialWitnessInvalidError(witnessedBy)
    }

    const route = passwordResetRoute('self_private')
    await this.sql.begin(async (tx) => {
      const upd = await tx`
        update account set credential_owner = 'self_private'
        where id = ${accountId} and credential_owner = 'guardian_provisioned'
        returning id
      `
      if (upd.length === 0) {
        // Either the account is gone or it is already self_private. Distinguish.
        const [exists] = await tx`select 1 from account where id = ${accountId}`
        if (exists === undefined) throw new MaturationAccountNotFoundError(accountId)
        return // already self_private: idempotent no-op, no second audit
      }
      // Record the witnessed transition and the reset-routing decision (references
      // only — the witness id is a reference, never PII).
      await writeAudit(tx, {
        action: 'credential.privatized',
        subjectType: 'account',
        subjectId: accountId,
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail: { witnessedBy, passwordResetRoute: route },
      })
    })

    return {
      accountId,
      credentialOwner: 'self_private',
      witnessedBy,
      // `route` is `passwordResetRoute('self_private')`, i.e. always 'chapter_director'
      // here; stated as the literal so the result type is precise.
      passwordResetRoute: 'chapter_director',
    }
  }
}
