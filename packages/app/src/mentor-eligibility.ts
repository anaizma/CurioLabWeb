// -------------------------------------------------------------------------
// MentorEligibilityService + loadMentorEligibility — admin/director backend §6:
// mentor eligibility as STATE (REVIEW-GATED).
//
// A mentor's youth-facing access is contingent on FOUR eligibility components
// each being CURRENTLY satisfied (background_check, mandatory_reporter_training,
// cwru_affiliation_verified, signed_code_of_conduct). Each clearance is an
// append-only `mentor_eligibility` row per (membership, component); a renewal is
// a NEW row, a lapse is expiry. The current status is the
// `mentor_eligibility_current` projection view (migration 0025).
//
// This service owns:
//   * record — the ops/director authority to RECORD a component clearance
//     (`mentor.manage_eligibility`, chapter_director; platform_admin via override).
//     Auditable + written to the access ledger.
//   * read — the director's mentor-eligibility panel read (reuses the P1
//     `membership.read` roster read, chapter-scoped).
// Plus the pure-ish loader `loadMentorEligibility`, which computes eligibility
// deterministically from the latest per-component rows + an injected `now`
// (via core's `evaluateMentorEligibility`), used by the context builder to
// hydrate `Membership.mentorEligible` and by the eligibility sweep.
//
// The ENFORCEMENT (the `can` gate + the auto-revoke sweep) is behind the config
// flag MENTOR_ELIGIBILITY_ENFORCED (default OFF) until legal review. Recording +
// reading always run; the flag gates only enforcement, so production is untouched.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import {
  MENTOR_ELIGIBILITY_COMPONENTS,
  evaluateMentorEligibility,
  type MentorEligibilityComponent,
  type MentorEligibilityComponentSnapshot,
  type MentorEligibilityResult,
} from '@curiolab/core'
import {
  assertAuthorized,
  writeAudit,
  writeAccessLedger,
  type AuthorizeDeps,
} from '@curiolab/runtime'
import { MembershipNotFoundError } from './errors.js'

export { MENTOR_ELIGIBILITY_COMPONENTS } from '@curiolab/core'
export type { MentorEligibilityComponent } from '@curiolab/core'

type Db = Sql | TransactionSql

/** The audit action + (with reused ledger event) the eligibility-record marker. */
export const MENTOR_ELIGIBILITY_AUDIT_ACTION = 'mentor.eligibility_recorded'

/**
 * The injected `authorize` dependency, narrowed to this service's capabilities:
 * the record write (`mentor.manage_eligibility`) and the read (`membership.read`,
 * reused from the P1 roster read).
 */
export type MentorEligibilityAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'mentor.manage_eligibility' | 'membership.read',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface MentorEligibilityServiceDeps {
  sql: Sql
  authorize: MentorEligibilityAuthorizeFn
}

export interface RecordClearanceOptions {
  /** When the component was cleared/completed/verified/signed. Defaults to `now`. */
  clearedAt?: Date
  /** The renewal-clock expiry (null/omitted = standing). */
  expiresAt?: Date | null
  /** The code-of-conduct version signed (optional). */
  version?: string | null
  /** An opaque storage reference for the clearance artifact (optional). */
  evidenceRef?: string | null
  /** Deterministic clock; defaults to the wall clock. */
  now?: Date
}

export interface RecordClearanceResult {
  eligibilityId: string
  membershipId: string
  component: MentorEligibilityComponent
  clearedAt: Date
  expiresAt: Date | null
}

export interface ComponentStatusView {
  component: MentorEligibilityComponent
  active: boolean
  clearedAt: string | null
  expiresAt: string | null
  version: string | null
  evidenceRef: string | null
}

export interface MentorEligibilityView {
  membershipId: string
  eligible: boolean
  unmet: MentorEligibilityComponent[]
  components: ComponentStatusView[]
}

interface ComponentRow extends MentorEligibilityComponentSnapshot {
  version: string | null
  evidenceRef: string | null
}

/**
 * The latest row per component for a membership, as epoch-ms snapshots. Reads the
 * append-only ledger directly (DISTINCT ON by seq) so expiry is evaluated against
 * an injected `now`, not the view's `now()` — keeping the loader deterministic
 * under test.
 */
async function loadComponentSnapshots(
  db: Db,
  membershipId: string,
): Promise<Partial<Record<MentorEligibilityComponent, ComponentRow>>> {
  const rows = await db`
    select distinct on (component)
      component, cleared_at, expires_at, version, evidence_ref
    from mentor_eligibility
    where membership_id = ${membershipId}
    order by component, seq desc
  `
  const out: Partial<Record<MentorEligibilityComponent, ComponentRow>> = {}
  for (const r of rows) {
    const component = r.component as MentorEligibilityComponent
    const clearedAt = r.cleared_at as Date | string | null
    const expiresAt = r.expires_at as Date | string | null
    out[component] = {
      clearedAt: clearedAt == null ? null : new Date(clearedAt).getTime(),
      expiresAt: expiresAt == null ? null : new Date(expiresAt).getTime(),
      version: (r.version as string | null) ?? null,
      evidenceRef: (r.evidence_ref as string | null) ?? null,
    }
  }
  return out
}

/**
 * Compute a mentor membership's eligibility as of `now` from the latest
 * per-component clearances. Pure decision over the DB read + core's
 * `evaluateMentorEligibility`. No authorization — an internal loader for the
 * context builder (hydrating `Membership.mentorEligible`) and the sweep.
 */
export async function loadMentorEligibility(
  db: Db,
  membershipId: string,
  now: Date = new Date(),
): Promise<MentorEligibilityResult> {
  const snaps = await loadComponentSnapshots(db, membershipId)
  return evaluateMentorEligibility(snaps, now.getTime())
}

export class MentorEligibilityService {
  private readonly sql: Sql
  private readonly authorize: MentorEligibilityAuthorizeFn

  constructor(deps: MentorEligibilityServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /** Load the membership's chapter + account (the authorization scope + ledger subject). */
  private async loadMembership(membershipId: string): Promise<{ chapterId: string; accountId: string }> {
    const [row] = await this.sql`
      select chapter_id, account_id from membership where id = ${membershipId}
    `
    if (row === undefined) throw new MembershipNotFoundError(membershipId)
    return { chapterId: row.chapter_id as string, accountId: row.account_id as string }
  }

  /**
   * Record (or renew) one eligibility component clearance for a mentor membership.
   * Gated through `authorize` under `mentor.manage_eligibility` (chapter-scoped to
   * the membership's chapter). Appends one `mentor_eligibility` row + one audit
   * row + one access_ledger row. Auditable; never blocks anything (a WRITE only).
   */
  async record(
    membershipId: string,
    component: MentorEligibilityComponent,
    ctx: AuthContext,
    options: RecordClearanceOptions = {},
  ): Promise<RecordClearanceResult> {
    const now = options.now ?? new Date()
    const { chapterId, accountId } = await this.loadMembership(membershipId)
    const clearedAt = options.clearedAt ?? now
    const expiresAt = options.expiresAt ?? null

    const resource: Resource = { id: membershipId, chapter_id: chapterId }
    await this.authorize(ctx, 'mentor.manage_eligibility', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [row] = await tx`
        insert into mentor_eligibility (
          membership_id, component, cleared_at, expires_at, version, evidence_ref, recorded_by
        ) values (
          ${membershipId}, ${component}, ${clearedAt}, ${expiresAt},
          ${options.version ?? null}, ${options.evidenceRef ?? null}, ${ctx.account.id}
        ) returning id
      `
      const eligibilityId = row!.id as string
      const detail = {
        membershipId,
        component,
        expiresAt: expiresAt?.toISOString() ?? null,
        evidenceRef: options.evidenceRef ?? null,
        version: options.version ?? null,
      }
      await writeAudit(tx, {
        action: MENTOR_ELIGIBILITY_AUDIT_ACTION,
        subjectType: 'membership',
        subjectId: membershipId,
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail,
      })
      await writeAccessLedger(tx, {
        event: 'mentor.eligibility_recorded',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: accountId,
        chapterId,
        detail,
      })
      return { eligibilityId, membershipId, component, clearedAt, expiresAt }
    }) as Promise<RecordClearanceResult>
  }

  /**
   * Read a mentor membership's eligibility (the director's mentor-eligibility
   * panel). Reuses the P1 `membership.read` roster read (chapter-scoped). Returns
   * the four components' current status + expiries and the derived `eligible`
   * predicate, evaluated against `now`.
   */
  async read(
    membershipId: string,
    ctx: AuthContext,
    now: Date = new Date(),
  ): Promise<MentorEligibilityView> {
    const { chapterId } = await this.loadMembership(membershipId)
    const resource: Resource = { id: membershipId, chapter_id: chapterId }
    await this.authorize(ctx, 'membership.read', resource, { sql: this.sql })

    const snaps = await loadComponentSnapshots(this.sql, membershipId)
    const nowMs = now.getTime()
    const result = evaluateMentorEligibility(snaps, nowMs)
    const components: ComponentStatusView[] = MENTOR_ELIGIBILITY_COMPONENTS.map((component) => {
      const s = snaps[component]
      const active = s != null && s.clearedAt != null && (s.expiresAt == null || s.expiresAt > nowMs)
      return {
        component,
        active,
        clearedAt: s?.clearedAt == null ? null : new Date(s.clearedAt).toISOString(),
        expiresAt: s?.expiresAt == null ? null : new Date(s.expiresAt).toISOString(),
        version: s?.version ?? null,
        evidenceRef: s?.evidenceRef ?? null,
      }
    })
    return { membershipId, eligible: result.eligible, unmet: result.unmet, components }
  }
}
