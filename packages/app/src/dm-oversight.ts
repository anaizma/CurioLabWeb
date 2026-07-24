// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 3) — the DETECTION & OVERSIGHT app
// layer over the Phase 1/2 encrypted append-only thread store + the 0032 schema
// (design C.6, C.7, C.8, C.15). Built DARK behind MENTOR_DM_ENABLED (default
// false), COUNSEL-GATED. With the flag off every path here refuses — no real
// minor's messages are ever read or a guardian ever removed. Synthetic data +
// deterministic clocks only.
//
// This module owns:
//   * DmOversightService — the safety officer's FULL-COVERAGE reading queue (a
//     complete chronological, decrypted queue with flags pinned + per-thread
//     read/unread coverage + the weekly-volume transition threshold, C.6), the
//     read-receipt (markThreadRead), the flag disposition (reviewFlag), and the
//     quarterly officer-oversight export (oversightReport / dmOversightReport, C.7).
//     Every officer read + flag review + receipt appends to the MONITORING LEDGER.
//   * DmVisibilitySuspensionService — the guarded, two-adult guardian-visibility
//     suspension (C.8): initiate (records a reason + surfaces/records the reporter
//     checkpoint + a 90-day expiry), acknowledge (a SECOND adult, not a mentor in
//     the chapter, distinct from the initiator), and revoke. "Active" is COMPUTED;
//     the party-check in DmThreadService removes an active-suspension guardian.
//   * runDmFreezeOnDeparture — the mentor-departure freeze/preserve step (C.15),
//     composable with the eligibility/time-box sweeps.
//
// The safety officer CANNOT modify the monitoring ledger or any oversight record:
// they are append-only at the DATABASE (role REVOKE + the reject_append_only_mutation
// trigger), not only in code.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import {
  assertAuthorized,
  decryptField,
  writeAccessLedger,
  type AuthorizeDeps,
  type EncryptedField,
} from '@curiolab/runtime'
import { type AppConfig, DM_REPORTER_CHECKPOINT, defaultConfig } from './config.js'
import {
  DmNotAuthorizedForPairError,
  DmSuspensionNotAcknowledgeableError,
  DmSuspensionNotFoundError,
  DmSuspensionReasonRequiredError,
  DmSuspensionSecondAdultInvalidError,
  DmFlagNotFoundError,
  DmThreadNotFoundError,
} from './errors.js'

type Db = Sql | TransactionSql

/** The mentor/teaching roles a second adult MUST NOT hold in the chapter (C.8). */
const DM_MENTOR_ROLES = ['junior_mentor', 'senior_instructor', 'lead_instructor'] as const

// ===========================================================================
// DmOversightService (design C.6, C.7)
// ===========================================================================

export type DmOversightAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'dm.oversee',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface DmOversightServiceDeps {
  sql: Sql
  config?: Partial<AppConfig>
  authorize: DmOversightAuthorizeFn
}

/** One entry in the safety officer's reading queue: a decrypted message + its flags. */
export interface DmQueueItem {
  threadId: string
  messageId: string
  seq: string
  senderAccountId: string
  body: string
  sentAt: string
  flagged: boolean
  flags: { category: string; detail: string | null }[]
}

/** Per-thread coverage: read vs unread, plus the guardian-supervision signal. */
export interface DmThreadCoverage {
  threadId: string
  studentAccountId: string
  mentorMembershipId: string
  totalMessages: number
  readMessages: number
  unreadMessages: number
  /**
   * Whether a guardian has EVER opened this thread (design C.6). A SEPARATE
   * supervision signal about the PARENT that drives a guardian nudge — explicitly
   * NOT part of any mentor risk assessment (there is no mentor risk score in v1).
   */
  guardianEverOpened: boolean
}

export interface DmReadingQueue {
  items: DmQueueItem[]
  threads: DmThreadCoverage[]
  /** Messages in the chapter in the trailing 7 days from `now`. */
  weeklyMessageCount: number
  /** The configured full-review transition threshold (a placeholder, design C.6). */
  maxWeeklyMessages: number
  /**
   * Whether the chapter is OVER the full-review threshold — the point at which
   * full coverage becomes infeasible and sampling/ranking would be DESIGNED (not
   * built now). Exposed so the officer/board sees when the model must change.
   */
  overFullReviewThreshold: boolean
}

export interface DmOversightReport {
  chapterId: string
  from: string
  to: string
  totalMessages: number
  readMessages: number
  coverageRatio: number
  flagsRaised: number
  flagsReviewed: number
  flagsByCategory: Record<string, number>
  dispositions: Record<string, number>
  suspensionsInitiated: number
}

export class DmOversightService {
  private readonly sql: Sql
  private readonly config: AppConfig
  private readonly authorize: DmOversightAuthorizeFn

  constructor(deps: DmOversightServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
    this.authorize = deps.authorize
  }

  private darkGate(): void {
    if (!this.config.mentorDmEnabled) throw new DmNotAuthorizedForPairError()
  }

  /**
   * The FULL-COVERAGE chronological reading queue for the officer's chapter (design
   * C.6): every message, DECRYPTED, with flagged items PINNED to the top, plus
   * per-thread read/unread coverage and the weekly-volume threshold flag. NOT a
   * ranked sample. Chapter-scoped through `dm.oversee` — a non-officer or another
   * chapter's officer is denied an opaque 403. Appends one `dm.read_by_officer`
   * monitoring-ledger entry per thread read (design C.7).
   */
  async readingQueue(chapterId: string, ctx: AuthContext, now: Date = new Date()): Promise<DmReadingQueue> {
    this.darkGate()
    await this.authorize(ctx, 'dm.oversee', { chapter_id: chapterId }, { sql: this.sql })

    const messageRows = await this.sql`
      select m.id, m.seq, m.sender_account_id, m.body, m.sent_at, t.id as thread_id
      from dm_message m
      join dm_thread t on t.id = m.thread_id
      where t.chapter_id = ${chapterId}
      order by m.seq asc
    `
    const flagRows = await this.sql`
      select f.message_id, f.category, f.detail
      from dm_flag f join dm_thread t on t.id = f.thread_id
      where t.chapter_id = ${chapterId}
    `
    const flagsByMessage = new Map<string, { category: string; detail: string | null }[]>()
    for (const f of flagRows) {
      const key = f.message_id as string
      const list = flagsByMessage.get(key) ?? []
      list.push({ category: f.category as string, detail: (f.detail as string | null) ?? null })
      flagsByMessage.set(key, list)
    }

    const items: DmQueueItem[] = messageRows.map((m) => {
      const flags = flagsByMessage.get(m.id as string) ?? []
      return {
        threadId: m.thread_id as string,
        messageId: m.id as string,
        seq: String(m.seq),
        senderAccountId: m.sender_account_id as string,
        body: decryptField(m.body as unknown as EncryptedField),
        sentAt: new Date(m.sent_at as string).toISOString(),
        flagged: flags.length > 0,
        flags,
      }
    })
    // Flagged items PINNED to the top, otherwise chronological by seq (a complete
    // queue, not a ranked sample).
    items.sort((a, b) => {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1
      return Number(BigInt(a.seq) - BigInt(b.seq))
    })

    const coverageRows = await this.sql`
      select
        t.id as thread_id, t.student_account_id, t.mentor_membership_id,
        (select count(*) from dm_message m where m.thread_id = t.id) as total,
        (select count(*) from dm_message m
           where m.thread_id = t.id
             and m.seq <= (select coalesce(max(up_to_seq), 0) from dm_read_receipt rr where rr.thread_id = t.id)
        ) as read_count,
        exists (
          select 1 from access_ledger al
          where al.event = 'dm.read_by_guardian' and al.detail->>'threadId' = t.id::text
        ) as guardian_opened
      from dm_thread t
      where t.chapter_id = ${chapterId}
      order by t.created_at asc
    `
    const threads: DmThreadCoverage[] = coverageRows.map((r) => {
      const total = Number(r.total)
      const read = Number(r.read_count)
      return {
        threadId: r.thread_id as string,
        studentAccountId: r.student_account_id as string,
        mentorMembershipId: r.mentor_membership_id as string,
        totalMessages: total,
        readMessages: read,
        unreadMessages: total - read,
        guardianEverOpened: r.guardian_opened === true,
      }
    })

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const [wk] = await this.sql`
      select count(*) as c from dm_message m
      join dm_thread t on t.id = m.thread_id
      where t.chapter_id = ${chapterId} and m.sent_at >= ${weekAgo} and m.sent_at <= ${now}
    `
    const weeklyMessageCount = Number(wk!.c)
    const maxWeeklyMessages = this.config.dmFullReviewMaxWeeklyMessages

    // Monitoring ledger (design C.7): the officer read is recorded per thread.
    await this.sql.begin(async (tx) => {
      assertAuthorized()
      for (const t of threads) {
        await writeAccessLedger(tx, {
          event: 'dm.read_by_officer',
          actorAccountId: ctx.account.id,
          realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
          subjectAccountId: t.studentAccountId,
          chapterId,
          detail: { threadId: t.threadId },
        })
      }
    })

    return {
      items,
      threads,
      weeklyMessageCount,
      maxWeeklyMessages,
      overFullReviewThreshold: weeklyMessageCount > maxWeeklyMessages,
    }
  }

  /**
   * Mark a thread READ up to its latest `seq` (design C.6): records an append-only
   * dm_read_receipt for the officer and a `dm.receipt_recorded` monitoring-ledger
   * entry. The ledger can then show 100% coverage (every message at or below a
   * receipt is "read"). Chapter-scoped through `dm.oversee`.
   */
  async markThreadRead(
    threadId: string,
    ctx: AuthContext,
    now: Date = new Date(),
  ): Promise<{ receiptId: string; upToSeq: string }> {
    this.darkGate()
    const [thread] = await this.sql`select chapter_id from dm_thread where id = ${threadId}`
    if (thread === undefined) throw new DmThreadNotFoundError(threadId)
    await this.authorize(ctx, 'dm.oversee', { chapter_id: thread.chapter_id as string }, { sql: this.sql })

    const [maxRow] = await this.sql`select coalesce(max(seq), 0) as s from dm_message where thread_id = ${threadId}`
    const upToSeq = String(maxRow!.s)

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [r] = await tx`
        insert into dm_read_receipt (thread_id, reader_account_id, up_to_seq, read_at)
        values (${threadId}, ${ctx.account.id}, ${upToSeq}, ${now})
        returning id
      `
      await writeAccessLedger(tx, {
        event: 'dm.receipt_recorded',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId: thread.chapter_id as string,
        detail: { threadId, upToSeq },
      })
      return { receiptId: r!.id as string, upToSeq }
    }) as Promise<{ receiptId: string; upToSeq: string }>
  }

  /**
   * Record the safety officer's DISPOSITION of a raised flag (design C.7). dm_flag
   * is append-only, so a review is a NEW dm_flag_review record + a `dm.flag_reviewed`
   * monitoring-ledger entry. Chapter-scoped through `dm.oversee`.
   */
  async reviewFlag(
    flagId: string,
    disposition: string,
    ctx: AuthContext,
    opts: { note?: string | null; now?: Date } = {},
  ): Promise<{ reviewId: string }> {
    this.darkGate()
    const [flag] = await this.sql`
      select f.id, t.chapter_id from dm_flag f
      join dm_thread t on t.id = f.thread_id
      where f.id = ${flagId}
    `
    if (flag === undefined) throw new DmFlagNotFoundError(flagId)
    await this.authorize(ctx, 'dm.oversee', { chapter_id: flag.chapter_id as string }, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [r] = await tx`
        insert into dm_flag_review (flag_id, reviewed_by, disposition, note)
        values (${flagId}, ${ctx.account.id}, ${disposition}, ${opts.note ?? null})
        returning id
      `
      await writeAccessLedger(tx, {
        event: 'dm.flag_reviewed',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId: flag.chapter_id as string,
        detail: { flagId, disposition },
      })
      return { reviewId: r!.id as string }
    }) as Promise<{ reviewId: string }>
  }

  /**
   * The QUARTERLY officer-oversight export (design C.7): coverage, flags raised +
   * disposition, suspensions, and review counts for a window, for the board.
   * Chapter-scoped through `dm.oversee`; delegates to the pure aggregate below.
   */
  async oversightReport(
    args: { chapterId: string; from: Date; to: Date },
    ctx: AuthContext,
  ): Promise<DmOversightReport> {
    this.darkGate()
    await this.authorize(ctx, 'dm.oversee', { chapter_id: args.chapterId }, { sql: this.sql })
    return dmOversightReport({ sql: this.sql, ...args })
  }
}

/**
 * The quarterly officer-oversight aggregate (design C.7) — coverage, flags raised
 * and their disposition, suspensions, and review counts over [from, to] for a
 * chapter. A read-only aggregate (no `authorize` here; the caller gates on
 * `dm.oversee`). The officer holds read access to every minor's messages and is
 * therefore audited like any concentration of risk — this is that audit's data.
 */
export async function dmOversightReport(args: {
  sql: Db
  chapterId: string
  from: Date
  to: Date
}): Promise<DmOversightReport> {
  const { sql, chapterId, from, to } = args

  const [msg] = await sql`
    select
      (select count(*) from dm_message m join dm_thread t on t.id = m.thread_id
        where t.chapter_id = ${chapterId} and m.sent_at >= ${from} and m.sent_at <= ${to}) as total,
      (select count(*) from dm_message m join dm_thread t on t.id = m.thread_id
        where t.chapter_id = ${chapterId} and m.sent_at >= ${from} and m.sent_at <= ${to}
          and m.seq <= (select coalesce(max(up_to_seq), 0) from dm_read_receipt rr where rr.thread_id = t.id)
      ) as read_count
  `
  const totalMessages = Number(msg!.total)
  const readMessages = Number(msg!.read_count)

  const flagRows = await sql`
    select f.category, count(*) as c from dm_flag f join dm_thread t on t.id = f.thread_id
    where t.chapter_id = ${chapterId} and f.created_at >= ${from} and f.created_at <= ${to}
    group by f.category
  `
  const flagsByCategory: Record<string, number> = {}
  let flagsRaised = 0
  for (const r of flagRows) {
    const n = Number(r.c)
    flagsByCategory[r.category as string] = n
    flagsRaised += n
  }

  const reviewRows = await sql`
    select rv.disposition, count(*) as c
    from dm_flag_review rv
    join dm_flag f on f.id = rv.flag_id
    join dm_thread t on t.id = f.thread_id
    where t.chapter_id = ${chapterId} and rv.created_at >= ${from} and rv.created_at <= ${to}
    group by rv.disposition
  `
  const dispositions: Record<string, number> = {}
  let flagsReviewed = 0
  for (const r of reviewRows) {
    const n = Number(r.c)
    dispositions[r.disposition as string] = n
    flagsReviewed += n
  }

  const [susp] = await sql`
    select count(*) as c
    from dm_visibility_suspension s
    where s.event = 'initiated' and s.created_at >= ${from} and s.created_at <= ${to}
      and exists (
        select 1 from membership m
        where m.account_id = s.student_account_id and m.chapter_id = ${chapterId}
          and m.role = 'student'
      )
  `
  const suspensionsInitiated = Number(susp!.c)

  return {
    chapterId,
    from: from.toISOString(),
    to: to.toISOString(),
    totalMessages,
    readMessages,
    coverageRatio: totalMessages === 0 ? 1 : readMessages / totalMessages,
    flagsRaised,
    flagsReviewed,
    flagsByCategory,
    dispositions,
    suspensionsInitiated,
  }
}

// ===========================================================================
// DmVisibilitySuspensionService (design C.8)
// ===========================================================================

export type DmSuspensionInitiateAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'dm.suspend_guardian_visibility',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export type DmSuspensionAckAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'dm.acknowledge_visibility_suspension',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface DmVisibilitySuspensionServiceDeps {
  sql: Sql
  config?: Partial<AppConfig>
  authorize: DmSuspensionInitiateAuthorizeFn & DmSuspensionAckAuthorizeFn
}

export interface DmSuspensionInitiateInput {
  studentAccountId: string
  /** null/undefined = student-wide (all the student's threads); a value narrows it. */
  threadId?: string | null
  reason: string
  /** The student's chapter, for the `dm.suspend_guardian_visibility` scope. */
  chapterId: string
}

export interface DmSuspensionInitiateResult {
  suspensionId: string
  expiresAt: string
  /** The mandatory-reporter checkpoint content the interface surfaces (design C.8). */
  reporterCheckpoint: typeof DM_REPORTER_CHECKPOINT
}

export class DmVisibilitySuspensionService {
  private readonly sql: Sql
  private readonly config: AppConfig
  private readonly authorize: DmSuspensionInitiateAuthorizeFn & DmSuspensionAckAuthorizeFn

  constructor(deps: DmVisibilitySuspensionServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
    this.authorize = deps.authorize
  }

  private darkGate(): void {
    if (!this.config.mentorDmEnabled) throw new DmNotAuthorizedForPairError()
  }

  /**
   * INITIATE a guardian-visibility suspension (design C.8). Requires a recorded
   * REASON. It does NOT take effect until a second adult acknowledges (see
   * `acknowledge`). Records the 90-day expiry, surfaces + records the mandatory-
   * reporter checkpoint (reporter_checkpoint_ack), and appends a
   * `dm.visibility_suspended` monitoring-ledger entry. Only the safety officer may
   * initiate (`dm.suspend_guardian_visibility`, chapter-scoped).
   */
  async initiate(
    input: DmSuspensionInitiateInput,
    ctx: AuthContext,
    now: Date = new Date(),
  ): Promise<DmSuspensionInitiateResult> {
    this.darkGate()
    if (input.reason.trim().length === 0) throw new DmSuspensionReasonRequiredError()
    await this.authorize(ctx, 'dm.suspend_guardian_visibility', { chapter_id: input.chapterId }, { sql: this.sql })

    const expiresAt = new Date(now.getTime() + this.config.dmVisibilitySuspensionMs)
    // The initiation IS its own group: id === suspension_id. Generated in-app
    // because the table is append-only (no later UPDATE can backfill suspension_id).
    const id = randomUUID()
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      await tx`
        insert into dm_visibility_suspension (
          id, event, suspension_id, student_account_id, thread_id,
          initiated_by_safety_officer_id, reason, expires_at, reporter_checkpoint_ack, actor_account_id
        ) values (
          ${id}, 'initiated', ${id}, ${input.studentAccountId}, ${input.threadId ?? null},
          ${ctx.account.id}, ${input.reason}, ${expiresAt}, true, ${ctx.account.id}
        )
      `
      await writeAccessLedger(tx, {
        event: 'dm.visibility_suspended',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: input.studentAccountId,
        chapterId: input.chapterId,
        detail: { suspensionId: id, threadId: input.threadId ?? null, expiresAt: expiresAt.toISOString() },
      })
      return {
        suspensionId: id,
        expiresAt: expiresAt.toISOString(),
        reporterCheckpoint: DM_REPORTER_CHECKPOINT,
      }
    }) as Promise<DmSuspensionInitiateResult>
  }

  /** Resolve the chapter a suspension belongs to (its thread's, else the student's). */
  private async resolveChapter(initiation: {
    thread_id: string | null
    student_account_id: string
  }): Promise<string | null> {
    if (initiation.thread_id !== null) {
      const [t] = await this.sql`select chapter_id from dm_thread where id = ${initiation.thread_id}`
      return t === undefined ? null : (t.chapter_id as string)
    }
    const [m] = await this.sql`
      select chapter_id from membership
      where account_id = ${initiation.student_account_id} and role = 'student' and status = 'active'
      limit 1
    `
    return m === undefined ? null : (m.chapter_id as string)
  }

  /**
   * ACKNOWLEDGE a suspension as the SECOND adult (design C.8), bringing it into
   * effect. The acknowledger must (a) not be the initiating officer, and (b) not be
   * a mentor in that chapter (the second adult is another director/safety officer/
   * board-level account). Gated by `dm.acknowledge_visibility_suspension`
   * (chapter-scoped, director/safety-officer). Appends a `dm.visibility_acknowledged`
   * monitoring-ledger entry.
   */
  async acknowledge(
    suspensionId: string,
    ctx: AuthContext,
    now: Date = new Date(),
  ): Promise<{ acknowledged: true }> {
    this.darkGate()
    const [init] = await this.sql`
      select id, suspension_id, student_account_id, thread_id,
             initiated_by_safety_officer_id, expires_at
      from dm_visibility_suspension
      where id = ${suspensionId} and event = 'initiated'
    `
    if (init === undefined) throw new DmSuspensionNotFoundError(suspensionId)
    const chapterId = await this.resolveChapter({
      thread_id: (init.thread_id as string | null) ?? null,
      student_account_id: init.student_account_id as string,
    })
    if (chapterId === null) throw new DmSuspensionNotFoundError(suspensionId)
    await this.authorize(ctx, 'dm.acknowledge_visibility_suspension', { chapter_id: chapterId }, { sql: this.sql })

    // State: only a live, unacknowledged, unrevoked initiation may be acknowledged.
    const [state] = await this.sql`
      select
        exists (select 1 from dm_visibility_suspension a where a.suspension_id = ${init.suspension_id} and a.event = 'acknowledged') as acked,
        exists (select 1 from dm_visibility_suspension r where r.suspension_id = ${init.suspension_id} and r.event = 'revoked') as revoked
    `
    if (state!.revoked === true) throw new DmSuspensionNotAcknowledgeableError(suspensionId, 'revoked')
    if (state!.acked === true) throw new DmSuspensionNotAcknowledgeableError(suspensionId, 'already_acknowledged')
    if (new Date(init.expires_at as string).getTime() <= now.getTime()) {
      throw new DmSuspensionNotAcknowledgeableError(suspensionId, 'expired')
    }

    // The second-adult rules (design C.8).
    if (ctx.account.id === (init.initiated_by_safety_officer_id as string)) {
      throw new DmSuspensionSecondAdultInvalidError('same_as_initiator')
    }
    const mentorHere = await this.sql`
      select 1 from membership
      where account_id = ${ctx.account.id} and chapter_id = ${chapterId}
        and status = 'active' and role in ${this.sql(DM_MENTOR_ROLES as unknown as string[])}
      limit 1
    `
    if (mentorHere.length > 0) throw new DmSuspensionSecondAdultInvalidError('is_mentor_in_chapter')

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      await tx`
        insert into dm_visibility_suspension (
          event, suspension_id, student_account_id, thread_id, second_adult_account_id, actor_account_id
        ) values (
          'acknowledged', ${init.suspension_id}, ${init.student_account_id}, ${init.thread_id ?? null},
          ${ctx.account.id}, ${ctx.account.id}
        )
      `
      await writeAccessLedger(tx, {
        event: 'dm.visibility_acknowledged',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: init.student_account_id as string,
        chapterId,
        detail: { suspensionId },
      })
      return { acknowledged: true as const }
    }) as Promise<{ acknowledged: true }>
  }

  /**
   * REVOKE an active suspension early (design C.8) — the safety officer lifts it
   * before expiry. Records an append-only 'revoked' event + a `dm.visibility_revoked`
   * monitoring-ledger entry. After this the guardian's standing access restores.
   */
  async revoke(
    suspensionId: string,
    ctx: AuthContext,
  ): Promise<{ revoked: true }> {
    this.darkGate()
    const [init] = await this.sql`
      select id, suspension_id, student_account_id, thread_id
      from dm_visibility_suspension where id = ${suspensionId} and event = 'initiated'
    `
    if (init === undefined) throw new DmSuspensionNotFoundError(suspensionId)
    const chapterId = await this.resolveChapter({
      thread_id: (init.thread_id as string | null) ?? null,
      student_account_id: init.student_account_id as string,
    })
    if (chapterId === null) throw new DmSuspensionNotFoundError(suspensionId)
    await this.authorize(ctx, 'dm.suspend_guardian_visibility', { chapter_id: chapterId }, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      await tx`
        insert into dm_visibility_suspension (event, suspension_id, student_account_id, thread_id, actor_account_id)
        values ('revoked', ${init.suspension_id}, ${init.student_account_id}, ${init.thread_id ?? null}, ${ctx.account.id})
      `
      await writeAccessLedger(tx, {
        event: 'dm.visibility_revoked',
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: init.student_account_id as string,
        chapterId,
        detail: { suspensionId },
      })
      return { revoked: true as const }
    }) as Promise<{ revoked: true }>
  }
}

// ===========================================================================
// Mentor-departure freeze (design C.15)
// ===========================================================================

export interface RunDmFreezeOnDepartureArgs {
  mentorMembershipId: string
  /** The recorded handoff decision (successor_mentor | paused | safety_officer_conversation | …). */
  handoffDecision: string
  reason?: string | null
  /** The actor who triggered the freeze (a director), or null for a system sweep. */
  frozenByAccountId?: string | null
  now?: Date
}

export interface RunDmFreezeOnDepartureResult {
  frozenThreadIds: string[]
}

/**
 * FREEZE and PRESERVE a departed mentor's threads (design C.15). When a mentor's
 * assignment/eligibility is revoked, `canDirectMessage` already goes false so no
 * new messages flow; this adds the freeze/preserve semantics: each of the mentor's
 * threads gets an append-only freeze row (one per thread, idempotent) carrying the
 * RECORDED handoff decision. A frozen thread is NEVER deleted, remains readable to
 * the authorized parties, and accepts no new messages (even if the pair is later
 * re-enabled) — enforced in DmThreadService.sendMessage. Composable with the
 * eligibility/time-box sweeps. A system step (no `authorize`); appends a
 * `dm.thread_frozen` monitoring-ledger entry per thread.
 */
export async function runDmFreezeOnDeparture(
  sql: Sql,
  args: RunDmFreezeOnDepartureArgs,
): Promise<RunDmFreezeOnDepartureResult> {
  const threads = await sql`
    select t.id, t.chapter_id, t.student_account_id
    from dm_thread t
    left join dm_thread_freeze f on f.thread_id = t.id
    where t.mentor_membership_id = ${args.mentorMembershipId} and f.id is null
  `
  if (threads.length === 0) return { frozenThreadIds: [] }

  return sql.begin(async (tx) => {
    const frozenThreadIds: string[] = []
    for (const t of threads) {
      await tx`
        insert into dm_thread_freeze (thread_id, mentor_membership_id, reason, handoff_decision, frozen_by_account_id)
        values (${t.id}, ${args.mentorMembershipId}, ${args.reason ?? null}, ${args.handoffDecision}, ${args.frozenByAccountId ?? null})
      `
      await writeAccessLedger(tx, {
        event: 'dm.thread_frozen',
        actorAccountId: args.frozenByAccountId ?? null,
        subjectAccountId: t.student_account_id as string,
        chapterId: t.chapter_id as string,
        detail: { threadId: t.id as string, handoffDecision: args.handoffDecision },
      })
      frozenThreadIds.push(t.id as string)
    }
    return { frozenThreadIds }
  }) as Promise<RunDmFreezeOnDepartureResult>
}
