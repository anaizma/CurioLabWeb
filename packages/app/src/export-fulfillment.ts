// -------------------------------------------------------------------------
// ExportFulfillmentService — the review-right deliverable (§ 312.6(a): a parent
// may review the personal information collected from their child;
// compliance-coppa.md Part 2 Stage 4 "Review is the export request"). A Chapter
// Director fulfills a filed export_request by assembling a structured export of
// the child's record and marking the request `fulfilled`.
//
// export.fulfill is chapter-scoped to the subject's enrolling chapter and gated
// through `authorize` (Chapter Director; platform_admin via platformGrant). In
// one transaction (asserting the recorded decision via the repository-write
// backstop) it reads the child's membership, tier history, consents, and the
// timeline placeholder, marks the request `fulfilled`, writes a reference-only
// audit_entry, and returns the bundle. No file delivery — the caller (step 8)
// renders/ships the returned structure.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP route
// is wired later.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, ConsentType, Resource } from '@curiolab/core'
import { assertAuthorized, writeAudit, type AuthorizeDeps } from '@curiolab/runtime'
import type { Db } from './events.js'
import { ExportRequestNotFoundError, DeletionSubjectChapterNotFoundError } from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's one capability
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type ExportFulfillmentAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'export.fulfill',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ExportFulfillmentServiceDeps {
  sql: Sql
  authorize: ExportFulfillmentAuthorizeFn
}

export interface ExportMembershipView {
  role: string
  status: string
  chapterId: string
  currentTier: string | null
}

export interface ExportTierTransitionView {
  fromTier: string | null
  toTier: string
  at: string
}

/** The structured review-right export of the child's record. */
export interface ExportBundle {
  subjectAccountId: string
  generatedAt: string
  memberships: ExportMembershipView[]
  tierHistory: ExportTierTransitionView[]
  /** Each consent type, active or not, from consent_current. */
  consents: Record<ConsentType, boolean>
  /** Placeholder until the M2/M3 timeline spine lands. */
  timeline: unknown[]
}

export interface FulfillExportResult {
  exportRequestId: string
  subjectAccountId: string
  status: 'fulfilled'
  bundle: ExportBundle
}

const ALL_CONSENT_TYPES: readonly ConsentType[] = [
  'enrollment',
  'data_collection',
  'platform_participation',
  'public_profile',
  'photo_media',
  'external_publication',
]

export class ExportFulfillmentService {
  private readonly sql: Sql
  private readonly authorize: ExportFulfillmentAuthorizeFn

  constructor(deps: ExportFulfillmentServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * export.fulfill — assemble the child's structured export and mark the
   * export_request fulfilled. Authorized against the subject's enrolling chapter,
   * then the assemble + mark ride one transaction.
   */
  async fulfillExport(requestId: string, ctx: AuthContext): Promise<FulfillExportResult> {
    const [row] = await this.sql`
      select subject_account_id, status from export_request where id = ${requestId}
    `
    if (row === undefined) throw new ExportRequestNotFoundError(requestId)
    const subjectAccountId = row.subject_account_id as string

    const [enr] = await this.sql`
      select chapter_id from enrollment_record
      where student_account_id = ${subjectAccountId}
      order by created_at desc limit 1
    `
    if (enr === undefined) throw new DeletionSubjectChapterNotFoundError(subjectAccountId)
    const chapterId = enr.chapter_id as string

    const resource: Resource = { id: requestId, chapter_id: chapterId }
    await this.authorize(ctx, 'export.fulfill', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision

      const bundle = await this.assembleBundle(tx, subjectAccountId)

      const upd = await tx`
        update export_request set status = 'fulfilled', fulfilled_at = now()
        where id = ${requestId} and status = 'requested'
        returning id
      `
      // Idempotent-ish: if it was already fulfilled the row is untouched; we still
      // return the freshly-assembled bundle. A missing row cannot happen (we read
      // it above in the same connection).

      await writeAudit(tx, {
        action: 'export.fulfilled',
        subjectType: 'account',
        subjectId: subjectAccountId,
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail: { exportRequestId: requestId, alreadyFulfilled: upd.length === 0 },
      })

      return {
        exportRequestId: requestId,
        subjectAccountId,
        status: 'fulfilled' as const,
        bundle,
      }
    }) as Promise<FulfillExportResult>
  }

  private async assembleBundle(tx: Db, subjectAccountId: string): Promise<ExportBundle> {
    const memberships = await tx`
      select role, status, chapter_id, current_tier
      from membership where account_id = ${subjectAccountId}
      order by created_at asc
    `
    const tiers = await tx`
      select tt.from_tier, tt.to_tier, tt.at
      from tier_transition tt
      join membership m on m.id = tt.membership_id
      where m.account_id = ${subjectAccountId}
      order by tt.at asc
    `
    const consentRows = await tx`
      select type, active from consent_current where student_account_id = ${subjectAccountId}
    `
    const consents = Object.fromEntries(
      ALL_CONSENT_TYPES.map((t) => [t, false]),
    ) as Record<ConsentType, boolean>
    for (const r of consentRows) consents[r.type as ConsentType] = r.active as boolean

    return {
      subjectAccountId,
      generatedAt: new Date().toISOString(),
      memberships: memberships.map((m) => ({
        role: m.role as string,
        status: m.status as string,
        chapterId: m.chapter_id as string,
        currentTier: (m.current_tier as string | null) ?? null,
      })),
      tierHistory: tiers.map((t) => ({
        fromTier: (t.from_tier as string | null) ?? null,
        toTier: t.to_tier as string,
        at: new Date(t.at as string).toISOString(),
      })),
      consents,
      timeline: [], // placeholder — the timeline spine lands with M2/M3
    }
  }
}
