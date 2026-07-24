// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 4) — the PARTICIPANT & GUARDIAN
// SURFACES app layer over the Phase 1-3 encrypted append-only thread store +
// detection/oversight + the 0033 tables (design C.2, C.10, C.12; Part E.4). Built
// DARK behind MENTOR_DM_ENABLED (default false), COUNSEL-GATED. With the flag off
// EVERY path here refuses — no real minor's messages are read, listed, reported,
// or digested. Synthetic data + deterministic clocks only.
//
// This module owns:
//   * DmParticipantService — the two participants' OWN surfaces: list their own
//     threads, read a thread (carrying the permanent visibility header AND the
//     who-can-read statement, C.2), the first-open onboarding (get + ack, C.12),
//     and the low-key "something feels off" report (C.12) that routes to the SAFETY
//     OFFICER and does NOT notify the mentor (no mentor-visible signal), plus the
//     safety officer's read of those reports.
//   * DmGuardianDmService — the guardian's read of their OWN child's threads
//     (suspension-aware via isPartyToThread) and the weekly digest DATA (thread +
//     message counts + flags for that child only; the email itself is frontend-owned).
//
// The four-party read model, the suspension-aware party check, and the encrypted
// decrypt-on-read all live in DmThreadService (Phase 1/3); this layer composes them.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import {
  Forbidden,
  assertAuthorized,
  writeAccessLedger,
  type AuthorizeDeps,
} from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { DmThreadService, type DmDecryptedMessage } from './mentor-dm.js'
import { DmNotAuthorizedForPairError, DmThreadNotFoundError } from './errors.js'

// ===========================================================================
// Permanent visibility strings (design C.2, C.12) — VALUES, not literals: a
// wording change is a config edit, not a code change. The visibility HEADER lives
// on the thread record (DmThreadService.DM_VISIBILITY_HEADER_TEXT); the WHO-CAN-READ
// statement (a plain-language, student-facing list of the four parties) and the
// first-open ONBOARDING screen are served from here.
// ===========================================================================

/** The plain who-can-read statement returned on every thread payload (design C.2/C.12). */
export const DM_WHO_CAN_READ_TEXT =
  'Who can read this conversation: you and your mentor, your chapter safety officer, ' +
  'and your guardian. Messages are saved permanently and cannot be deleted or edited ' +
  'by either you or your mentor.'

/**
 * The first-open onboarding screen content (design C.12), shown the first time a
 * student opens any thread. Plain language: who reads this, what happens when you
 * report, and that reporting does not get anyone in trouble by default. A CONSTANT
 * served from the backend (the report button only works if the student already
 * knows it exists and what pressing it costs).
 */
export const DM_ONBOARDING = {
  title: 'Before you start messaging',
  whoReads:
    'Who reads this: you and your mentor, your chapter safety officer, and your ' +
    'guardian. Messages are saved permanently and cannot be deleted.',
  reporting:
    'If something feels off, you can tap "Something feels off" at any time. It goes ' +
    'privately to your safety officer — your mentor is NOT told that you reported.',
  noTrouble:
    'Reporting does not get anyone in trouble by default. It just asks a trusted adult ' +
    'to take a look. You will never be in trouble for reporting.',
} as const

// ===========================================================================
// Shared payload shapes (exact field names the frontend consumes).
// ===========================================================================

export interface DmThreadListItem {
  threadId: string
  chapterId: string
  mentorMembershipId: string
  studentAccountId: string
  visibilityHeader: string
  whoCanRead: string
  lastMessageAt: string
  messageCount: number
}

export interface DmThreadDetail {
  threadId: string
  chapterId: string
  mentorMembershipId: string
  studentAccountId: string
  visibilityHeader: string
  whoCanRead: string
  messages: DmDecryptedMessage[]
}

export interface DmOnboardingView {
  content: typeof DM_ONBOARDING
  acknowledged: boolean
  acknowledgedAt: string | null
}

export interface DmReportView {
  reportId: string
  threadId: string
  reporterAccountId: string
  note: string | null
  createdAt: string
}

export interface DmChildDigest {
  childAccountId: string
  generatedAt: string
  /** The window start the counts are computed from (default: 7 days before `now`). */
  since: string
  threadCount: number
  messageCount: number
  flagCount: number
  flagsByCategory: Record<string, number>
}

// ===========================================================================
// DmParticipantService (design C.2, C.12)
// ===========================================================================

export type DmParticipantAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'dm.report' | 'dm.read_own' | 'dm.oversee',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface DmParticipantServiceDeps {
  sql: Sql
  config?: Partial<AppConfig>
  authorize: DmParticipantAuthorizeFn
}

export interface DmReportOptions {
  note?: string | null
}

export class DmParticipantService {
  private readonly sql: Sql
  private readonly config: AppConfig
  private readonly authorize: DmParticipantAuthorizeFn
  private readonly threads: DmThreadService

  constructor(deps: DmParticipantServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
    this.authorize = deps.authorize
    this.threads = new DmThreadService({ sql: deps.sql, config: deps.config })
  }

  private darkGate(): void {
    if (!this.config.mentorDmEnabled) throw new DmNotAuthorizedForPairError()
  }

  /**
   * The caller's OWN threads (design C.2): a student sees their thread(s); a mentor
   * sees the pairs they are assigned. Each item carries the permanent visibility
   * header AND the who-can-read statement. A GET read (no `authorize`; the party
   * floor is "the caller is a participant of the thread"). Dark-gated.
   */
  async listThreads(readerAccountId: string, now: Date = new Date()): Promise<{ items: DmThreadListItem[] }> {
    this.darkGate()
    void now
    const rows = await this.sql`
      select
        t.id, t.chapter_id, t.mentor_membership_id, t.student_account_id,
        t.visibility_header_text, c.last_message_at, c.message_count
      from dm_thread t
      join dm_thread_current c on c.id = t.id
      join membership m on m.id = t.mentor_membership_id
      where t.student_account_id = ${readerAccountId} or m.account_id = ${readerAccountId}
      order by c.last_message_at desc
    `
    const items: DmThreadListItem[] = rows.map((r) => ({
      threadId: r.id as string,
      chapterId: r.chapter_id as string,
      mentorMembershipId: r.mentor_membership_id as string,
      studentAccountId: r.student_account_id as string,
      visibilityHeader: r.visibility_header_text as string,
      whoCanRead: DM_WHO_CAN_READ_TEXT,
      lastMessageAt: new Date(r.last_message_at as string).toISOString(),
      messageCount: Number(r.message_count),
    }))
    return { items }
  }

  /**
   * Read one thread with its decrypted messages (design C.2), gated by the four-party
   * suspension-aware party check (a suspended guardian is excluded; participants +
   * safety officer + non-suspended guardian admitted). The payload INCLUDES the
   * permanent visibility header (C.2) and the who-can-read statement (C.12). A
   * non-party gets an opaque Forbidden. Dark-gated.
   */
  async readThread(threadId: string, readerAccountId: string, now: Date = new Date()): Promise<DmThreadDetail> {
    this.darkGate()
    const [meta] = await this.sql`
      select id, chapter_id, mentor_membership_id, student_account_id
      from dm_thread where id = ${threadId}
    `
    if (meta === undefined) throw new DmThreadNotFoundError(threadId)
    // Delegates the party check (suspension-aware), the decrypt, and the guardian
    // read-ledger entry to DmThreadService.readThread.
    const { visibilityHeader, messages } = await this.threads.readThread(threadId, readerAccountId, now)
    return {
      threadId,
      chapterId: meta.chapter_id as string,
      mentorMembershipId: meta.mentor_membership_id as string,
      studentAccountId: meta.student_account_id as string,
      visibilityHeader,
      whoCanRead: DM_WHO_CAN_READ_TEXT,
      messages,
    }
  }

  /**
   * The first-open onboarding content + whether this student has acknowledged it
   * (design C.12). A read (no `authorize`); dark-gated.
   */
  async getOnboarding(studentAccountId: string): Promise<DmOnboardingView> {
    this.darkGate()
    const [row] = await this.sql`
      select acknowledged_at from dm_onboarding_ack
      where student_account_id = ${studentAccountId}
      order by acknowledged_at asc limit 1
    `
    return {
      content: DM_ONBOARDING,
      acknowledged: row !== undefined,
      acknowledgedAt: row === undefined ? null : new Date(row.acknowledged_at as string).toISOString(),
    }
  }

  /**
   * Record the student's first-open onboarding acknowledgement (design C.12).
   * Idempotent — a second ack does not create a duplicate row (the earliest ack is
   * the record). Gated through `dm.read_own` (a participant of a DM-enabled chapter,
   * resolved from the student's active membership); dark-gated. Append-only write.
   */
  async acknowledgeOnboarding(
    ctx: AuthContext,
    now: Date = new Date(),
  ): Promise<{ acknowledged: true; acknowledgedAt: string }> {
    this.darkGate()
    const studentAccountId = ctx.account.id
    const [membership] = await this.sql`
      select chapter_id from membership
      where account_id = ${studentAccountId} and role = 'student' and status = 'active'
      limit 1
    `
    if (membership === undefined) throw new Forbidden()
    await this.authorize(ctx, 'dm.read_own', { chapter_id: membership.chapter_id as string }, { sql: this.sql })

    const [existing] = await this.sql`
      select acknowledged_at from dm_onboarding_ack
      where student_account_id = ${studentAccountId}
      order by acknowledged_at asc limit 1
    `
    if (existing !== undefined) {
      return { acknowledged: true as const, acknowledgedAt: new Date(existing.acknowledged_at as string).toISOString() }
    }
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into dm_onboarding_ack (student_account_id, acknowledged_at)
        values (${studentAccountId}, ${now})
        returning acknowledged_at
      `
      return {
        acknowledged: true as const,
        acknowledgedAt: new Date(row!.acknowledged_at as string).toISOString(),
      }
    }) as Promise<{ acknowledged: true; acknowledgedAt: string }>
  }

  /**
   * File a low-key "something feels off" report (design C.12). Routes to the SAFETY
   * OFFICER via a `dm.student_report` monitoring-ledger entry and does NOT notify the
   * mentor — the mentor has NO read path to dm_report and nothing appears on the
   * thread (no dm_message, no dm_flag), so there is no mentor-visible signal. Gated
   * through `dm.report` (a participant floor) PLUS the suspension-aware party check
   * (the reporter must be a party to the thread); a non-party gets an opaque
   * Forbidden. Dark-gated. Append-only write.
   */
  async reportThread(
    threadId: string,
    ctx: AuthContext,
    opts: DmReportOptions = {},
    now: Date = new Date(),
  ): Promise<{ reportId: string; threadId: string }> {
    this.darkGate()
    const reporterAccountId = ctx.account.id
    const [thread] = await this.sql`
      select chapter_id, student_account_id from dm_thread where id = ${threadId}
    `
    if (thread === undefined) throw new DmThreadNotFoundError(threadId)
    await this.authorize(ctx, 'dm.report', { chapter_id: thread.chapter_id as string }, { sql: this.sql })
    // The reporter must be a party to the thread (a participant, the safety officer,
    // or a non-suspended guardian) — not any student in the chapter.
    if (!(await this.threads.isPartyToThread(threadId, reporterAccountId, now))) throw new Forbidden()

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into dm_report (thread_id, reporter_account_id, note)
        values (${threadId}, ${reporterAccountId}, ${opts.note ?? null})
        returning id
      `
      // The routing IS a monitoring-ledger entry (design C.12), NOT a mentor-visible
      // signal: it surfaces to the safety officer's queue and the mentor has no read
      // capability over the ledger. subjectAccountId is the STUDENT of the thread.
      await writeAccessLedger(tx, {
        event: 'dm.student_report',
        actorAccountId: reporterAccountId,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        subjectAccountId: thread.student_account_id as string,
        chapterId: thread.chapter_id as string,
        detail: { threadId, reportId: row!.id as string },
      })
      return { reportId: row!.id as string, threadId }
    }) as Promise<{ reportId: string; threadId: string }>
  }

  /**
   * The safety officer's view of the student reports in their chapter (design C.12).
   * The report "routes to the safety officer's view": this is that view. Gated
   * through `dm.oversee` (safety-officer floor) — a non-officer / another chapter's
   * officer / the MENTOR gets an opaque Forbidden. A GET read; dark-gated.
   */
  async listReports(chapterId: string, ctx: AuthContext, now: Date = new Date()): Promise<{ items: DmReportView[] }> {
    this.darkGate()
    void now
    await this.authorize(ctx, 'dm.oversee', { chapter_id: chapterId }, { sql: this.sql })
    const rows = await this.sql`
      select r.id, r.thread_id, r.reporter_account_id, r.note, r.created_at
      from dm_report r
      join dm_thread t on t.id = r.thread_id
      where t.chapter_id = ${chapterId}
      order by r.created_at desc
    `
    const items: DmReportView[] = rows.map((r) => ({
      reportId: r.id as string,
      threadId: r.thread_id as string,
      reporterAccountId: r.reporter_account_id as string,
      note: (r.note as string | null) ?? null,
      createdAt: new Date(r.created_at as string).toISOString(),
    }))
    return { items }
  }
}

// ===========================================================================
// DmGuardianDmService (design C.10) — a verified guardian's read of their OWN
// child's threads + the weekly digest data.
// ===========================================================================

export interface DmGuardianDmServiceDeps {
  sql: Sql
  config?: Partial<AppConfig>
}

/** The weekly digest window (design C.10): counts since the last digest ~7 days. */
const DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export class DmGuardianDmService {
  private readonly sql: Sql
  private readonly config: AppConfig
  private readonly threads: DmThreadService

  constructor(deps: DmGuardianDmServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
    this.threads = new DmThreadService({ sql: deps.sql, config: deps.config })
  }

  private darkGate(): void {
    if (!this.config.mentorDmEnabled) throw new DmNotAuthorizedForPairError()
  }

  /** Confirm a verified guardianship edge (guardian -> child); else opaque Forbidden. */
  private async assertVerifiedGuardian(guardianAccountId: string, childAccountId: string): Promise<void> {
    const rows = await this.sql`
      select 1 from guardianship
      where student_account_id = ${childAccountId} and guardian_account_id = ${guardianAccountId}
        and status = 'verified' limit 1
    `
    if (rows.length === 0) throw new Forbidden()
  }

  /** The child's threads the guardian is CURRENTLY a party to (suspension-aware). */
  private async visibleThreadIds(guardianAccountId: string, childAccountId: string, now: Date): Promise<string[]> {
    const rows = await this.sql`
      select id from dm_thread where student_account_id = ${childAccountId} order by created_at asc
    `
    const visible: string[] = []
    for (const r of rows) {
      const threadId = r.id as string
      if (await this.threads.isPartyToThread(threadId, guardianAccountId, now)) visible.push(threadId)
    }
    return visible
  }

  /**
   * A verified guardian reads their OWN child's DM threads (decrypted), UNLESS an
   * ACTIVE visibility suspension excludes them (design C.10; the party check removes
   * a suspended guardian). Another child, or a lapsed/unverified edge, is an opaque
   * Forbidden. Each thread carries the visibility header + who-can-read statement.
   * Dark-gated.
   */
  async listChildThreads(
    guardianAccountId: string,
    childAccountId: string,
    now: Date = new Date(),
  ): Promise<{ items: DmThreadDetail[] }> {
    this.darkGate()
    await this.assertVerifiedGuardian(guardianAccountId, childAccountId)
    const threadIds = await this.visibleThreadIds(guardianAccountId, childAccountId, now)
    const items: DmThreadDetail[] = []
    for (const threadId of threadIds) {
      const [meta] = await this.sql`
        select chapter_id, mentor_membership_id, student_account_id
        from dm_thread where id = ${threadId}
      `
      const { visibilityHeader, messages } = await this.threads.readThread(threadId, guardianAccountId, now)
      items.push({
        threadId,
        chapterId: meta!.chapter_id as string,
        mentorMembershipId: meta!.mentor_membership_id as string,
        studentAccountId: meta!.student_account_id as string,
        visibilityHeader,
        whoCanRead: DM_WHO_CAN_READ_TEXT,
        messages,
      })
    }
    return { items }
  }

  /**
   * The weekly digest DATA for the guardian's OWN child (design C.10): the thread
   * count, the message count since the last digest, and any flags on that child's
   * threads. Aggregates ONLY the child's threads the guardian can currently see
   * (suspension-aware). Another child is an opaque Forbidden. The email itself is
   * frontend-owned (Resend); this exposes the data. Dark-gated.
   */
  async childDigest(
    guardianAccountId: string,
    childAccountId: string,
    now: Date = new Date(),
    opts: { since?: Date } = {},
  ): Promise<DmChildDigest> {
    this.darkGate()
    await this.assertVerifiedGuardian(guardianAccountId, childAccountId)
    const since = opts.since ?? new Date(now.getTime() - DIGEST_WINDOW_MS)
    const threadIds = await this.visibleThreadIds(guardianAccountId, childAccountId, now)

    let messageCount = 0
    let flagCount = 0
    const flagsByCategory: Record<string, number> = {}
    if (threadIds.length > 0) {
      // "Since the last digest": a lower bound only. The digest is generated AT `now`,
      // so an upper bound is implicit; a real-clock DB `created_at` (dm_flag) must not
      // be compared against an injected `now`, which would spuriously exclude it.
      const [mc] = await this.sql`
        select count(*) as c from dm_message
        where thread_id in ${this.sql(threadIds)} and sent_at >= ${since}
      `
      messageCount = Number(mc!.c)
      const flagRows = await this.sql`
        select category, count(*) as c from dm_flag
        where thread_id in ${this.sql(threadIds)} and created_at >= ${since}
        group by category
      `
      for (const f of flagRows) {
        const n = Number(f.c)
        flagsByCategory[f.category as string] = n
        flagCount += n
      }
    }
    return {
      childAccountId,
      generatedAt: now.toISOString(),
      since: since.toISOString(),
      threadCount: threadIds.length,
      messageCount,
      flagCount,
      flagsByCategory,
    }
  }
}
