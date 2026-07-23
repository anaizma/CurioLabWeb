// -------------------------------------------------------------------------
// GuardianPortalService — Milestone 1 step 7: the guardian portal read/request
// surface (05-api-surface.md "Guardian portal"; compliance-coppa.md Part 2
// Stage 4 review / refuse-further-use / delete rights).
//
// Every method is gated through `authorize` under a guardian capability, matched
// by the `guardian` scope against ctx.guardianOf (03-authorization.md): the
// resource names the child, and the scope matches only the guardian's own
// verified children. A lapsed/revoked edge is absent from guardianOf, so it
// denies. The age-18 bar applies to guardian WRITE authority only (request_export
// / request_deletion): guardian READ (view_child_record / view_fee_status)
// persists past the child's majority until the edge lapses at coming-of-age
// (04-state-machines: read ends at `verified -> lapsed`, not at 18). Consent
// grant/revoke are NOT here (step 5, ConsentService).
//
//   - viewChildRecord: guardian.view_child_record (logsRead). The read and its
//     minor_record.read obligation run in ONE transaction via the `authorize`
//     read seam, so a failed read-log rolls the read back (fails closed).
//   - viewFees: guardian.view_fee_status. payment_ref status + scholarship
//     percentage; money is never a source of truth (02-data-model.md) — no
//     amount is read or returned.
//   - requestExport / requestDeletion: file an export_request / deletion_request
//     for staff fulfillment (the fulfillment tooling and the ops review that
//     writes a decision are step 8, not here). A refused deletion requires a
//     documented reason — a DB CHECK (migration 0008), never written here.
//   - viewDigest: guardian.view_digest — a minimal, non-child-specific chapter
//     digest, authorized against one of the guardian's verified minor children.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP
// routes are wired later (step 8).
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, ConsentType, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { GuardianChildNotFoundError } from './errors.js'
import type { Db } from './events.js'

/** The scope of a filed deletion request (02-data-model.md deletion_request). */
export type DeletionScope = 'full' | 'redaction'

/**
 * The injected `authorize` dependency, narrowed to this service's read/request
 * capabilities (structurally the runtime `authorize` wrapper; taken by injection
 * so the deny/backstop/obligation paths are testable without HTTP).
 */
export type GuardianPortalAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability:
    | 'guardian.view_child_record'
    | 'guardian.view_fee_status'
    | 'guardian.request_export'
    | 'guardian.request_deletion'
    | 'guardian.view_digest',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface GuardianPortalServiceDeps {
  sql: Sql
  authorize: GuardianPortalAuthorizeFn
}

/** One active membership row as seen by the child-record read. */
export interface ChildMembershipView {
  role: string
  status: string
  chapterId: string
  podId: string | null
  currentTier: string | null
}

/** The composed child record (05-api-surface GET /guardian/children/:id/record). */
export interface ChildRecord {
  childId: string
  memberships: ChildMembershipView[]
  currentTier: string | null
  /** Placeholders until the M2/M3 timeline and mentor-hours land. */
  mentorHours: number | null
  timeline: unknown[]
  /** Each consent type, active or not, from consent_current. */
  consents: Record<ConsentType, boolean>
}

export interface ScholarshipView {
  percentage: number
  note: string | null
}

/** The fee view (05-api-surface GET /guardian/children/:id/fees). No amounts. */
export interface FeeStatus {
  paymentStatus: 'none' | 'active' | 'past_due' | 'waived'
  tierPaidFor: string | null
  scholarships: ScholarshipView[]
}

export interface ExportRequestResult {
  exportRequestId: string
  subjectAccountId: string
  status: 'requested'
}

export interface DeletionRequestResult {
  deletionRequestId: string
  subjectAccountId: string
  scopeRequested: DeletionScope
  status: 'requested'
}

export interface ChapterDigest {
  chapterId: string
  generatedAt: string
  /** Placeholder items; the digest is non-child-specific and never the feed. */
  items: unknown[]
}

/** The full consent-type set, so the summary reports each as active or not. */
const ALL_CONSENT_TYPES: readonly ConsentType[] = [
  'enrollment',
  'data_collection',
  'platform_participation',
  'public_profile',
  'photo_media',
  'external_publication',
]

/** Whole years from `dob` to `at` (birthday-aware, UTC). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

interface ChildSubject {
  age: number
  /** The child's active-student pod; the "minor outside the actor's pod" bit. */
  podId: string | null
  /** The child's enrolling chapter (most recent active membership). */
  chapterId: string | null
  /** The most recent enrollment record — the fee tables' anchor. */
  enrollmentRecordId: string | null
}

export class GuardianPortalService {
  private readonly sql: Sql
  private readonly authorize: GuardianPortalAuthorizeFn

  constructor(deps: GuardianPortalServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Load the subject facts `can` needs (age for the guardian bound, pod for the
   * read-log, chapter, and the fee anchor). Loaded BEFORE `authorize` because
   * the decision depends on the subject age — the same ordering as
   * ConsentService.loadAnchor.
   */
  private async loadSubject(childId: string): Promise<ChildSubject> {
    const [row] = await this.sql`
      select
        a.date_of_birth as dob,
        (
          select m.pod_id from membership m
          where m.account_id = a.id and m.status = 'active' and m.role = 'student'
          order by m.created_at desc limit 1
        ) as pod_id,
        (
          select m.chapter_id from membership m
          where m.account_id = a.id and m.status = 'active'
          order by m.created_at desc limit 1
        ) as chapter_id,
        (
          select e.id from enrollment_record e
          where e.student_account_id = a.id
          order by e.created_at desc limit 1
        ) as enrollment_record_id
      from account a
      where a.id = ${childId}
    `
    if (row === undefined) throw new GuardianChildNotFoundError(childId)
    return {
      age: ageInYears(new Date(row.dob as string), new Date()),
      podId: (row.pod_id as string | null) ?? null,
      chapterId: (row.chapter_id as string | null) ?? null,
      enrollmentRecordId: (row.enrollment_record_id as string | null) ?? null,
    }
  }

  /**
   * The guardian-scope resource for a child. Carries the child as the subject
   * with its age (so the scope bars guardian WRITES at 18 — request_export /
   * request_deletion; reads are not age-bounded) and, for the read-log, its pod
   * and whether it is a minor.
   */
  private childResource(childId: string, s: ChildSubject): Resource {
    return {
      subjectAccountId: childId,
      subjectAge: s.age,
      subjectIsMinor: s.age < 18,
      subjectPodId: s.podId,
      chapter_id: s.chapterId,
    }
  }

  /**
   * GET /guardian/children/:id/record — guardian.view_child_record. Returns the
   * composed record (active memberships, current tier, mentor-hours/timeline
   * placeholders, and a consent summary). The capability has logsRead, so the
   * `authorize` obligation writes a minor_record.read audit row in the SAME
   * transaction as the read: if that write fails, the read rolls back and
   * nothing is returned (fails closed).
   */
  async viewChildRecord(childId: string, ctx: AuthContext): Promise<ChildRecord | undefined> {
    const s = await this.loadSubject(childId)
    const resource = this.childResource(childId, s)
    return this.authorize<ChildRecord>(ctx, 'guardian.view_child_record', resource, {
      sql: this.sql,
      read: (tx) => this.composeChildRecord(tx, childId),
    })
  }

  private async composeChildRecord(tx: Db, childId: string): Promise<ChildRecord> {
    const memberships = await tx`
      select role, status, current_tier, chapter_id, pod_id
      from membership
      where account_id = ${childId} and status = 'active'
      order by created_at asc
    `
    const consentRows = await tx`
      select type, active from consent_current where student_account_id = ${childId}
    `

    const consents = Object.fromEntries(
      ALL_CONSENT_TYPES.map((t) => [t, false]),
    ) as Record<ConsentType, boolean>
    for (const r of consentRows) {
      consents[r.type as ConsentType] = r.active as boolean
    }

    const studentMem = memberships.find((m) => m.role === 'student')
    return {
      childId,
      memberships: memberships.map((m) => ({
        role: m.role as string,
        status: m.status as string,
        chapterId: m.chapter_id as string,
        podId: (m.pod_id as string | null) ?? null,
        currentTier: (m.current_tier as string | null) ?? null,
      })),
      currentTier: (studentMem?.current_tier as string | null) ?? null,
      mentorHours: null, // placeholder — mentor hours land with M2/M3
      timeline: [], // placeholder — the timeline spine lands with M2/M3
      consents,
    }
  }

  /**
   * GET /guardian/children/:id/fees — guardian.view_fee_status. Reads the
   * payment_ref status and any scholarship. No amounts are a source of truth,
   * so none are read or returned (02-data-model.md "No amounts...").
   */
  async viewFees(childId: string, ctx: AuthContext): Promise<FeeStatus> {
    const s = await this.loadSubject(childId)
    const resource = this.childResource(childId, s)
    const fees = await this.authorize<FeeStatus>(ctx, 'guardian.view_fee_status', resource, {
      sql: this.sql,
      read: (tx) => this.composeFees(tx, s.enrollmentRecordId),
    })
    return fees as FeeStatus
  }

  private async composeFees(tx: Db, enrollmentRecordId: string | null): Promise<FeeStatus> {
    if (enrollmentRecordId === null) {
      return { paymentStatus: 'none', tierPaidFor: null, scholarships: [] }
    }
    const [pay] = await tx`
      select status, tier_paid_for from payment_ref
      where enrollment_record_id = ${enrollmentRecordId}
      order by created_at desc limit 1
    `
    const sch = await tx`
      select percentage, note from scholarship
      where enrollment_record_id = ${enrollmentRecordId}
      order by created_at desc
    `
    return {
      paymentStatus: (pay?.status as FeeStatus['paymentStatus'] | undefined) ?? 'none',
      tierPaidFor: (pay?.tier_paid_for as string | null | undefined) ?? null,
      scholarships: sch.map((r) => ({
        percentage: r.percentage as number,
        note: (r.note as string | null) ?? null,
      })),
    }
  }

  /**
   * POST /guardian/children/:id/export — guardian.request_export. Files an
   * export_request in `requested` (the review right; the export bundle itself is
   * later staff tooling). Authorized first, then the insert rides a transaction
   * that asserts the recorded decision (the repository-write backstop).
   */
  async requestExport(childId: string, ctx: AuthContext): Promise<ExportRequestResult> {
    const s = await this.loadSubject(childId)
    const resource = this.childResource(childId, s)
    await this.authorize(ctx, 'guardian.request_export', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into export_request (subject_account_id, requested_by, status)
        values (${childId}, ${ctx.account.id}, 'requested')
        returning id
      `
      return {
        exportRequestId: row!.id as string,
        subjectAccountId: childId,
        status: 'requested' as const,
      }
    }) as Promise<ExportRequestResult>
  }

  /**
   * POST /guardian/children/:id/deletion — guardian.request_deletion. Files a
   * deletion_request in `requested` with the given scope. The decision fields
   * (and the "a refusal carries a reason" rule) belong to the ops review, step 8.
   */
  async requestDeletion(
    childId: string,
    ctx: AuthContext,
    scope: DeletionScope,
  ): Promise<DeletionRequestResult> {
    const s = await this.loadSubject(childId)
    const resource = this.childResource(childId, s)
    await this.authorize(ctx, 'guardian.request_deletion', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into deletion_request (subject_account_id, requested_by, scope_requested, status)
        values (${childId}, ${ctx.account.id}, ${scope}, 'requested')
        returning id
      `
      return {
        deletionRequestId: row!.id as string,
        subjectAccountId: childId,
        scopeRequested: scope,
        status: 'requested' as const,
      }
    }) as Promise<DeletionRequestResult>
  }

  /**
   * GET /guardian/digest — guardian.view_digest. A minimal, non-child-specific
   * chapter digest (never the feed). Authorized under the guardian scope against
   * one of the guardian's verified minor children; a guardian with no verified
   * minor child is denied out_of_scope.
   */
  async viewDigest(ctx: AuthContext): Promise<ChapterDigest> {
    const anchor = await this.pickMinorChild(ctx.guardianOf)
    // No verified minor child -> a subjectless resource denies out_of_scope.
    const resource: Resource = anchor
      ? {
          subjectAccountId: anchor.childId,
          subjectAge: anchor.age,
          subjectIsMinor: anchor.age < 18,
          chapter_id: anchor.chapterId,
        }
      : { subjectAccountId: null }

    await this.authorize(ctx, 'guardian.view_digest', resource, { sql: this.sql })

    // Reachable only on allow, which required a resolved minor-child anchor.
    return {
      chapterId: anchor!.chapterId,
      generatedAt: new Date().toISOString(),
      items: [],
    }
  }

  /** The first verified child under 18 (with its chapter), or null. */
  private async pickMinorChild(
    guardianOf: string[],
  ): Promise<{ childId: string; age: number; chapterId: string } | null> {
    if (guardianOf.length === 0) return null
    const rows = await this.sql`
      select
        a.id as id,
        a.date_of_birth as dob,
        (
          select m.chapter_id from membership m
          where m.account_id = a.id and m.status = 'active'
          order by m.created_at desc limit 1
        ) as chapter_id
      from account a
      where a.id in ${this.sql(guardianOf)}
    `
    const now = new Date()
    for (const r of rows) {
      const age = ageInYears(new Date(r.dob as string), now)
      if (age < 18 && r.chapter_id != null) {
        return { childId: r.id as string, age, chapterId: r.chapter_id as string }
      }
    }
    return null
  }
}
