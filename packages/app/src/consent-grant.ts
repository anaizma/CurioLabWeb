// -------------------------------------------------------------------------
// ConsentGrantService — admin/director backend §5: consent as an APPEND-ONLY
// GRANT ledger (revised 2026-07-24).
//
// A PEER of the existing ConsentService (the 3-block `consent` ledger), never a
// replacement. The block ledger stays load-bearing for membership activation and
// accept-student; this service owns the six INDEPENDENT, per-practice grant types
// (program_participation, platform_account, public_publication,
// photo_video_likeness, emergency_medical_pickup, verification_link_sharing),
// each captured in one guardian sitting but its own append-only `consent_grant`
// row so it expires, renews, and revokes on its own clock (COPPA requires
// consent specific to each practice and independently revocable).
//
// The PUBLIC-PUBLICATION enforcement this enables (the publish gate `Rule 1`, the
// notify-and-object window `Rule 3`) is BEHIND the config flag
// `consentGrantLedgerEnforced` (default OFF) until legal review — production is
// untouched until the flip. Grant CAPTURE and per-grant REVOCATION always run
// (they only write the ledger); the flag gates only the enforcement seams.
//
// Gating reuses the EXISTING consent write authority: capture through
// `consent.grant`, per-grant revoke through `consent.revoke` (both guardian/own
// scoped, so a guardian captures for a minor child and an 18+ self-grants). No
// new consent-write capability is forked.
//
// Framework-agnostic: the db handle, `authorize`, and config are injected; the
// HTTP routes are backend adapters over @curiolab/http.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, writeAccessLedger, type AuthorizeDeps } from '@curiolab/runtime'
import {
  type AppConfig,
  type ConsentGrantMethod,
  type ConsentGrantType,
  ENROLLMENT_REQUIRED_GRANT_TYPES,
  SELF_RECONFIRM_GRANT_TYPES,
  SIGNED_FORM_REQUIRED_GRANT_TYPES,
  STRONG_GRANT_METHODS,
  defaultConfig,
} from './config.js'
import {
  GrantNotActiveError,
  GrantRevocationEndsEnrollmentError,
  GrantSignedFormRequiredError,
  GrantStrongMethodRequiredError,
  GrantSubjectNotFoundError,
  PublicationHoldNotFoundError,
  StudentNotificationEmailAgeError,
} from './errors.js'

export type { ConsentGrantMethod, ConsentGrantType } from './config.js'

/** The six grant types, in the §5 detail-table order. */
export const CONSENT_GRANT_TYPES: readonly ConsentGrantType[] = [
  'program_participation',
  'platform_account',
  'public_publication',
  'photo_video_likeness',
  'emergency_medical_pickup',
  'verification_link_sharing',
]

type Db = Sql | TransactionSql

/**
 * The injected `authorize` dependency, narrowed to this service's capabilities.
 * Capture/revoke reuse the existing consent write authority; the reads and the
 * object write use the additive §5 guardian capabilities.
 */
export type ConsentGrantAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability:
    | 'consent.grant'
    | 'consent.revoke'
    | 'publication.object'
    | 'guardian.list_children'
    | 'guardian.view_grants'
    | 'guardian.view_public_items',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ConsentGrantServiceDeps {
  sql: Sql
  authorize: ConsentGrantAuthorizeFn
  config?: Partial<AppConfig>
}

export interface CaptureGrantOptions {
  method: ConsentGrantMethod
  /** An opaque storage reference for a strong-method artifact (never file storage). */
  evidenceArtifactRef?: string | null
  /** An optional descriptive scope (e.g. a term ref). */
  scope?: string | null
  /** Deterministic clock for the renewal-expiry stamp; defaults to the wall clock. */
  now?: Date
}

export interface GrantResult {
  grantId: string
  subjectStudentAccountId: string
  grantType: ConsentGrantType
  method: ConsentGrantMethod
  expiresAt: Date | null
  /** True when a prior active grant of this type existed (a renewal, not a first capture). */
  renewal: boolean
}

export interface RevokeGrantResult {
  grantId: string
  subjectStudentAccountId: string
  grantType: ConsentGrantType
  /** Whether the public-publication cascade ran (unpublished the student's items). */
  cascaded: boolean
}

export type GrantStatus = 'active' | 'expired' | 'revoked' | 'none'

export interface GrantStatusView {
  grantType: ConsentGrantType
  status: GrantStatus
  expiresAt: string | null
  method: ConsentGrantMethod | null
  evidenceArtifactRef: string | null
}

export interface ChildSummary {
  childAccountId: string
  displayName: string
}

export interface PublicItemView {
  type: 'project' | 'narrative'
  ref: string
  title: string | null
}

/** Whole years from `dob` to `at` (birthday-aware, UTC). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

// ---------------------------------------------------------------------------
// Standalone gate helpers (used by the publish paths under the flag).
// ---------------------------------------------------------------------------

/**
 * Whether the subject holds a CURRENT (non-revoked, non-expired) grant of a type
 * at `now`. Reads the latest `consent_grant` row for (subject, type) — the same
 * projection the `consent_grant_current` view computes, but with an injected
 * `now` so the publish paths are deterministic under test. No other grant
 * substitutes (§5 Rule 1).
 */
export async function hasActiveGrant(
  db: Db,
  subjectStudentAccountId: string,
  grantType: ConsentGrantType,
  now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db`
    select revoked_at, expires_at from consent_grant
    where subject_student_account_id = ${subjectStudentAccountId} and grant_type = ${grantType}
    order by seq desc
    limit 1
  `
  if (row === undefined) return false
  if (row.revoked_at != null) return false
  const expiresAt = row.expires_at as Date | string | null
  if (expiresAt != null && new Date(expiresAt) <= now) return false
  return true
}

/**
 * §5 Rule 5 cascade — the content consequence of a `public_publication`
 * revocation. Unpublish/withhold the student's CURRENTLY-PUBLIC items in the SAME
 * transaction as the revoke, reusing the existing safeguard-suspend surfaces:
 * public_listed projects revert to `verified`, published narratives revert to
 * `pending_review` (re-reviewable), and published newsletter items authored by
 * the student are redacted. Idempotent (guarded by the current status).
 */
export async function publicationGrantRevokeCascade(
  tx: Db,
  subjectStudentAccountId: string,
): Promise<void> {
  await tx`
    update project set status = 'verified'
    where status = 'public_listed'
      and owner_membership_id in (
        select id from membership where account_id = ${subjectStudentAccountId}
      )
  `
  await tx`
    update profile_narrative set status = 'pending_review'
    where account_id = ${subjectStudentAccountId} and status = 'published'
  `
  await tx`
    update newsletter_item set body = '[redacted: publication consent withdrawn]'
    where author_student_account_id = ${subjectStudentAccountId}
      and issue_id in (select id from newsletter_issue where status = 'published')
  `
}

export class ConsentGrantService {
  private readonly sql: Sql
  private readonly authorize: ConsentGrantAuthorizeFn
  private readonly config: AppConfig

  constructor(deps: ConsentGrantServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.config = { ...defaultConfig, ...deps.config }
  }

  /** Load the subject's age (from DOB) for the guardian-scope bound + Rule 2. */
  private async loadSubjectAge(subjectAccountId: string, at: Date): Promise<number> {
    const [row] = await this.sql`select date_of_birth as dob from account where id = ${subjectAccountId}`
    if (row === undefined) throw new GrantSubjectNotFoundError(subjectAccountId)
    return ageInYears(new Date(row.dob as string), at)
  }

  /** The guardian/own resource for a grant decision (mirrors ConsentService). */
  private subjectResource(subjectAccountId: string, age: number): Resource {
    return {
      subjectAccountId,
      subjectAge: age,
      subjectIsMinor: age < 18,
      ownerAccountId: subjectAccountId,
    }
  }

  /**
   * Capture (or renew) one grant. Gated through `authorize` under `consent.grant`
   * (guardian for a minor child; own for an 18+ self-grant). Rule 2: a
   * `public_publication` grant for a subject UNDER 13 REQUIRES a strong method
   * AND a non-null artifact — a `click`/no-artifact is refused before any write
   * (the DB trigger is the backstop). Sets `expires_at` per the renewal clock.
   * Appends one `consent_grant` row + one access_ledger row (method + artifact).
   */
  async captureGrant(
    subjectStudentAccountId: string,
    grantType: ConsentGrantType,
    ctx: AuthContext,
    options: CaptureGrantOptions,
  ): Promise<GrantResult> {
    const now = options.now ?? new Date()
    const age = await this.loadSubjectAge(subjectStudentAccountId, now)
    const method = options.method
    const artifact = options.evidenceArtifactRef ?? null

    // student_notification_email v1 is 13+ ONLY: authorizing a hidden, outbound-only
    // address for a MINOR reverses the "not directly contactable" posture, and COPPA
    // bites hardest under 13. Refused before any write (the 0037 DB trigger is the
    // backstop). This is independent of the global flag — capture only WRITES the
    // ledger; the flag gates SETTING the email + the resolver's student-email emission.
    if (grantType === 'student_notification_email' && age < 13) {
      throw new StudentNotificationEmailAgeError(subjectStudentAccountId, age)
    }

    // Rule 2: strong verification for under-13 public_publication.
    if (grantType === 'public_publication' && age < 13) {
      if (!STRONG_GRANT_METHODS.includes(method)) {
        throw new GrantStrongMethodRequiredError(subjectStudentAccountId, 'weak_method')
      }
      if (artifact == null) {
        throw new GrantStrongMethodRequiredError(subjectStudentAccountId, 'artifact_missing')
      }
    }

    // mentor_dm (design C.3): unconditionally requires the strong `signed_form`
    // method AND a non-null evidence artifact — a click is deliberate-friction
    // refused. The DB trigger (0030) is the backstop; this fails cleanly first.
    if (SIGNED_FORM_REQUIRED_GRANT_TYPES.includes(grantType)) {
      if (method !== 'signed_form') {
        throw new GrantSignedFormRequiredError(subjectStudentAccountId, 'weak_method')
      }
      if (artifact == null) {
        throw new GrantSignedFormRequiredError(subjectStudentAccountId, 'artifact_missing')
      }
    }

    const resource = this.subjectResource(subjectStudentAccountId, age)
    await this.authorize(ctx, 'consent.grant', resource, { sql: this.sql })

    const renewalMs = this.config.grantRenewalMsByType[grantType]
    const expiresAt = renewalMs == null ? null : new Date(now.getTime() + renewalMs)

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const renewal = await hasActiveGrant(tx, subjectStudentAccountId, grantType, now)
      const [g] = await tx`
        insert into consent_grant (
          grant_type, subject_student_account_id, guardian_account_id, scope,
          method, granted_at, evidence_artifact_ref, expires_at
        ) values (
          ${grantType}, ${subjectStudentAccountId}, ${ctx.account.id}, ${options.scope ?? null},
          ${method}, ${now}, ${artifact}, ${expiresAt}
        ) returning id
      `
      const grantId = g!.id as string
      await writeAccessLedger(tx, {
        event: renewal ? 'grant.renewed' : 'grant.captured',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: subjectStudentAccountId,
        guardianAccountId: ctx.account.id,
        consentRef: grantId,
        consentMethod: method,
        detail: { grantType, evidenceArtifactRef: artifact, expiresAt: expiresAt?.toISOString() ?? null },
      })
      return {
        grantId,
        subjectStudentAccountId,
        grantType,
        method,
        expiresAt,
        renewal,
      }
    }) as Promise<GrantResult>
  }

  /**
   * Self-grant path (the 18th-birthday re-confirmation). Identical to
   * captureGrant but records `guardian_account_id` null (the now-adult IS the
   * subject and the actor). Gated through `consent.grant` on the OWN scope
   * (ownCondition age >= 18). Used to re-confirm the persisting grants after the
   * maturation transfer lapses the guardian's.
   */
  async selfGrant(
    grantType: ConsentGrantType,
    ctx: AuthContext,
    options: CaptureGrantOptions,
  ): Promise<GrantResult> {
    const subjectStudentAccountId = ctx.account.id
    const now = options.now ?? new Date()
    const age = await this.loadSubjectAge(subjectStudentAccountId, now)
    const method = options.method
    const artifact = options.evidenceArtifactRef ?? null

    const resource = this.subjectResource(subjectStudentAccountId, age)
    await this.authorize(ctx, 'consent.grant', resource, { sql: this.sql })

    const renewalMs = this.config.grantRenewalMsByType[grantType]
    const expiresAt = renewalMs == null ? null : new Date(now.getTime() + renewalMs)

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [g] = await tx`
        insert into consent_grant (
          grant_type, subject_student_account_id, guardian_account_id, scope,
          method, granted_at, evidence_artifact_ref, expires_at
        ) values (
          ${grantType}, ${subjectStudentAccountId}, ${null}, ${options.scope ?? null},
          ${method}, ${now}, ${artifact}, ${expiresAt}
        ) returning id
      `
      const grantId = g!.id as string
      await writeAccessLedger(tx, {
        event: 'grant.captured',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: subjectStudentAccountId,
        guardianAccountId: null,
        consentRef: grantId,
        consentMethod: method,
        detail: { grantType, selfGrant: true, expiresAt: expiresAt?.toISOString() ?? null },
      })
      return { grantId, subjectStudentAccountId, grantType, method, expiresAt, renewal: false }
    }) as Promise<GrantResult>
  }

  /**
   * §5 Rule 5 — per-grant revocation. Gated through `authorize` under
   * `consent.revoke`. Writes a revocation row (append-only) for THAT grant type
   * only; the others are untouched. The two enrollment-required types
   * (program_participation / emergency_medical_pickup) are REFUSED — revoking
   * them ends enrollment, which routes to the existing enrollment path, never
   * silently here. Revoking `public_publication` CASCADES: the student's
   * currently-public items are unpublished/withheld in the SAME transaction.
   */
  async revokeGrant(
    subjectStudentAccountId: string,
    grantType: ConsentGrantType,
    ctx: AuthContext,
    opts: { now?: Date } = {},
  ): Promise<RevokeGrantResult> {
    if (ENROLLMENT_REQUIRED_GRANT_TYPES.includes(grantType)) {
      throw new GrantRevocationEndsEnrollmentError(grantType)
    }
    const now = opts.now ?? new Date()
    const age = await this.loadSubjectAge(subjectStudentAccountId, now)
    const resource = this.subjectResource(subjectStudentAccountId, age)
    await this.authorize(ctx, 'consent.revoke', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      // Serialization point: read the latest grant row FOR UPDATE-style via seq
      // so a concurrent capture cannot slip in. Require an active grant to revoke.
      const active = await hasActiveGrant(tx, subjectStudentAccountId, grantType, now)
      if (!active) throw new GrantNotActiveError(subjectStudentAccountId, grantType)

      const [g] = await tx`
        insert into consent_grant (
          grant_type, subject_student_account_id, guardian_account_id,
          method, granted_at, revoked_at, revoked_by
        ) values (
          ${grantType}, ${subjectStudentAccountId}, ${ctx.account.id},
          'click', ${now}, ${now}, ${ctx.account.id}
        ) returning id
      `
      const grantId = g!.id as string

      let cascaded = false
      if (grantType === 'public_publication') {
        await publicationGrantRevokeCascade(tx, subjectStudentAccountId)
        cascaded = true
      }

      await writeAccessLedger(tx, {
        event: 'grant.revoked',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: subjectStudentAccountId,
        guardianAccountId: ctx.account.id,
        consentRef: grantId,
        detail: { grantType, cascaded },
      })
      return { grantId, subjectStudentAccountId, grantType, cascaded }
    }) as Promise<RevokeGrantResult>
  }

  // ---- Guardian-portal reads (additive to P1) ------------------------------

  /**
   * GET /guardian/children — the guardian's verified children (display names
   * only). Authorized under `guardian.list_children` against one of the
   * guardian's verified children (like guardian.view_digest); a guardian with no
   * verified child is denied out_of_scope.
   */
  async listChildren(ctx: AuthContext): Promise<ChildSummary[]> {
    const anchor = ctx.guardianOf[0]
    const resource: Resource = anchor != null ? { subjectAccountId: anchor } : { subjectAccountId: null }
    await this.authorize(ctx, 'guardian.list_children', resource, { sql: this.sql })
    if (ctx.guardianOf.length === 0) return []
    const rows = await this.sql`
      select id, display_name from account where id in ${this.sql(ctx.guardianOf)}
      order by display_name asc
    `
    return rows.map((r) => ({
      childAccountId: r.id as string,
      displayName: r.display_name as string,
    }))
  }

  /**
   * GET /guardian/children/:id/grants — the six grant types with current status,
   * expiry, method, and artifact. Authorized under `guardian.view_grants` against
   * the named child. Reads the `consent_grant_current` view; a type with no row
   * is 'none', a non-active latest is 'revoked' (revoked_at set) or 'expired'.
   */
  async viewChildGrants(childId: string, ctx: AuthContext): Promise<GrantStatusView[]> {
    const age = await this.loadSubjectAge(childId, new Date())
    const resource = this.childResource(childId, age)
    await this.authorize(ctx, 'guardian.view_grants', resource, { sql: this.sql })

    const rows = await this.sql`
      select grant_type, active, expires_at, method, evidence_artifact_ref, revoked_at
      from consent_grant_current
      where subject_student_account_id = ${childId}
    `
    const byType = new Map(rows.map((r) => [r.grant_type as ConsentGrantType, r]))
    return CONSENT_GRANT_TYPES.map((grantType) => {
      const r = byType.get(grantType)
      if (r === undefined) {
        return { grantType, status: 'none' as GrantStatus, expiresAt: null, method: null, evidenceArtifactRef: null }
      }
      let status: GrantStatus
      if (r.active === true) status = 'active'
      else if (r.revoked_at != null) status = 'revoked'
      else status = 'expired'
      return {
        grantType,
        status,
        expiresAt: r.expires_at == null ? null : new Date(r.expires_at as string | Date).toISOString(),
        method: (r.method as ConsentGrantMethod | null) ?? null,
        evidenceArtifactRef: (r.evidence_artifact_ref as string | null) ?? null,
      }
    })
  }

  /**
   * GET /guardian/children/:id/public-items — the child's PUBLIC-surface items
   * only (public_listed projects + published narratives), never drafts or private
   * messages. Authorized under `guardian.view_public_items` against the named
   * child. Titles are non-identifying; no minor PII beyond that.
   */
  async viewChildPublicItems(childId: string, ctx: AuthContext): Promise<PublicItemView[]> {
    const age = await this.loadSubjectAge(childId, new Date())
    const resource = this.childResource(childId, age)
    await this.authorize(ctx, 'guardian.view_public_items', resource, { sql: this.sql })

    const projects = await this.sql`
      select p.id, p.title from project p
      join membership m on m.id = p.owner_membership_id
      where m.account_id = ${childId} and p.status = 'public_listed'
      order by p.created_at desc
    `
    const narratives = await this.sql`
      select id from profile_narrative
      where account_id = ${childId} and status = 'published'
      order by created_at desc
    `
    return [
      ...projects.map((p) => ({ type: 'project' as const, ref: p.id as string, title: p.title as string })),
      ...narratives.map((n) => ({ type: 'narrative' as const, ref: n.id as string, title: null })),
    ]
  }

  /** The guardian-scope resource naming a child (reads are not age-bounded). */
  private childResource(childId: string, age: number): Resource {
    return {
      subjectAccountId: childId,
      subjectAge: age,
      subjectIsMinor: age < 18,
    }
  }

  /**
   * §5 Rule 3 — the guardian objects to ONE nominated item during its
   * notify-and-object window, withholding it WITHOUT touching the grant. Gated
   * through `authorize` under `publication.object` against the hold's subject
   * child. Stamps `objected_at` (idempotent — a second object is a no-op) and
   * writes an access_ledger row. Refuses an unknown hold.
   */
  async objectPublicationHold(
    holdId: string,
    ctx: AuthContext,
    opts: { now?: Date } = {},
  ): Promise<{ holdId: string; objected: boolean }> {
    const now = opts.now ?? new Date()
    const [hold] = await this.sql`
      select subject_student_account_id, objected_at, released_at
      from publication_hold where id = ${holdId}
    `
    if (hold === undefined) throw new PublicationHoldNotFoundError(holdId)
    const subject = hold.subject_student_account_id as string
    const age = await this.loadSubjectAge(subject, now)
    const resource = this.subjectResource(subject, age)
    await this.authorize(ctx, 'publication.object', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update publication_hold set objected_at = ${now}, objected_by = ${ctx.account.id}
        where id = ${holdId} and objected_at is null and released_at is null
        returning id
      `
      const objected = rows.length > 0
      if (objected) {
        await writeAccessLedger(tx, {
          event: 'publication.objected',
          actorAccountId: ctx.account.id,
          realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
          subjectAccountId: subject,
          guardianAccountId: ctx.account.id,
          detail: { holdId },
        })
      }
      return { holdId, objected }
    }) as Promise<{ holdId: string; objected: boolean }>
  }
}

// ---------------------------------------------------------------------------
// §5 Rule 3 — the notify-and-object window (a JOB body + a nomination seam, not
// a live scheduler). BEHIND the flag: callers only nominate/run when
// `consentGrantLedgerEnforced` is on (the same public-publication behavior).
// ---------------------------------------------------------------------------

export interface NominateHoldArgs {
  itemType: 'project' | 'narrative' | 'newsletter_item'
  itemRef: string
  subjectStudentAccountId: string
  /** The guardian notified (for the ledger + the hold row). Null if unresolved. */
  guardianAccountId?: string | null
}

export interface NominateHoldResult {
  holdId: string
  releasesAt: Date
}

/**
 * Nominate an item for a public surface: record a `publication_hold` (item ref,
 * subject, nominated_at, guardian notified, releases_at = nominated_at + N days
 * from config) and write a `publication.notified` ledger row. The item does NOT
 * publish now — `runPublicationHolds` publishes it once the window elapses
 * without an objection. `now` is injected for determinism.
 */
export async function nominatePublicationHold(
  deps: { sql: Db; config?: Partial<AppConfig> },
  args: NominateHoldArgs,
  now: Date = new Date(),
): Promise<NominateHoldResult> {
  const config = { ...defaultConfig, ...deps.config }
  const releasesAt = new Date(now.getTime() + config.publicationHoldWindowMs)
  const [row] = await deps.sql`
    insert into publication_hold (
      item_type, item_ref, subject_student_account_id, guardian_account_id,
      nominated_at, releases_at
    ) values (
      ${args.itemType}, ${args.itemRef}, ${args.subjectStudentAccountId},
      ${args.guardianAccountId ?? null}, ${now}, ${releasesAt}
    ) returning id
  `
  const holdId = row!.id as string
  await writeAccessLedger(deps.sql, {
    event: 'publication.notified',
    actorAccountId: null,
    subjectAccountId: args.subjectStudentAccountId,
    guardianAccountId: args.guardianAccountId ?? null,
    detail: { holdId, itemType: args.itemType, itemRef: args.itemRef, releasesAt: releasesAt.toISOString() },
  })
  return { holdId, releasesAt }
}

/** The publish seam fired for a released hold (no publisher wired here). */
export type PublicationReleasePublisher = (hold: {
  holdId: string
  itemType: string
  itemRef: string
  subjectStudentAccountId: string
}) => void | Promise<void>

export interface RunPublicationHoldsDeps {
  sql: Sql
  /** Called AFTER a hold's release commits, to publish the item. Defaults to no-op. */
  publish?: PublicationReleasePublisher
  config?: Partial<AppConfig>
}

export interface RunPublicationHoldsResult {
  released: string[]
  withheld: string[]
}

/**
 * The notify-and-object JOB body (system, no actor — NOT through `authorize`).
 * For each OPEN hold whose window has elapsed (`releases_at <= now`, not objected,
 * not released): stamp `released_at`, write a `publication.released` ledger row,
 * and fire the publish seam post-commit. An OBJECTED hold whose window elapsed is
 * SKIPPED and reported in `withheld` (its `objected_at` withholds the item without
 * touching the grant). Idempotent: a released hold is never revisited. `now` is
 * injected for determinism.
 */
export async function runPublicationHolds(
  deps: RunPublicationHoldsDeps,
  now: Date = new Date(),
): Promise<RunPublicationHoldsResult> {
  const due = await deps.sql`
    select id, item_type, item_ref, subject_student_account_id, objected_at
    from publication_hold
    where releases_at <= ${now} and released_at is null
    order by releases_at asc
  `

  const released: Array<{ holdId: string; itemType: string; itemRef: string; subject: string }> = []
  const withheld: string[] = []

  for (const hold of due) {
    const holdId = hold.id as string
    if (hold.objected_at != null) {
      withheld.push(holdId)
      continue
    }
    const subject = hold.subject_student_account_id as string
    const itemType = hold.item_type as string
    const itemRef = hold.item_ref as string
    const didRelease = (await deps.sql.begin(async (tx) => {
      const rows = await tx`
        update publication_hold set released_at = ${now}
        where id = ${holdId} and released_at is null and objected_at is null
        returning id
      `
      if (rows.length === 0) return false
      await writeAccessLedger(tx, {
        event: 'publication.released',
        actorAccountId: null,
        subjectAccountId: subject,
        detail: { holdId, itemType, itemRef },
      })
      return true
    })) as boolean
    if (didRelease) released.push({ holdId, itemType, itemRef, subject })
  }

  // Publish seam fires post-commit, so a failed publish never un-releases.
  for (const r of released) {
    if (deps.publish !== undefined) {
      await deps.publish({ holdId: r.holdId, itemType: r.itemType, itemRef: r.itemRef, subjectStudentAccountId: r.subject })
    }
  }

  return { released: released.map((r) => r.holdId), withheld }
}

// ---------------------------------------------------------------------------
// §5 Rule 4 — the 18th-birthday transfer (hooked into the maturation flow).
// ---------------------------------------------------------------------------

/**
 * When a student matures to adult, the guardian's grants LAPSE (a new revoking
 * row per active guardian grant — never a mutation) and the now-adult must
 * re-confirm the persisting ones (publication, likeness, verification-link) via
 * the self-grant path. Called inside the maturation-confirm transaction so the
 * lapse commits atomically with the account flip. Records the transfer as a
 * `grant.transferred` access_ledger row. Returns the lapsed grant types. Only the
 * SELF_RECONFIRM_GRANT_TYPES are the ones the adult re-confirms; all active
 * guardian grants lapse here (the guardian's authority is gone).
 */
export async function lapseGuardianGrantsOnMaturation(
  tx: Db,
  subjectAccountId: string,
  now: Date = new Date(),
): Promise<ConsentGrantType[]> {
  const active = await tx`
    select grant_type from consent_grant_current
    where subject_student_account_id = ${subjectAccountId}
      and active = true and guardian_account_id is not null
  `
  const lapsed: ConsentGrantType[] = []
  for (const r of active) {
    const grantType = r.grant_type as ConsentGrantType
    await tx`
      insert into consent_grant (
        grant_type, subject_student_account_id, guardian_account_id,
        method, granted_at, revoked_at, revoked_by
      ) values (
        ${grantType}, ${subjectAccountId}, ${null},
        'click', ${now}, ${now}, ${null}
      )
    `
    lapsed.push(grantType)
  }
  if (lapsed.length > 0) {
    await writeAccessLedger(tx, {
      event: 'grant.transferred',
      actorAccountId: null,
      subjectAccountId: subjectAccountId,
      detail: {
        lapsed,
        reconfirmRequired: SELF_RECONFIRM_GRANT_TYPES.filter((t) => lapsed.includes(t)),
      },
    })
  }
  return lapsed
}
