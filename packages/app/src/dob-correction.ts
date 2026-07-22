// -------------------------------------------------------------------------
// DobCorrectionService — the ONLY sanctioned updater of the write-once DOBs
// (02-data-model.md "enrollment_record"; decision-log.md "DOB on the enrollment
// record, reversed and refined"). Both account.date_of_birth and the seeding
// enrollment_record.date_of_birth are write-once: the database triggers forbid
// ordinary updates, permitting a change only inside a transaction that set the
// sanctioned-correction flag `app.dob_correction = 'on'`. This service is the
// single write path that trips that bypass, and it is audited.
//
// The correction is gated through `authorize` under `dob.correct` (chapter-scoped
// to the subject's enrolling chapter, Chapter Director; platform_admin via
// platformGrant). In one transaction it sets the flag (SET LOCAL, so it is scoped
// to the transaction and no ordinary write path can trip it), updates the account
// and its seeding enrollment record, writes a `dob.correct` audit entry carrying
// the reason but NO DOB value (audit detail holds references, never PII), and
// commits. An update outside this service is still blocked by the write-once
// triggers.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP route
// (POST /ops/accounts/:id/dob-correction) is wired later.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, writeAudit, type AuthorizeDeps } from '@curiolab/runtime'
import { DobCorrectionSubjectNotFoundError } from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's one capability
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type DobCorrectionAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'dob.correct',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface DobCorrectionServiceDeps {
  sql: Sql
  authorize: DobCorrectionAuthorizeFn
}

/** The account whose DOB is being corrected. */
export interface DobCorrectionSubject {
  accountId: string
}

export interface DobCorrectionResult {
  accountId: string
  /** The enrolling chapter the correction was authorized against. */
  chapterId: string
  /** How many enrollment-record DOB copies were corrected (the seeding one). */
  enrollmentRecordsCorrected: number
}

/** The transaction-local GUC the write-once triggers consult. */
const CORRECTION_FLAG_SQL = "set local app.dob_correction = 'on'"

export class DobCorrectionService {
  private readonly sql: Sql
  private readonly authorize: DobCorrectionAuthorizeFn

  constructor(deps: DobCorrectionServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Correct the write-once DOB of `subject` to `newDob` (ISO `YYYY-MM-DD`).
   *
   * Resolves the subject's enrolling chapter from their most recent enrollment
   * record, authorizes `dob.correct` against it, then in one transaction sets the
   * sanctioned-correction flag, updates the account's DOB and the seeding
   * enrollment record's DOB copy, and writes an audited `dob.correct` entry
   * (reason only, no DOB value).
   */
  async correct(
    subject: DobCorrectionSubject,
    newDob: string,
    ctx: AuthContext,
    reason: string,
  ): Promise<DobCorrectionResult> {
    const accountId = subject.accountId

    // Resolve the enrolling chapter: the subject's most recent enrollment record.
    // A student always has one (the seeding enrollment, later backfilled). Without
    // one there is no chapter to scope the correction against.
    const [enrollment] = await this.sql`
      select chapter_id
      from enrollment_record
      where student_account_id = ${accountId}
      order by created_at desc
      limit 1
    `
    if (enrollment === undefined) {
      throw new DobCorrectionSubjectNotFoundError(accountId)
    }
    const chapterId = enrollment.chapter_id as string

    // Authorize against the enrolling chapter (writes one permission.denied and
    // throws Forbidden on deny), BEFORE any mutation or transaction.
    const resource: Resource = { id: accountId, chapter_id: chapterId }
    await this.authorize(ctx, 'dob.correct', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision

      // The sanctioned bypass: transaction-local, so it cannot leak to any other
      // write path. The write-once triggers permit the DOB change only while set.
      await tx.unsafe(CORRECTION_FLAG_SQL)

      const acct = await tx`
        update account set date_of_birth = ${newDob} where id = ${accountId} returning id
      `
      if (acct.length === 0) {
        throw new DobCorrectionSubjectNotFoundError(accountId)
      }

      // Correct the seeding enrollment record's DOB copy too (the record that
      // carries a non-null date_of_birth for this student), so the two immutable
      // copies stay identical.
      const enr = await tx`
        update enrollment_record set date_of_birth = ${newDob}
        where student_account_id = ${accountId} and date_of_birth is not null
        returning id
      `

      // Audit: references and the reason only — never the DOB value (PII).
      await writeAudit(tx, {
        action: 'dob.correct',
        subjectType: 'account',
        subjectId: accountId,
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail: { reason, enrollmentRecordsCorrected: enr.length },
      })

      return { accountId, chapterId, enrollmentRecordsCorrected: enr.length }
    }) as Promise<DobCorrectionResult>
  }
}
