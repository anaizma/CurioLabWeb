// -------------------------------------------------------------------------
// GuardianshipService — Milestone 1 step 4: guardian verification and the name
// match (Flow A step 6, the authority floor; 04-state-machines guardianship
// `pending -> verified` / `pending -> rejected`, both triggered by
// `guardianship.verify`, actor chapter_director).
//
// The Director verifies the accepting guardian by matching the name on their
// account to the name on the signed form. On MATCH the edge verifies and its
// write-once provenance facts are stamped. On MISMATCH the edge is rejected AND
// the accepting account is closed, in ONE transaction — Flow A's "wrong-person
// acceptance is contained by shape": authority attaches only at name-match.
//
// Two rulings this service obeys:
//   1. `consent` is append-only. Verification MUST NOT touch any consent row.
//      Form-sourced consents keep `granted_by = null`; the verified edge carries
//      the provenance via `source_ref` (the signed-form scan) instead of a
//      backfill. (This overrides the 04/06 prose that says verification
//      "backfills granted_by"; see the app-layer report.)
//   2. The provenance fields live on the guardianship row itself, which is
//      mutable-status with WRITE-ONCE verification facts.
//
// Framework-agnostic: the db handle, `authorize`, and config are injected; the
// HTTP route (POST /ops/guardianships/:id/verify) is wired later.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { canTransition } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { type AppConfig, defaultConfig, type GuardianVerificationMethod } from './config.js'
import { GuardianshipNotFoundError, IllegalGuardianshipTransitionError } from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's one
 * capability (structurally the runtime `authorize` wrapper; taken by injection
 * so the deny/backstop paths are testable without HTTP).
 */
export type GuardianshipAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'guardianship.verify',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface GuardianshipServiceDeps {
  sql: Sql
  authorize: GuardianshipAuthorizeFn
  /** Optional overrides for the config-not-code tunables. */
  config?: Partial<AppConfig>
}

export interface VerifyGuardianshipOptions {
  /**
   * The `verification_method` to record on a matched edge. Defaults to the
   * config value (`signed_form_match`). `in_person_witnessed` is the supported
   * override for a witnessed, non-form verification.
   */
  verificationMethod?: GuardianVerificationMethod
}

export interface VerifyGuardianshipResult {
  guardianshipId: string
  /** The resulting edge state. */
  status: 'verified' | 'rejected'
  /** Whether the name on the account matched the name on the form. */
  matched: boolean
  /** Whether the accepting account was closed (mismatch only). */
  accountClosed: boolean
}

export class GuardianshipService {
  private readonly sql: Sql
  private readonly authorize: GuardianshipAuthorizeFn
  private readonly config: AppConfig

  constructor(deps: GuardianshipServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.config = { ...defaultConfig, ...deps.config }
  }

  /**
   * POST /ops/guardianships/:id/verify — Flow A step 6. Gated through
   * `authorize` under `guardianship.verify` (chapter-scoped, Chapter Director).
   *
   * Loads the edge and its bound enrollment record, compares the accepting
   * account's `legal_name` to `enrollment_record.guardian_name_on_form` under the
   * documented normalization, then in one transaction either verifies the edge
   * (stamping `verified_by`, `source_ref` = the signed-form scan, `verified_at`,
   * and `verification_method`) or rejects it and closes the accepting account.
   */
  async verifyGuardianship(
    guardianshipId: string,
    ctx: AuthContext,
    options: VerifyGuardianshipOptions = {},
  ): Promise<VerifyGuardianshipResult> {
    // Load the edge and the bound enrollment record. The guardianship row carries
    // no enrollment_record FK, so the binding is resolved via the shared
    // student; a student may hold several enrollment records across terms, so we
    // take the most recent (the enrollment this onboarding concerns). This
    // resolution is documented in the app-layer report.
    const [row] = await this.sql`
      select
        g.id                     as id,
        g.status                 as status,
        g.guardian_account_id    as guardian_account_id,
        g.student_account_id     as student_account_id,
        acc.legal_name           as guardian_legal_name,
        e.id                     as enrollment_id,
        e.chapter_id             as chapter_id,
        e.guardian_name_on_form  as guardian_name_on_form,
        e.signed_form_ref        as signed_form_ref
      from guardianship g
      join account acc on acc.id = g.guardian_account_id
      join lateral (
        select id, chapter_id, guardian_name_on_form, signed_form_ref
        from enrollment_record
        where student_account_id = g.student_account_id
        order by created_at desc
        limit 1
      ) e on true
      where g.id = ${guardianshipId}
    `
    if (row === undefined) throw new GuardianshipNotFoundError(guardianshipId)

    // Authorize against the enrolling chapter (writes one permission.denied and
    // throws Forbidden on deny), BEFORE any mutation or transaction.
    const resource: Resource = {
      id: guardianshipId,
      chapter_id: row.chapter_id as string,
      subjectAccountId: row.student_account_id as string,
    }
    await this.authorize(ctx, 'guardianship.verify', resource, { sql: this.sql })

    const fromStatus = row.status as string
    const matched = this.config.guardianNameMatch(
      row.guardian_legal_name as string,
      row.guardian_name_on_form as string,
    )
    const target = matched ? 'verified' : 'rejected'

    // Legality of the edge itself (independent of the actor): only a `pending`
    // edge is verifiable. An already verified/rejected/revoked/lapsed edge is
    // rejected here via the pure transition guard.
    const legal = canTransition('guardianship', fromStatus, target)
    if (!legal.allowed) {
      throw new IllegalGuardianshipTransitionError(fromStatus, target, legal.reason)
    }

    const method = options.verificationMethod ?? this.config.guardianVerificationMethod
    const guardianAccountId = row.guardian_account_id as string
    const signedFormRef = row.signed_form_ref as string

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision

      if (matched) {
        // MATCH: pending -> verified, stamping the write-once provenance facts.
        // The `status = 'pending'` guard makes the transition idempotent-safe
        // against a concurrent verify.
        const updated = await tx`
          update guardianship set
            status              = 'verified',
            verified_by         = ${ctx.account.id},
            source_ref          = ${signedFormRef},
            verified_at         = now(),
            verification_method = ${method}
          where id = ${guardianshipId} and status = 'pending'
          returning id
        `
        if (updated.length === 0) {
          throw new IllegalGuardianshipTransitionError(fromStatus, 'verified', 'illegal_transition')
        }
        return { guardianshipId, status: 'verified', matched: true, accountClosed: false }
      }

      // MISMATCH: pending -> rejected AND close the accepting account, atomically.
      const rejected = await tx`
        update guardianship set status = 'rejected'
        where id = ${guardianshipId} and status = 'pending'
        returning id
      `
      if (rejected.length === 0) {
        throw new IllegalGuardianshipTransitionError(fromStatus, 'rejected', 'illegal_transition')
      }
      await tx`
        update account set status = 'closed' where id = ${guardianAccountId}
      `
      return { guardianshipId, status: 'rejected', matched: false, accountClosed: true }
    }) as Promise<VerifyGuardianshipResult>
  }
}
