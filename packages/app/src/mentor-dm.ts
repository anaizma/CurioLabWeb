// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 1) — the app-layer services over the
// 0029/0030 schema, the P6a consent grant-ledger, P6b mentor eligibility, pod
// assignment, and the encryption seam. Built DARK behind MENTOR_DM_ENABLED
// (default false), COUNSEL-GATED (design Part A/B). With the flag off,
// canDirectMessage returns false and every send is refused — no real minor can be
// a party. Synthetic data + deterministic clocks only.
//
// This module owns:
//   * SafetyOfficerService.assign — the director/admin authority to name a
//     chapter's INDEPENDENT safety officer, refusing the not-a-peer case (design
//     C.1). safety_officer.assign; the DB trigger is the floor.
//   * DmEnableService — recordInsuranceAttestation + enable (the Part D gate):
//     dm.enable refuses unless a safety officer is assigned, an insurance
//     attestation is on record, and the chapter has >=1 current-term pod.
//   * DmThreadService — resolveDirectMessaging (composes canDirectMessage from the
//     four DB legs + the two switches), the four-party read model, and the GATED
//     send/read of ENCRYPTED messages (the body is AES-256-GCM at rest via the
//     runtime field-crypto seam; decrypted server-side for an authorized party).
//
// The participant SEND/READ HTTP endpoints are Phase 4; the send/read SERVICES
// here exist so the mechanism is tested, and are hard-gated so they cannot run
// with the flag off.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import {
  canDirectMessage,
  detectDmContentFlags,
  type AuthContext,
  type DirectMessageMentor,
  type DirectMessageStudent,
  type DmContentFlag,
  type Resource,
} from '@curiolab/core'
import {
  Forbidden,
  assertAuthorized,
  decryptField,
  encryptField,
  writeAccessLedger,
  type AuthorizeDeps,
  type EncryptedField,
} from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { loadMentorEligibility } from './mentor-eligibility.js'
import {
  DmClosedHoursError,
  DmEnablePreconditionError,
  DmNotAuthorizedForPairError,
  DmThreadNotFoundError,
  SafetyOfficerPeerConflictError,
} from './errors.js'

type Db = Sql | TransactionSql

/**
 * The sender's LOCAL wall-clock hour (0-23) in a timezone, at `now`. Deterministic
 * given `now` + the IANA zone — used by the closed-hours check (design C.4). Uses
 * Intl (the platform tz database), never a process-local clock.
 */
function localHourInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '0'
  return Number.parseInt(hour, 10) % 24
}

/**
 * The permanent, identical-to-all visibility header (design C.2). Every thread
 * stores this text + version so the header is a fixed part of the record, not a
 * frontend string. A VALUE, not a literal — a wording change is a config edit.
 */
export const DM_VISIBILITY_HEADER_VERSION = 'v1'
export const DM_VISIBILITY_HEADER_TEXT =
  'This conversation is saved permanently. It can be read at any time by the chapter ' +
  'safety officer and by your guardian, and cannot be deleted or edited by either participant.'

// ===========================================================================
// SafetyOfficerService (design C.1)
// ===========================================================================

export type SafetyOfficerAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'safety_officer.assign',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface SafetyOfficerServiceDeps {
  sql: Sql
  authorize: SafetyOfficerAuthorizeFn
}

export interface SafetyOfficerAssignResult {
  membershipId: string
  chapterId: string
  accountId: string
}

/** The roles a safety officer may not also hold in the same chapter (not-a-peer). */
const SAFETY_OFFICER_PEER_ROLES = [
  'student',
  'junior_mentor',
  'senior_instructor',
  'lead_instructor',
  'chapter_director',
] as const

export class SafetyOfficerService {
  private readonly sql: Sql
  private readonly authorize: SafetyOfficerAuthorizeFn

  constructor(deps: SafetyOfficerServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Assign `targetAccountId` as the chapter's safety officer (safety_officer.assign,
   * chapter-scoped). Refuses the not-a-peer case (design C.1): the target may not
   * already hold a mentor/teaching or student membership in that chapter. Both a
   * service pre-check AND the DB trigger enforce it; either raises the opaque
   * SafetyOfficerPeerConflictError. Idempotent on an existing safety_officer row.
   */
  async assign(
    chapterId: string,
    targetAccountId: string,
    ctx: AuthContext,
  ): Promise<SafetyOfficerAssignResult> {
    const resource: Resource = { chapter_id: chapterId }
    await this.authorize(ctx, 'safety_officer.assign', resource, { sql: this.sql })

    // Service-layer not-a-peer pre-check (the DB trigger is the floor).
    const peers = await this.sql`
      select 1 from membership
      where account_id = ${targetAccountId} and chapter_id = ${chapterId}
        and status <> 'offboarded'
        and role in ${this.sql(SAFETY_OFFICER_PEER_ROLES as unknown as string[])}
      limit 1
    `
    if (peers.length > 0) throw new SafetyOfficerPeerConflictError()

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const existing = await tx`
        select id from membership
        where account_id = ${targetAccountId} and chapter_id = ${chapterId}
          and role = 'safety_officer' and status = 'active'
        limit 1
      `
      let membershipId: string
      if (existing.length > 0) {
        membershipId = existing[0]!.id as string
      } else {
        let row
        try {
          ;[row] = await tx`
            insert into membership (account_id, chapter_id, role, status)
            values (${targetAccountId}, ${chapterId}, 'safety_officer', 'active')
            returning id
          `
        } catch (e) {
          // The not-a-peer trigger (0030) raises check_violation; map to opaque.
          if (e instanceof Error && /safety_officer|same chapter/i.test(e.message)) {
            throw new SafetyOfficerPeerConflictError()
          }
          throw e
        }
        membershipId = row!.id as string
      }
      await writeAccessLedger(tx, {
        event: 'safety_officer.assigned',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: targetAccountId,
        chapterId,
        detail: { membershipId },
      })
      return { membershipId, chapterId, accountId: targetAccountId }
    }) as Promise<SafetyOfficerAssignResult>
  }
}

// ===========================================================================
// DmEnableService (design Part D) — the insurance attestation + the enable gate.
// ===========================================================================

export type DmEnableAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'dm.enable',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface DmEnableServiceDeps {
  sql: Sql
  authorize: DmEnableAuthorizeFn
  config?: Partial<AppConfig>
}

export interface InsuranceAttestationInput {
  carrier?: string | null
  policyRef?: string | null
}

export class DmEnableService {
  private readonly sql: Sql
  private readonly authorize: DmEnableAuthorizeFn

  constructor(deps: DmEnableServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Record an abuse-and-molestation insurance attestation for a chapter (a Part D
   * enable precondition). Gated through dm.enable (director/admin). Append-only.
   */
  async recordInsuranceAttestation(
    chapterId: string,
    input: InsuranceAttestationInput,
    ctx: AuthContext,
  ): Promise<{ attestationId: string; chapterId: string }> {
    const resource: Resource = { chapter_id: chapterId }
    await this.authorize(ctx, 'dm.enable', resource, { sql: this.sql })
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into dm_insurance_attestation (chapter_id, carrier, policy_ref, attested_by)
        values (${chapterId}, ${input.carrier ?? null}, ${input.policyRef ?? null}, ${ctx.account.id})
        returning id
      `
      await writeAccessLedger(tx, {
        event: 'dm.insurance_attested',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail: { attestationId: row!.id as string },
      })
      return { attestationId: row!.id as string, chapterId }
    }) as Promise<{ attestationId: string; chapterId: string }>
  }

  /**
   * Flip the chapter DM switch ON (dm.enable, director/admin). REFUSES unless, in
   * the system (design Part D): a safety_officer is assigned to the chapter (and,
   * by the not-a-peer floor, is not a mentor/student there), an insurance
   * attestation is on record, and the chapter has >=1 current-term pod. Idempotent
   * on an existing switch row. Note: even after this, the GLOBAL MENTOR_DM_ENABLED
   * flag must ALSO be on for any DM to flow (canDirectMessage).
   */
  async enable(
    chapterId: string,
    ctx: AuthContext,
    opts: { now?: Date } = {},
  ): Promise<{ chapterId: string; alreadyEnabled: boolean }> {
    const now = opts.now ?? new Date()
    const resource: Resource = { chapter_id: chapterId }
    await this.authorize(ctx, 'dm.enable', resource, { sql: this.sql })

    // Precondition 1: an assigned, active safety officer.
    const so = await this.sql`
      select 1 from membership
      where chapter_id = ${chapterId} and role = 'safety_officer' and status = 'active' limit 1
    `
    if (so.length === 0) throw new DmEnablePreconditionError('no_safety_officer')

    // Precondition 2: an insurance attestation on record.
    const ins = await this.sql`
      select 1 from dm_insurance_attestation where chapter_id = ${chapterId} limit 1
    `
    if (ins.length === 0) throw new DmEnablePreconditionError('no_insurance_attestation')

    // Precondition 3: >=1 current-term pod (a term whose window contains `now`).
    const pods = await this.sql`
      select 1 from pod p
      join term t on t.id = p.term_id
      where p.chapter_id = ${chapterId}
        and t.starts_on <= ${now} and t.ends_on >= ${now}
      limit 1
    `
    if (pods.length === 0) throw new DmEnablePreconditionError('no_current_term_pod')

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const existing = await tx`select 1 from dm_chapter_switch where chapter_id = ${chapterId} limit 1`
      if (existing.length > 0) return { chapterId, alreadyEnabled: true }
      await tx`
        insert into dm_chapter_switch (chapter_id, enabled_by) values (${chapterId}, ${ctx.account.id})
      `
      await writeAccessLedger(tx, {
        event: 'dm.chapter_enabled',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId,
        detail: {},
      })
      return { chapterId, alreadyEnabled: false }
    }) as Promise<{ chapterId: string; alreadyEnabled: boolean }>
  }
}

// ===========================================================================
// DmThreadService (design C.2, C.3, C.11) — the four-party thread + gated send/read.
// ===========================================================================

export type DmThreadAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'dm.message',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface DmThreadServiceDeps {
  sql: Sql
  config?: Partial<AppConfig>
  /** Required only for the gated send path (authorizes dm.message). */
  authorize?: DmThreadAuthorizeFn
}

export interface DmDecryptedMessage {
  id: string
  seq: string
  senderAccountId: string
  body: string
  sentAt: string
}

/**
 * The result of the PRE-SEND draft check (design C.4): the contact-info flags a
 * draft body would raise, WITHOUT sending. The frontend renders its interstitial
 * from `flags`; sending is a separate call (a flag is friction, not a block).
 */
export interface DmDraftCheckResult {
  flags: DmContentFlag[]
}

/** The full decrypted export of a thread (design C.4): the thread + its messages in order. */
export interface DmThreadExport {
  /** When the export was generated (the injected `now`). */
  generatedAt: string
  thread: {
    id: string
    chapterId: string
    mentorMembershipId: string
    studentAccountId: string
    visibilityHeader: string
    createdAt: string
  }
  messages: DmDecryptedMessage[]
}

export class DmThreadService {
  private readonly sql: Sql
  private readonly config: AppConfig
  private readonly authorize?: DmThreadAuthorizeFn

  constructor(deps: DmThreadServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
    this.authorize = deps.authorize
  }

  /**
   * Whether the chapter DM switch is on (a dm_chapter_switch row exists). The
   * GLOBAL flag (config.mentorDmEnabled) is a separate, ANDed gate.
   */
  private async chapterEnabled(db: Db, chapterId: string): Promise<boolean> {
    const rows = await db`select 1 from dm_chapter_switch where chapter_id = ${chapterId} limit 1`
    return rows.length > 0
  }

  /** The distinct pods a mentor membership is assigned to in the CURRENT term. */
  private async assignedPodIds(db: Db, mentorMembershipId: string, now: Date): Promise<string[]> {
    const rows = await db`
      select distinct p.id from pod p
      join term t on t.id = p.term_id
      where t.starts_on <= ${now} and t.ends_on >= ${now}
        and (
          p.mentor_membership_id = ${mentorMembershipId}
          or exists (
            select 1 from pod_assignment pa
            where pa.pod_id = p.id and pa.membership_id = ${mentorMembershipId} and pa.term_id = p.term_id
          )
          or exists (
            select 1 from membership m
            where m.id = ${mentorMembershipId} and m.pod_id = p.id
          )
        )
    `
    return rows.map((r) => r.id as string)
  }

  /** The student's current-term pod (their active student membership's pod). */
  private async studentCurrentPod(db: Db, studentAccountId: string, now: Date): Promise<string | null> {
    const [row] = await db`
      select p.id from membership m
      join pod p on p.id = m.pod_id
      join term t on t.id = p.term_id
      where m.account_id = ${studentAccountId} and m.role = 'student' and m.status = 'active'
        and t.starts_on <= ${now} and t.ends_on >= ${now}
      limit 1
    `
    return row === undefined ? null : (row.id as string)
  }

  /** The latest mentor_dm grant snapshot for a student, or null. */
  private async mentorDmGrant(
    db: Db,
    studentAccountId: string,
  ): Promise<DirectMessageStudent['mentorDmGrant']> {
    const [row] = await db`
      select expires_at, revoked_at from consent_grant
      where subject_student_account_id = ${studentAccountId} and grant_type = 'mentor_dm'
      order by seq desc limit 1
    `
    if (row === undefined) return null
    const expiresAt = row.expires_at as Date | string | null
    const revokedAt = row.revoked_at as Date | string | null
    return {
      expiresAt: expiresAt == null ? null : new Date(expiresAt).getTime(),
      revokedAt: revokedAt == null ? null : new Date(revokedAt).getTime(),
    }
  }

  /**
   * Compose the pure `canDirectMessage` predicate from the four DB legs + the two
   * switches, at `now`. Re-evaluated at every send and read. Returns the boolean
   * plus the resolved current-term pod (the thread's binding). With the global flag
   * off this is always false — the feature is dark.
   */
  async resolveDirectMessaging(
    mentorMembershipId: string,
    studentAccountId: string,
    chapterId: string,
    now: Date = new Date(),
  ): Promise<{ allowed: boolean; studentPodId: string | null }> {
    const [assignedPodIds, studentPodId, mentorDmGrant, eligibility, chapterOn] = await Promise.all([
      this.assignedPodIds(this.sql, mentorMembershipId, now),
      this.studentCurrentPod(this.sql, studentAccountId, now),
      this.mentorDmGrant(this.sql, studentAccountId),
      loadMentorEligibility(this.sql, mentorMembershipId, now),
      this.chapterEnabled(this.sql, chapterId),
    ])
    const mentor: DirectMessageMentor = {
      assignedPodIds,
      eligibility,
      chapterDmEnabled: chapterOn,
      globalDmEnabled: this.config.mentorDmEnabled,
    }
    const student: DirectMessageStudent = { currentTermPodId: studentPodId, mentorDmGrant }
    return { allowed: canDirectMessage(mentor, student, now.getTime()), studentPodId }
  }

  /**
   * The FOUR-PARTY read model (design C.2): `accountId` has standing read access to
   * a thread iff it is one of the two participants (the mentor via their membership,
   * or the student), the chapter safety officer, or a VERIFIED guardian of the
   * student. Everyone else is denied.
   */
  async isPartyToThread(threadId: string, accountId: string): Promise<boolean> {
    const [row] = await this.sql`
      with th as (select * from dm_thread where id = ${threadId})
      select
        exists (select 1 from th) as thread_exists,
        exists (
          select 1 from th
          join membership m on m.id = th.mentor_membership_id
          where m.account_id = ${accountId}
        ) as is_mentor,
        exists (select 1 from th where th.student_account_id = ${accountId}) as is_student,
        exists (
          select 1 from th
          join membership so on so.chapter_id = th.chapter_id
          where so.account_id = ${accountId} and so.role = 'safety_officer' and so.status = 'active'
        ) as is_safety_officer,
        exists (
          select 1 from th
          join guardianship g on g.student_account_id = th.student_account_id
          where g.guardian_account_id = ${accountId} and g.status = 'verified'
        ) as is_guardian
    `
    if (row === undefined || row.thread_exists !== true) return false
    return (
      row.is_mentor === true ||
      row.is_student === true ||
      row.is_safety_officer === true ||
      row.is_guardian === true
    )
  }

  /**
   * Send a message from `senderAccountId` (a participant) in the mentor<->student
   * thread. HARD-GATED: if the feature is dark (canDirectMessage false — global flag
   * off, chapter off, no assignment/consent/eligibility) it throws
   * DmNotAuthorizedForPairError and writes NOTHING, so no real minor can be a party
   * with the flag off. The thread is created on first send (INSERT-once, carrying
   * the permanent visibility header). The body is ENCRYPTED at rest via the runtime
   * field-crypto seam — plaintext never touches the database. `now` is injected.
   */
  async sendMessage(
    args: {
      mentorMembershipId: string
      studentAccountId: string
      chapterId: string
      body: string
    },
    ctx: AuthContext,
    now: Date = new Date(),
  ): Promise<{ threadId: string; messageId: string }> {
    if (this.authorize === undefined) {
      throw new Error('DmThreadService.sendMessage requires an injected authorize')
    }
    const senderAccountId = ctx.account.id
    // Authorize the participant floor (dm.message: a student OR mentor in the
    // chapter). This records the decision the repository-write backstop requires,
    // and denies a non-participant role an opaque Forbidden.
    await this.authorize(ctx, 'dm.message', { chapter_id: args.chapterId }, { sql: this.sql })

    // The pair-specific gate: canDirectMessage (assignment + current mentor_dm grant
    // + eligibility + chapter switch + the GLOBAL flag). Dark => refuse, write nothing.
    const { allowed } = await this.resolveDirectMessaging(
      args.mentorMembershipId,
      args.studentAccountId,
      args.chapterId,
      now,
    )
    if (!allowed) throw new DmNotAuthorizedForPairError()

    // The sender must be one of the two participants (the mentor or the student).
    const isMentor = await this.sql`
      select 1 from membership where id = ${args.mentorMembershipId} and account_id = ${senderAccountId}
    `
    const isSender = isMentor.length > 0 || senderAccountId === args.studentAccountId
    if (!isSender) throw new Forbidden()

    // Closed hours (design C.4): a SEND is refused outside the chapter's allowed
    // LOCAL window (default 07:00-21:00, per-chapter overridable). Deterministic —
    // computed from the chapter timezone at the injected `now`. Reads are NEVER
    // hours-gated. Refuse BEFORE any write, so nothing is stored out of hours.
    await this.assertWithinAllowedHours(this.sql, args.chapterId, now)

    // Off-platform contact-info detection (design C.4/C.5): run the PURE detector on
    // the PLAINTEXT (before encryption — never against ciphertext). A match records
    // an append-only dm_flag AFTER the message is written; it does NOT block the send
    // (friction, not a block). `detail` is the matched KIND, never the raw match.
    const contentFlags = detectDmContentFlags(args.body)

    const envelope: EncryptedField = encryptField(args.body)

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const existing = await tx`
        select id from dm_thread
        where mentor_membership_id = ${args.mentorMembershipId} and student_account_id = ${args.studentAccountId}
      `
      let threadId: string
      if (existing.length > 0) {
        threadId = existing[0]!.id as string
      } else {
        const [t] = await tx`
          insert into dm_thread (
            chapter_id, mentor_membership_id, student_account_id,
            visibility_header_version, visibility_header_text
          ) values (
            ${args.chapterId}, ${args.mentorMembershipId}, ${args.studentAccountId},
            ${DM_VISIBILITY_HEADER_VERSION}, ${DM_VISIBILITY_HEADER_TEXT}
          ) returning id
        `
        threadId = t!.id as string
      }
      const [m] = await tx`
        insert into dm_message (thread_id, sender_account_id, body)
        values (${threadId}, ${senderAccountId}, ${tx.json(envelope as unknown as Parameters<typeof tx.json>[0])})
        returning id
      `
      const messageId = m!.id as string
      // Record the content flags (append-only dm_flag), routed to the safety officer
      // (Phase 3 queue). The send is NOT blocked by a flag.
      for (const flag of contentFlags) {
        await tx`
          insert into dm_flag (thread_id, message_id, category, detail)
          values (${threadId}, ${messageId}, ${flag.category}, ${flag.detail})
        `
      }
      await writeAccessLedger(tx, {
        event: 'dm.message_sent',
        actorAccountId: senderAccountId,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: args.studentAccountId,
        chapterId: args.chapterId,
        detail: { threadId, messageId, flagCount: contentFlags.length },
      })
      return { threadId, messageId }
    }) as Promise<{ threadId: string; messageId: string }>
  }

  /**
   * Refuse a SEND outside the chapter's allowed messaging window (design C.4). The
   * window is `[open, close)` in the chapter's LOCAL wall-clock hour: per-chapter
   * `dm_open_hour`/`dm_close_hour` when set (migration 0031), else the config
   * default (07:00-21:00). Deterministic — the local hour is derived from the
   * chapter timezone at the injected `now`. Throws DmClosedHoursError when closed.
   */
  private async assertWithinAllowedHours(db: Db, chapterId: string, now: Date): Promise<void> {
    const [ch] = await db`
      select timezone, dm_open_hour, dm_close_hour from chapter where id = ${chapterId}
    `
    // A missing chapter row cannot happen for an authorized pair; default safely.
    const timezone = (ch?.timezone as string | undefined) ?? 'America/New_York'
    const openHour = (ch?.dm_open_hour as number | null | undefined) ?? this.config.dmOpenHourDefault
    const closeHour = (ch?.dm_close_hour as number | null | undefined) ?? this.config.dmCloseHourDefault
    const localHour = localHourInZone(now, timezone)
    if (!(localHour >= openHour && localHour < closeHour)) {
      throw new DmClosedHoursError(localHour, openHour, closeHour)
    }
  }

  /**
   * The PRE-SEND draft check (design C.4): return the contact-info flags a draft
   * body would raise, WITHOUT sending anything. PURE (over the core detector) — the
   * frontend renders its interstitial from the result. A flag is friction the sender
   * can proceed past; it never blocks the send.
   */
  checkDraft(body: string): DmDraftCheckResult {
    return { flags: detectDmContentFlags(body) }
  }

  /**
   * Export the FULL decrypted thread on demand (design C.4), scoped so ONLY the
   * STUDENT (their own thread) or a VERIFIED GUARDIAN of that student can export.
   * Everyone else — the mentor, the safety officer, a stranger, another chapter —
   * gets an opaque Forbidden. Gated behind the global flag: with MENTOR_DM_ENABLED
   * off the feature is dark and export refuses (there are no real threads anyway).
   * A read of already-authorized data, so it is NOT hours-gated.
   */
  async exportThread(
    threadId: string,
    readerAccountId: string,
    now: Date = new Date(),
  ): Promise<DmThreadExport> {
    if (!this.config.mentorDmEnabled) throw new DmNotAuthorizedForPairError()

    const [thread] = await this.sql`
      select id, chapter_id, mentor_membership_id, student_account_id,
             visibility_header_text, created_at
      from dm_thread where id = ${threadId}
    `
    if (thread === undefined) throw new DmThreadNotFoundError(threadId)

    // Student-or-guardian scope (NOT the four-party read): the student themselves,
    // or a verified guardian of the student. Anyone else -> opaque Forbidden.
    const isStudent = thread.student_account_id === readerAccountId
    let allowed = isStudent
    if (!allowed) {
      const guardian = await this.sql`
        select 1 from guardianship
        where student_account_id = ${thread.student_account_id}
          and guardian_account_id = ${readerAccountId} and status = 'verified'
        limit 1
      `
      allowed = guardian.length > 0
    }
    if (!allowed) throw new Forbidden()

    const rows = await this.sql`
      select id, seq, sender_account_id, body, sent_at from dm_message
      where thread_id = ${threadId} order by seq asc
    `
    const messages: DmDecryptedMessage[] = rows.map((r) => ({
      id: r.id as string,
      seq: String(r.seq),
      senderAccountId: r.sender_account_id as string,
      body: decryptField(r.body as unknown as EncryptedField),
      sentAt: new Date(r.sent_at as string).toISOString(),
    }))
    return {
      generatedAt: now.toISOString(),
      thread: {
        id: thread.id as string,
        chapterId: thread.chapter_id as string,
        mentorMembershipId: thread.mentor_membership_id as string,
        studentAccountId: thread.student_account_id as string,
        visibilityHeader: thread.visibility_header_text as string,
        createdAt: new Date(thread.created_at as string).toISOString(),
      },
      messages,
    }
  }

  /**
   * Read a thread's messages, DECRYPTED server-side, for an authorized party. The
   * four-party read check gates access (a non-party gets an opaque Forbidden).
   * Reads are NOT flag-gated (a guardian/safety officer may always read a retained
   * thread), but no thread can exist unless a send happened while the pair was
   * authorized.
   */
  async readThread(
    threadId: string,
    readerAccountId: string,
  ): Promise<{ visibilityHeader: string; messages: DmDecryptedMessage[] }> {
    const [thread] = await this.sql`
      select visibility_header_text from dm_thread where id = ${threadId}
    `
    if (thread === undefined) throw new DmThreadNotFoundError(threadId)
    if (!(await this.isPartyToThread(threadId, readerAccountId))) throw new Forbidden()

    const rows = await this.sql`
      select id, seq, sender_account_id, body, sent_at from dm_message
      where thread_id = ${threadId} order by seq asc
    `
    const messages = rows.map((r) => ({
      id: r.id as string,
      seq: String(r.seq),
      senderAccountId: r.sender_account_id as string,
      body: decryptField(r.body as unknown as EncryptedField),
      sentAt: new Date(r.sent_at as string).toISOString(),
    }))
    return { visibilityHeader: thread.visibility_header_text as string, messages }
  }
}
