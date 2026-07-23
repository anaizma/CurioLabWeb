// -------------------------------------------------------------------------
// MembershipActivationService — Milestone 1 step 6, part C. Flow B step 3
// (06-onboarding-flows): the Chapter Director activates a pending student. In
// ONE transaction the membership and its account move `pending -> active`
// together (coupling A) and the initial Explorer `tier_transition` is written
// (coupling F), gated on an active `enrollment` consent (04-state-machines
// membership `pending -> active`: "requires active `enrollment` consent for a
// student").
//
// The active-consent check is the serialization point for this consent-touching
// coupling: it takes `SELECT ... FOR UPDATE` on the student's `enrollment`
// `consent_current` row (04-state-machines locking) so a concurrent revoke
// cannot slip between the read and the activation.
//
// The decision-4 DOB trigger fires as the student membership flips to `active`:
// it PASSES for a properly seeded student (the account created at accept-student
// carries `dob_provenance = 'enrollment_record'` with a non-null
// `dob_source_ref`) and REJECTS an account that lacks that provenance — the
// database floor, independent of this code.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP route
// (POST /ops/memberships/:id/activate) is wired later.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { canTransition } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import {
  IllegalMembershipTransitionError,
  MembershipActivationConsentError,
  MembershipActivationEvidenceError,
  MembershipNotFoundError,
} from './errors.js'
import {
  MilestoneService,
  MILESTONE_JOINED_BODY,
  MILESTONE_JOINED_KIND,
  MILESTONE_TIER_KIND,
  tierMilestoneBody,
} from './milestone.js'

/**
 * The injected `authorize` dependency, narrowed to this service's one capability
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type MembershipActivationAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'member.activate',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface MembershipActivationServiceDeps {
  sql: Sql
  authorize: MembershipActivationAuthorizeFn
  /**
   * The system milestone emitter (M2.5). Defaults to a fresh MilestoneService.
   * Injected so the seed-milestone wiring is overridable in tests (e.g. to prove
   * the emit shares this coupling's transaction).
   */
  milestones?: MilestoneService
}

export interface ActivateStudentOptions {
  /** An optional note recorded on the initial tier_transition. */
  note?: string | null
}

export interface ActivateStudentResult {
  membershipId: string
  accountId: string
  /** The initial Explorer tier_transition written by this activation. */
  tierTransitionId: string
  tier: 'explorer'
}

export class MembershipActivationService {
  private readonly sql: Sql
  private readonly authorize: MembershipActivationAuthorizeFn
  private readonly milestones: MilestoneService

  constructor(deps: MembershipActivationServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.milestones = deps.milestones ?? new MilestoneService()
  }

  /**
   * POST /ops/memberships/:id/activate — Flow B step 3. Gated through `authorize`
   * under `member.activate` (chapter-scoped, Chapter Director). Then, in one
   * transaction: require the student's `enrollment` consent to be active (under a
   * `FOR UPDATE` lock on its `consent_current` row), move the membership and its
   * account `pending -> active` together (coupling A), and write the initial
   * Explorer `tier_transition` whose `evidence_ref` is the enrollment record —
   * admission is the entry evidence (coupling F; the trigger syncs
   * `membership.current_tier`).
   */
  async activateStudent(
    membershipId: string,
    ctx: AuthContext,
    options: ActivateStudentOptions = {},
  ): Promise<ActivateStudentResult> {
    // Load the membership, its account standing, and the enrollment record that
    // will evidence the initial tier grant (the most recent for the student).
    const [row] = await this.sql`
      select
        m.status       as membership_status,
        m.account_id   as account_id,
        m.chapter_id   as chapter_id,
        m.pod_id       as pod_id,
        a.status       as account_status,
        (
          select e.id from enrollment_record e
          where e.student_account_id = m.account_id
          order by e.created_at desc
          limit 1
        ) as enrollment_record_id
      from membership m
      join account a on a.id = m.account_id
      where m.id = ${membershipId}
    `
    if (row === undefined) throw new MembershipNotFoundError(membershipId)

    const membershipStatus = row.membership_status as string
    const accountId = row.account_id as string
    const chapterId = row.chapter_id as string
    const podId = (row.pod_id as string | null) ?? null
    const enrollmentRecordId = row.enrollment_record_id as string | null

    // Authorize against the membership's chapter (writes one permission.denied and
    // throws Forbidden on deny), BEFORE any mutation or transaction.
    const resource: Resource = { id: membershipId, chapter_id: chapterId }
    await this.authorize(ctx, 'member.activate', resource, { sql: this.sql })

    // Legality of the membership edge itself (independent of the actor): only a
    // `pending` membership is activatable.
    const legal = canTransition('membership', membershipStatus, 'active')
    if (!legal.allowed) {
      throw new IllegalMembershipTransitionError(membershipStatus, 'active', legal.reason)
    }

    // The initial tier grant needs its evidence (admission). A properly seeded
    // student always has a linked enrollment record.
    if (enrollmentRecordId === null) {
      throw new MembershipActivationEvidenceError(membershipId)
    }

    const note = options.note ?? null

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision

      // Serialization point for the consent-touching coupling: lock the student's
      // `enrollment` consent_current row, then require it active. A concurrent
      // revoke blocks on the same row, so a student is never activated against a
      // revoked enrollment consent.
      const [cur] = await tx`
        select active from consent_current
        where student_account_id = ${accountId} and type = 'enrollment'
        for update
      `
      if (cur?.active !== true) {
        throw new MembershipActivationConsentError(membershipId)
      }

      // Coupling A: membership `pending -> active`. The status guard makes this
      // safe against a concurrent activation; the decision-4 DOB trigger fires
      // here as the student membership becomes active.
      const mUpd = await tx`
        update membership set status = 'active'
        where id = ${membershipId} and status = 'pending'
        returning id
      `
      if (mUpd.length === 0) {
        throw new IllegalMembershipTransitionError(membershipStatus, 'active', 'illegal_transition')
      }

      // Coupling A: the account `pending -> active` in the same transaction.
      const aUpd = await tx`
        update account set status = 'active'
        where id = ${accountId} and status = 'pending'
        returning id
      `
      if (aUpd.length === 0) {
        throw new IllegalMembershipTransitionError(row.account_status as string, 'active', 'illegal_transition')
      }

      // Coupling F: the initial Explorer tier_transition. evidence_ref is the
      // enrollment record (admission is the entry evidence); the AFTER INSERT
      // trigger sets membership.current_tier = 'explorer'.
      const [tt] = await tx`
        insert into tier_transition (
          membership_id, from_tier, to_tier, granted_by, evidence_ref, note
        ) values (
          ${membershipId}, ${null}, 'explorer', ${ctx.account.id}, ${enrollmentRecordId}, ${note}
        ) returning id
      `
      const tierTransitionId = tt!.id as string

      // M2.5: seed the day-one timeline and feed IN THIS SAME TRANSACTION (an
      // extension of couplings A/F), so a brand-new Explorer reads as populated
      // rather than empty. Two milestones: "Joined CurioLab" (enrollment/activation)
      // and "Reached Explorer" (tied to the initial tier grant above). The
      // milestone posts are authored by the student's own membership (the subject),
      // system_generated, and skip the consent gate.
      const occurredAt = new Date()
      await this.milestones.emit(tx, {
        accountId,
        membershipId,
        kind: MILESTONE_JOINED_KIND,
        chapterId,
        podId,
        occurredAt,
        body: MILESTONE_JOINED_BODY,
        ref: enrollmentRecordId,
      })
      await this.milestones.emit(tx, {
        accountId,
        membershipId,
        kind: MILESTONE_TIER_KIND,
        chapterId,
        podId,
        occurredAt,
        body: tierMilestoneBody('explorer'),
        ref: tierTransitionId,
      })

      return {
        membershipId,
        accountId,
        tierTransitionId,
        tier: 'explorer' as const,
      }
    }) as Promise<ActivateStudentResult>
  }
}
