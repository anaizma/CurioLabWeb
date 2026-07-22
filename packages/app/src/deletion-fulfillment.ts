// -------------------------------------------------------------------------
// DeletionFulfillmentService — the ops compliance side of Milestone 1: a
// Chapter Director reviews a filed deletion_request and fulfills it under the
// tiered-deletion schedule. Grounded in compliance-coppa.md 1.6 (§ 312.6: the
// parent's deletion right wins; § 312.6(c) permits terminating the child's
// participation as the documented consequence) and Part 3 (full erase removes
// the verification skeleton, redaction preserves an anonymized one),
// 04-state-machines.md (the deletion_request lifecycle; the offboard bundle
// coupling B), and 02-data-model.md (audit `detail` holds references, never the
// erased PII; the refused-needs-a-reason DB CHECK).
//
// Two capabilities, both chapter-scoped to the subject's enrolling chapter and
// gated through `authorize` (Chapter Director; platform_admin via platformGrant):
//
//   - reviewDeletion:  deletion.review  — moves `requested -> under_review`.
//   - fulfillDeletion: deletion.fulfill — in ONE transaction, applies the review
//     outcome. For an erasing outcome (full / redaction / partial) the order is:
//       1. TERMINATE PARTICIPATION FIRST (§ 312.6(c); coupling B shape): offboard
//          the student membership(s), close the account, revoke every session.
//          This removes the active-student status BEFORE any DOB change, so the
//          decision-4 DOB trigger (which fires on membership writes for an ACTIVE
//          student) is never evaluated against a still-active student.
//       2. Apply the tier:
//            full      -> erase contact/name/DOB AND remove the verification
//                         skeleton (tier history + current_tier); fulfilled_full.
//            redaction -> strip contact/name/DOB but PRESERVE the anonymized
//                         skeleton (tier reached, tier history); fulfilled_redaction.
//            partial   -> the redaction strip, documented as incomplete with a
//                         required decision_reason; partially_fulfilled.
//            refused   -> NO data change, NO termination; refused. The reason is a
//                         DB CHECK (migration 0008), so a null reason is rejected
//                         by the database, not pre-validated here.
//       3. Write ONE audit_entry (deletion.fulfilled / deletion.refused) holding
//          REFERENCES only (ids, decision, reason) — never the erased PII.
//
// The DOB is write-once (migration 0006). The erase nulls/tombstones it through
// the SANCTIONED transaction-local flag `app.retention_erase = 'on'` (migration
// 0009), set here and ONLY here. Because SET LOCAL is transaction-scoped, an
// ordinary write path can never trip it, so this service is the only DOB-erase
// path. The audit_entry rows themselves are append-only and are NOT deleted.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP route
// is wired later (step 8).
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { canTransition } from '@curiolab/core'
import { assertAuthorized, writeAudit, type AuthorizeDeps } from '@curiolab/runtime'
import type { Db } from './events.js'
import {
  DeletionReasonRequiredError,
  DeletionRequestNotFoundError,
  DeletionSubjectChapterNotFoundError,
  IllegalDeletionTransitionError,
} from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's two
 * capabilities (structurally the runtime `authorize` wrapper; taken by injection
 * so the deny/backstop paths are testable without HTTP).
 */
export type DeletionFulfillmentAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'deletion.review' | 'deletion.fulfill',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface DeletionFulfillmentServiceDeps {
  sql: Sql
  authorize: DeletionFulfillmentAuthorizeFn
}

/**
 * The reviewer's decision. `refused` and `partial` carry a reason: `refused`'s is
 * enforced by the DB CHECK (0008); `partial`'s is required here (no DB check).
 */
export type DeletionOutcome =
  | { decision: 'full' }
  | { decision: 'redaction' }
  | { decision: 'refused'; decisionReason?: string | null }
  | { decision: 'partial'; decisionReason: string }

export type DeletionRequestStatus =
  | 'requested'
  | 'under_review'
  | 'fulfilled_full'
  | 'fulfilled_redaction'
  | 'partially_fulfilled'
  | 'refused'

export interface ReviewDeletionResult {
  deletionRequestId: string
  subjectAccountId: string
  status: 'under_review'
}

export interface FulfillDeletionResult {
  deletionRequestId: string
  subjectAccountId: string
  status: Exclude<DeletionRequestStatus, 'requested' | 'under_review'>
  /** True when the erasing branch offboarded + closed + revoked (not for refused). */
  participationTerminated: boolean
  /** True only for a full erase (the verification skeleton was removed). */
  skeletonRemoved: boolean
}

/** The tombstone written over a redacted text PII field (matches retention.ts). */
const PII_TOMBSTONE = '[redacted]'
/** The DOB tombstone: account.date_of_birth is NOT NULL, so a sentinel date. */
const DOB_TOMBSTONE = '1900-01-01'
/** The transaction-local GUC the write-once DOB triggers consult (migration 0009). */
const RETENTION_ERASE_FLAG_SQL = "set local app.retention_erase = 'on'"

/** The target deletion_request status for each decision. */
const STATUS_FOR: Record<DeletionOutcome['decision'], FulfillDeletionResult['status']> = {
  full: 'fulfilled_full',
  redaction: 'fulfilled_redaction',
  partial: 'partially_fulfilled',
  refused: 'refused',
}

interface DeletionRequestRow {
  subjectAccountId: string
  status: string
}

export class DeletionFulfillmentService {
  private readonly sql: Sql
  private readonly authorize: DeletionFulfillmentAuthorizeFn

  constructor(deps: DeletionFulfillmentServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /** Load the request's subject and status (the id may not exist -> typed 404). */
  private async loadRequest(requestId: string): Promise<DeletionRequestRow> {
    const [row] = await this.sql`
      select subject_account_id, status from deletion_request where id = ${requestId}
    `
    if (row === undefined) throw new DeletionRequestNotFoundError(requestId)
    return { subjectAccountId: row.subject_account_id as string, status: row.status as string }
  }

  /**
   * The subject's enrolling chapter — the authorization scope. Resolved from the
   * subject's most recent enrollment record (a student always has one), the same
   * way DobCorrectionService scopes its correction.
   */
  private async resolveChapter(subjectAccountId: string): Promise<string> {
    const [row] = await this.sql`
      select chapter_id from enrollment_record
      where student_account_id = ${subjectAccountId}
      order by created_at desc limit 1
    `
    if (row === undefined) throw new DeletionSubjectChapterNotFoundError(subjectAccountId)
    return row.chapter_id as string
  }

  /**
   * deletion.review — move a `requested` deletion to `under_review`. Authorized
   * against the subject's enrolling chapter, then the status change rides a
   * transaction that asserts the recorded decision (the repository-write backstop).
   */
  async reviewDeletion(requestId: string, ctx: AuthContext): Promise<ReviewDeletionResult> {
    const req = await this.loadRequest(requestId)
    const chapterId = await this.resolveChapter(req.subjectAccountId)

    const legal = canTransition('deletion_request', req.status, 'under_review')
    if (!legal.allowed) {
      throw new IllegalDeletionTransitionError(req.status, 'under_review', legal.reason)
    }

    const resource: Resource = { id: requestId, chapter_id: chapterId }
    await this.authorize(ctx, 'deletion.review', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const upd = await tx`
        update deletion_request set status = 'under_review'
        where id = ${requestId} and status = 'requested'
        returning id
      `
      if (upd.length === 0) {
        // Raced to a non-requested state between the read and the write.
        throw new IllegalDeletionTransitionError(req.status, 'under_review', 'illegal_transition')
      }
      return {
        deletionRequestId: requestId,
        subjectAccountId: req.subjectAccountId,
        status: 'under_review' as const,
      }
    }) as Promise<ReviewDeletionResult>
  }

  /**
   * deletion.fulfill — apply the review outcome in ONE transaction, ordered so
   * the decision-4 trigger never fires against a still-active student. See the
   * file header for the full ordering.
   */
  async fulfillDeletion(
    requestId: string,
    ctx: AuthContext,
    outcome: DeletionOutcome,
  ): Promise<FulfillDeletionResult> {
    // Fail fast on a partial with no reason (no DB check exists for it), BEFORE
    // any authorization or mutation.
    if (outcome.decision === 'partial' && !outcome.decisionReason?.trim()) {
      throw new DeletionReasonRequiredError('partial')
    }

    const req = await this.loadRequest(requestId)
    const chapterId = await this.resolveChapter(req.subjectAccountId)
    const targetStatus = STATUS_FOR[outcome.decision]

    // Fulfillment is only legal from `under_review` (04-state-machines).
    const legal = canTransition('deletion_request', req.status, targetStatus)
    if (!legal.allowed) {
      throw new IllegalDeletionTransitionError(req.status, targetStatus, legal.reason)
    }

    const resource: Resource = { id: requestId, chapter_id: chapterId }
    await this.authorize(ctx, 'deletion.fulfill', resource, { sql: this.sql })

    const subjectAccountId = req.subjectAccountId
    const erasing = outcome.decision !== 'refused'
    const skeletonRemoved = outcome.decision === 'full'
    const decisionReason =
      outcome.decision === 'refused' || outcome.decision === 'partial'
        ? (outcome.decisionReason ?? null)
        : null

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision

      if (erasing) {
        // The sanctioned DOB-erase bypass: transaction-local, so it cannot leak
        // to any other write path (migration 0009).
        await tx.unsafe(RETENTION_ERASE_FLAG_SQL)

        // 1. Terminate participation FIRST (§ 312.6(c); coupling B shape).
        await this.terminateParticipation(tx, subjectAccountId)

        // 2. Apply the tier: strip PII always; remove the skeleton only for full.
        await this.eraseChildData(tx, subjectAccountId, skeletonRemoved)
      }

      // The decision record. For `refused` a null reason trips the DB CHECK here,
      // aborting the transaction before the audit write (a clean rollback).
      const upd = await tx`
        update deletion_request
        set status = ${targetStatus}, reviewed_by = ${ctx.account.id},
            decision_reason = ${decisionReason}, decided_at = now()
        where id = ${requestId} and status = 'under_review'
        returning id
      `
      if (upd.length === 0) {
        throw new IllegalDeletionTransitionError(req.status, targetStatus, 'illegal_transition')
      }

      // 3. Audit by REFERENCE only — never the erased PII in `detail`.
      await writeAudit(tx, {
        action: erasing ? 'deletion.fulfilled' : 'deletion.refused',
        subjectType: 'account',
        subjectId: subjectAccountId,
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail: {
          deletionRequestId: requestId,
          decision: outcome.decision,
          participationTerminated: erasing,
          skeletonRemoved,
          ...(decisionReason !== null ? { decisionReason } : {}),
        },
      })

      return {
        deletionRequestId: requestId,
        subjectAccountId,
        status: targetStatus,
        participationTerminated: erasing,
        skeletonRemoved,
      }
    }) as Promise<FulfillDeletionResult>
  }

  /**
   * The offboard bundle (coupling B shape) for a deletion: offboard the student's
   * membership(s), close the account, and revoke every live session. This removes
   * the active-student status before the DOB erase. A deletion does not mint an
   * alumni membership — that is the graceful-offboard variant; here the child is
   * leaving entirely (§ 312.6(c) termination).
   */
  private async terminateParticipation(tx: Db, subjectAccountId: string): Promise<void> {
    // The offboard fires the decision-4 trigger with NEW.status='offboarded'
    // (role='student', not active) -> it passes. active/inactive are the legal
    // `-> offboarded` edges (04-state-machines).
    await tx`
      update membership set status = 'offboarded'
      where account_id = ${subjectAccountId}
        and role = 'student'
        and status in ('active', 'inactive')
    `
    await tx`update account set status = 'closed' where id = ${subjectAccountId}`
    await tx`
      update session set revoked_at = now()
      where revoked_at is null
        and (account_id = ${subjectAccountId} or impersonated_account_id = ${subjectAccountId})
    `
  }

  /**
   * Strip the child's erasable personal data. `removeSkeleton` distinguishes a
   * FULL erase (remove the verification skeleton: tier history + current_tier)
   * from a REDACTION (preserve the anonymized skeleton — tier reached, titles,
   * dates). Narrative/media/timeline are placeholders until the M2/M3 tables
   * land. DOB is tombstoned through the retention flag set by the caller.
   */
  private async eraseChildData(
    tx: Db,
    subjectAccountId: string,
    removeSkeleton: boolean,
  ): Promise<void> {
    // Contact, name, DOB, and the identifier. The identity CHECK requires exactly
    // one of email/username, so each non-null one is tombstoned to a unique,
    // non-identifying value; the null one stays null.
    await tx`
      update account set
        legal_name = ${PII_TOMBSTONE},
        display_name = ${PII_TOMBSTONE},
        username = case when username is not null then 'redacted-' || id::text else null end,
        email = case when email is not null then 'redacted-' || id::text || '@redacted.invalid' else null end,
        date_of_birth = ${DOB_TOMBSTONE}
      where id = ${subjectAccountId}
    `

    // Guardian details and the DOB copy on the enrollment record(s).
    await tx`
      update enrollment_record set
        guardian_name_on_form = ${PII_TOMBSTONE},
        date_of_birth = case when date_of_birth is not null then ${DOB_TOMBSTONE}::date else null end
      where student_account_id = ${subjectAccountId}
    `

    if (removeSkeleton) {
      await tx`
        delete from tier_transition
        where membership_id in (
          select id from membership where account_id = ${subjectAccountId} and role = 'student'
        )
      `
      await tx`
        update membership set current_tier = null
        where account_id = ${subjectAccountId} and role = 'student'
      `
    }
  }
}
