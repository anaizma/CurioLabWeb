// -------------------------------------------------------------------------
// AttendanceService — attendance & make-up check-ins (guardian/director portal
// work order, Feature 2). A guardian records that their child was ABSENT or LATE
// for a chapter SESSION (a kind='session' calendar_event from Feature 1, referenced
// by its stable event_id). An ABSENT exception carries a MAKE-UP: a 30-minute
// virtual check-in the student completes after finishing that session's assignment,
// scheduled BEFORE the chapter's next session. Staff (a mentor / director) later
// mark the check-in DONE.
//
// APPEND-ONLY (a platform invariant, migration 0027): a correction / revocation or
// a make-up COMPLETION is a NEW row in the `attendance_exception` revision log,
// never a destructive mutation; nothing is deleted. An edit is a new revision
// (version bumps); a make-up completion is a new revision with makeup_status ->
// 'completed'. Reads return the CURRENT state via the `attendance_exception_current`
// projection. Every submission / completion writes an audit + access_ledger row.
//
// Authorization (registry rows):
//   - SUBMIT   (guardian):  `attendance.submit`, guardian-scoped, matched against
//     ctx.guardianOf; writes:true, so the age-18 bar applies (a guardian cannot
//     submit for an 18+ former child). Mirrors consent.grant / publication.object.
//   - VIEW_CHILD (guardian): `attendance.view_child`, guardian-scoped read; the
//     child's exceptions + counts. writes:false, no logsRead (attendance facts, not
//     the composed minor record).
//   - VIEW (staff): `attendance.view`, chapter-scoped read floor, TEACHING roles;
//     the roster for a session or a term. Display names only (minor PII floor).
//   - RESOLVE (staff): `attendance.resolve`, chapter-scoped write, TEACHING roles;
//     mark the make-up check-in done (a new append-only revision).
//
// Deterministic clock: the subject age (the guardian-write age bar) is computed
// from ctx.now (the injected request instant), never new Date(). The slots-before-
// next-session validation reads calendar instants (starts_at) from the DB, so it is
// independent of any clock.
//
// TERM RESOLUTION for the per-term counts is by DATE-RANGE CONTAINMENT against the
// `term` table (the term in the session's chapter whose [starts_on, ends_on]
// contains the session's starts_at) — NOT the student's enrollment term. Rationale:
// an exception references a SESSION whose starts_at is a precise instant, and term
// is a date range in that session's chapter, so containment is a direct, total
// function that does not depend on the student having a current enrollment row for
// that term (a student may have none, or several).
//
// Framework-agnostic: the db handle and `authorize` are injected; the thin Next
// adapters + controllers live in packages/http.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, writeAudit, writeAccessLedger, type AuthorizeDeps } from '@curiolab/runtime'
import {
  AttendanceExceptionNotFoundError,
  AttendanceMakeupNotApplicableError,
  AttendanceValidationError,
} from './errors.js'

type Db = Sql | TransactionSql

/** The four capabilities this service gates on (submit / child-read / staff-read / resolve). */
export type AttendanceCapability =
  | 'attendance.submit'
  | 'attendance.view_child'
  | 'attendance.view'
  | 'attendance.resolve'

/** The injected `authorize` dependency, narrowed to this service's capabilities. */
export type AttendanceAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: AttendanceCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface AttendanceServiceDeps {
  sql: Sql
  authorize: AttendanceAuthorizeFn
}

export type AttendanceExceptionType = 'absent' | 'late'
export type MakeupStatus = 'pending' | 'scheduled' | 'completed'

/** The exception object returned by every surface (timestamps ISO-8601 UTC). */
export interface AttendanceException {
  /** The STABLE exception identity (what make-up-complete targets), not the revision id. */
  id: string
  studentAccountId: string
  sessionEventId: string
  type: AttendanceExceptionType
  reason: string | null
  arriveAt: string | null
  makeupConsent: boolean
  makeupSlots: string[]
  makeupStatus: MakeupStatus | null
  createdByGuardianAccountId: string
  createdAt: string
}

/** A staff-roster item: the exception plus the student's display name (minor PII floor). */
export interface StaffRosterItem extends AttendanceException {
  displayName: string
}

/** The per-student-per-term absence counts envelope. */
export interface AttendanceCounts {
  totalAbsences: number
  outstanding: number
  madeUp: number
  late: number
}

export interface SubmitExceptionInput {
  sessionEventId: string
  type: string
  reason?: string | null
  /** Late only (ISO-8601 or a Date). */
  arriveAt?: string | Date | null
  /** Absent only; must be true for an absence. */
  makeupConsent?: boolean
  /** Absent only; the proposed 30-minute check-in times (ISO-8601 or Dates). */
  makeupSlots?: (string | Date)[]
}

export interface AttendanceListQuery {
  sessionEventId?: string | null
  chapterId?: string | null
  termId?: string | null
}

const TYPES: readonly AttendanceExceptionType[] = ['absent', 'late']

// ---- helpers ---------------------------------------------------------------

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v)
}

/** Whole years from `dob` to `at` (birthday-aware, UTC). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

/** Map an attendance_exception / _current row to the API exception shape. */
function toException(r: Record<string, unknown>): AttendanceException {
  const slots = (r.makeup_slots as (string | Date)[] | null) ?? []
  return {
    id: r.exception_id as string,
    studentAccountId: r.student_account_id as string,
    sessionEventId: r.session_event_id as string,
    type: r.type as AttendanceExceptionType,
    reason: (r.reason as string | null) ?? null,
    arriveAt: r.arrive_at == null ? null : iso(r.arrive_at),
    makeupConsent: Boolean(r.makeup_consent),
    makeupSlots: slots.map((s) => iso(s)),
    makeupStatus: (r.makeup_status as MakeupStatus | null) ?? null,
    createdByGuardianAccountId: r.created_by_guardian_account_id as string,
    createdAt: iso(r.created_at),
  }
}

/** The absence counts over a set of current exceptions. */
function computeCounts(items: readonly { type: AttendanceExceptionType; makeupStatus: MakeupStatus | null }[]): AttendanceCounts {
  let totalAbsences = 0
  let madeUp = 0
  let late = 0
  for (const it of items) {
    if (it.type === 'late') {
      late += 1
      continue
    }
    totalAbsences += 1
    if (it.makeupStatus === 'completed') madeUp += 1
  }
  return { totalAbsences, outstanding: totalAbsences - madeUp, madeUp, late }
}

interface ChildSubject {
  age: number
  chapterId: string | null
}

// ---------------------------------------------------------------------------

export class AttendanceService {
  private readonly sql: Sql
  private readonly authorize: AttendanceAuthorizeFn

  constructor(deps: AttendanceServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Load the child subject facts `can` needs for the guardian scope: the age (the
   * guardian-write age bar, from ctx.now) and the child's active chapter (the scope
   * chapter + the "session must be in the child's chapter" check). Loaded BEFORE
   * `authorize`, like ConsentService.loadAnchor.
   */
  private async loadChild(childId: string, now: number): Promise<ChildSubject> {
    const [row] = await this.sql`
      select
        a.date_of_birth as dob,
        (
          select m.chapter_id from membership m
          where m.account_id = a.id and m.status = 'active'
          order by m.created_at desc limit 1
        ) as chapter_id
      from account a
      where a.id = ${childId}
    `
    return {
      age: row?.dob != null ? ageInYears(new Date(row.dob as string), new Date(now)) : 0,
      chapterId: (row?.chapter_id as string | null) ?? null,
    }
  }

  /** Resolve a calendar session (by event_id) in a specific chapter (active, kind='session'). */
  private async loadSessionInChapter(
    sessionEventId: string,
    chapterId: string,
  ): Promise<{ startsAt: Date } | null> {
    const [row] = await this.sql`
      select starts_at from calendar_event_current
      where event_id = ${sessionEventId} and status = 'active'
        and kind = 'session' and chapter_id = ${chapterId}
    `
    if (row === undefined) return null
    return { startsAt: new Date(row.starts_at as string | Date) }
  }

  /** Resolve any calendar event's chapter (the staff-side authorization scope). */
  private async loadEventChapter(sessionEventId: string): Promise<string | null> {
    const [row] = await this.sql`
      select chapter_id from calendar_event_current where event_id = ${sessionEventId}
    `
    return (row?.chapter_id as string | null) ?? null
  }

  /**
   * Validate every make-up slot server-side: each must be strictly AFTER the missed
   * session's starts_at AND strictly BEFORE the chapter's next kind='session' event.
   * If there is no next session (last of the term), fall back to requiring each slot
   * to be on/before the term's ends_on (the term whose date range contains the
   * missed session's starts_at). Throws AttendanceValidationError('slots') on the
   * first offender.
   */
  private async validateSlots(
    slots: Date[],
    missedStartsAt: Date,
    chapterId: string,
  ): Promise<void> {
    // The chapter's next session strictly after the missed one.
    const [next] = await this.sql`
      select starts_at from calendar_event_current
      where status = 'active' and kind = 'session' and chapter_id = ${chapterId}
        and starts_at > ${missedStartsAt}
      order by starts_at asc limit 1
    `
    const nextStartsAt = next ? new Date(next.starts_at as string | Date) : null

    // Fallback upper bound: the end of the term containing the missed session.
    let termEndBound: Date | null = null
    if (nextStartsAt === null) {
      const [term] = await this.sql`
        select ends_on from term
        where chapter_id = ${chapterId}
          and ${missedStartsAt}::date between starts_on and ends_on
        order by ends_on desc limit 1
      `
      if (term) {
        // `ends_on` is a `date` (may arrive as a string or a Date); take its
        // YYYY-MM-DD and bound to the end of that day (UTC) — inclusive of ends_on.
        const raw = term.ends_on
        const day =
          raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10)
        termEndBound = new Date(`${day}T23:59:59.999Z`)
      }
    }

    for (const slot of slots) {
      if (Number.isNaN(slot.getTime())) {
        throw new AttendanceValidationError('slots', 'a make-up slot is not a valid timestamp')
      }
      // Must be strictly after the missed session (cannot make up before missing).
      if (slot.getTime() <= missedStartsAt.getTime()) {
        throw new AttendanceValidationError('slots', 'a make-up slot must be after the missed session')
      }
      if (nextStartsAt !== null) {
        // Must be strictly before the chapter's next session.
        if (slot.getTime() >= nextStartsAt.getTime()) {
          throw new AttendanceValidationError('slots', 'a make-up slot must be before the next session')
        }
      } else if (termEndBound !== null) {
        // No next session: must be on/before the term end.
        if (slot.getTime() > termEndBound.getTime()) {
          throw new AttendanceValidationError('slots', 'a make-up slot must be before the term end')
        }
      }
    }
  }

  /** Append one revision row and its audit + access-ledger provenance. */
  private async writeRevision(
    tx: Db,
    ctx: AuthContext,
    args: {
      exceptionId: string
      studentAccountId: string
      sessionEventId: string
      version: number
      type: AttendanceExceptionType
      reason: string | null
      arriveAt: Date | null
      makeupConsent: boolean
      makeupSlots: Date[]
      makeupStatus: MakeupStatus | null
      chapterId: string | null
      ledgerEvent: 'attendance.exception_submitted' | 'attendance.makeup_completed'
      auditAction: string
      detail: Record<string, unknown>
    },
  ): Promise<Record<string, unknown>> {
    // Serialize slots as ISO strings so the timestamptz[] literal binds cleanly.
    const slotStrings = args.makeupSlots.map((d) => d.toISOString())
    const [row] = await tx`
      insert into attendance_exception (
        exception_id, student_account_id, session_event_id, version, type, reason,
        arrive_at, makeup_consent, makeup_slots, makeup_status,
        created_by_guardian_account_id
      ) values (
        ${args.exceptionId}, ${args.studentAccountId}, ${args.sessionEventId}, ${args.version},
        ${args.type}, ${args.reason}, ${args.arriveAt}, ${args.makeupConsent},
        ${slotStrings}::timestamptz[], ${args.makeupStatus}, ${ctx.account.id}
      )
      returning exception_id, student_account_id, session_event_id, version, type, reason,
                arrive_at, makeup_consent, makeup_slots, makeup_status,
                created_by_guardian_account_id, created_at
    `
    const realActor = ctx.session.impersonation?.real_actor_account_id ?? null
    await writeAudit(tx, {
      action: args.auditAction,
      subjectType: 'attendance_exception',
      subjectId: args.exceptionId,
      actorAccountId: ctx.account.id,
      realActorAccountId: realActor,
      chapterId: args.chapterId,
      detail: args.detail,
    })
    await writeAccessLedger(tx, {
      event: args.ledgerEvent,
      actorAccountId: ctx.account.id,
      realActorAccountId: realActor,
      subjectAccountId: args.studentAccountId,
      chapterId: args.chapterId,
      detail: args.detail,
    })
    return row!
  }

  /**
   * POST /guardian/children/:id/attendance — submit an absent/late exception for the
   * guardian's own verified child (`attendance.submit`, guardian-scoped). Validates
   * the type + session (in the child's chapter) + make-up rules BEFORE authorizing a
   * well-formed body's scope (a malformed body is a 400 for anyone; a well-formed
   * cross-guardian body is a 403). The session-in-child's-chapter check is done both
   * before and after authorize: the resource carries the child's chapter for the
   * scope, and the session is resolved within that chapter.
   */
  async submitException(
    studentAccountId: string,
    input: SubmitExceptionInput,
    ctx: AuthContext,
  ): Promise<AttendanceException> {
    const type = input.type as AttendanceExceptionType
    if (!TYPES.includes(type)) {
      throw new AttendanceValidationError('type', `unknown attendance exception type: ${input.type}`)
    }

    const subject = await this.loadChild(studentAccountId, ctx.now)
    const resource: Resource = {
      subjectAccountId: studentAccountId,
      subjectAge: subject.age,
      subjectIsMinor: subject.age < 18,
      chapter_id: subject.chapterId,
    }
    await this.authorize(ctx, 'attendance.submit', resource, { sql: this.sql })

    // The session must resolve to an active kind='session' event in the CHILD's
    // chapter (one opaque signal for nonexistent / canceled / non-session / another
    // chapter — no leak of which).
    if (subject.chapterId === null) {
      throw new AttendanceValidationError('session', 'the child has no active chapter')
    }
    const session = await this.loadSessionInChapter(input.sessionEventId, subject.chapterId)
    if (session === null) {
      throw new AttendanceValidationError('session', 'no such active session in the child’s chapter')
    }

    let reason: string | null
    let arriveAt: Date | null
    let makeupConsent: boolean
    let makeupSlots: Date[]
    let makeupStatus: MakeupStatus | null

    if (type === 'late') {
      if (input.arriveAt == null) {
        throw new AttendanceValidationError('arrive_at', 'a late exception requires arriveAt')
      }
      arriveAt = toDate(input.arriveAt)
      if (Number.isNaN(arriveAt.getTime())) {
        throw new AttendanceValidationError('arrive_at', 'arriveAt is not a valid timestamp')
      }
      reason = input.reason ?? null
      makeupConsent = false
      makeupSlots = []
      makeupStatus = null
    } else {
      // absent
      if (input.makeupConsent !== true) {
        throw new AttendanceValidationError('consent', 'an absent exception requires makeup_consent = true')
      }
      const rawSlots = input.makeupSlots ?? []
      if (rawSlots.length === 0) {
        throw new AttendanceValidationError('slots', 'an absent exception requires at least one make-up slot')
      }
      makeupSlots = rawSlots.map(toDate)
      await this.validateSlots(makeupSlots, session.startsAt, subject.chapterId)
      reason = input.reason ?? null
      arriveAt = null
      makeupConsent = true
      makeupStatus = 'scheduled'
    }

    const exceptionId = randomUUID()
    const chapterId = subject.chapterId
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const row = await this.writeRevision(tx, ctx, {
        exceptionId,
        studentAccountId,
        sessionEventId: input.sessionEventId,
        version: 1,
        type,
        reason,
        arriveAt,
        makeupConsent,
        makeupSlots,
        makeupStatus,
        chapterId,
        ledgerEvent: 'attendance.exception_submitted',
        auditAction: 'attendance.exception_submitted',
        detail: { exceptionId, sessionEventId: input.sessionEventId, type, makeupStatus },
      })
      return toException(row)
    }) as Promise<AttendanceException>
  }

  /**
   * GET /guardian/children/:id/attendance — the child's exceptions + counts
   * (`attendance.view_child`, guardian-scoped read). The counts aggregate the
   * child's current exceptions across all terms; per-term counts are the staff
   * roster's termId path.
   */
  async viewChildAttendance(
    studentAccountId: string,
    ctx: AuthContext,
  ): Promise<{ items: AttendanceException[]; counts: AttendanceCounts }> {
    const subject = await this.loadChild(studentAccountId, ctx.now)
    const resource: Resource = {
      subjectAccountId: studentAccountId,
      subjectAge: subject.age,
      subjectIsMinor: subject.age < 18,
      chapter_id: subject.chapterId,
    }
    await this.authorize(ctx, 'attendance.view_child', resource, { sql: this.sql })

    const rows = await this.sql`
      select exception_id, student_account_id, session_event_id, type, reason, arrive_at,
             makeup_consent, makeup_slots, makeup_status,
             created_by_guardian_account_id, created_at
      from attendance_exception_current
      where student_account_id = ${studentAccountId}
      order by created_at desc
    `
    const items = rows.map(toException)
    return { items, counts: computeCounts(items) }
  }

  /**
   * GET /ops/attendance — the staff roster (`attendance.view`, chapter-scoped read).
   * Two modes: `?sessionEventId=` (who missed that one session) OR `?chapterId=&termId=`
   * (the chapter's exceptions for a term, by date-range containment). A caller not
   * staff of the resolved chapter denies out_of_scope -> Forbidden. Display names
   * only (minor PII floor).
   */
  async listStaffAttendance(
    ctx: AuthContext,
    query: AttendanceListQuery = {},
  ): Promise<{ items: StaffRosterItem[]; counts: AttendanceCounts }> {
    const sql = this.sql
    const sessionEventId = query.sessionEventId
    const chapterId = query.chapterId

    let rows: Record<string, unknown>[]
    if (sessionEventId != null && sessionEventId !== '') {
      // Resolve the session's chapter, authorize against it, then read that session's
      // exceptions.
      const chapter = await this.loadEventChapter(sessionEventId)
      // Authorize against the resolved chapter (a null chapter still denies via the
      // subject-less resource — only the platform override could pass, and there is
      // nothing to read).
      await this.authorize(ctx, 'attendance.view', { chapter_id: chapter }, { sql })
      rows = await sql`
        select ae.exception_id, ae.student_account_id, ae.session_event_id, ae.type, ae.reason,
               ae.arrive_at, ae.makeup_consent, ae.makeup_slots, ae.makeup_status,
               ae.created_by_guardian_account_id, ae.created_at, ac.display_name
        from attendance_exception_current ae
        join account ac on ac.id = ae.student_account_id
        where ae.session_event_id = ${sessionEventId}
        order by ae.created_at desc
      `
    } else if (chapterId != null && chapterId !== '') {
      await this.authorize(ctx, 'attendance.view', { chapter_id: chapterId }, { sql })
      const termId = query.termId
      rows = await sql`
        select ae.exception_id, ae.student_account_id, ae.session_event_id, ae.type, ae.reason,
               ae.arrive_at, ae.makeup_consent, ae.makeup_slots, ae.makeup_status,
               ae.created_by_guardian_account_id, ae.created_at, ac.display_name
        from attendance_exception_current ae
        join account ac on ac.id = ae.student_account_id
        join calendar_event_current ce
          on ce.event_id = ae.session_event_id and ce.kind = 'session'
        ${
          termId != null && termId !== ''
            ? sql`join term t on t.id = ${termId}
                  where ce.chapter_id = ${chapterId}
                    and ce.starts_at::date between t.starts_on and t.ends_on`
            : sql`where ce.chapter_id = ${chapterId}`
        }
        order by ae.created_at desc
      `
    } else {
      // Neither filter: only the platform override could pass; there is nothing to
      // scope, so authorize against a chapterless resource (denies for a chapter actor).
      await this.authorize(ctx, 'attendance.view', {}, { sql })
      rows = await sql`
        select ae.exception_id, ae.student_account_id, ae.session_event_id, ae.type, ae.reason,
               ae.arrive_at, ae.makeup_consent, ae.makeup_slots, ae.makeup_status,
               ae.created_by_guardian_account_id, ae.created_at, ac.display_name
        from attendance_exception_current ae
        join account ac on ac.id = ae.student_account_id
        order by ae.created_at desc
      `
    }

    const items: StaffRosterItem[] = rows.map((r) => ({
      ...toException(r),
      displayName: r.display_name as string,
    }))
    return { items, counts: computeCounts(items) }
  }

  /**
   * POST /ops/attendance/:id/makeup-complete — a mentor/director marks the 30-minute
   * check-in DONE (`attendance.resolve`, chapter-scoped write). Loads the current
   * exception to resolve its session's chapter (the authorization scope), then writes
   * a NEW revision with makeup_status -> 'completed' (append-only; the prior row is
   * retained). Idempotent: an already-completed exception writes no new row. A late
   * exception has no make-up and is refused.
   */
  async completeMakeup(exceptionId: string, ctx: AuthContext): Promise<AttendanceException> {
    const [cur] = await this.sql`
      select exception_id, student_account_id, session_event_id, type, reason, arrive_at,
             makeup_consent, makeup_slots, makeup_status, version,
             created_by_guardian_account_id, created_at
      from attendance_exception_current where exception_id = ${exceptionId}
    `
    if (cur === undefined) throw new AttendanceExceptionNotFoundError(exceptionId)

    const chapterId = await this.loadEventChapter(cur.session_event_id as string)
    const resource: Resource = { id: exceptionId, chapter_id: chapterId }
    await this.authorize(ctx, 'attendance.resolve', resource, { sql: this.sql })

    if ((cur.type as string) === 'late') {
      throw new AttendanceMakeupNotApplicableError(exceptionId)
    }
    // Idempotent: already completed -> no new row.
    if ((cur.makeup_status as string | null) === 'completed') {
      return toException(cur)
    }

    const version = Number(cur.version) + 1
    const slots = ((cur.makeup_slots as (string | Date)[] | null) ?? []).map(toDate)
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const row = await this.writeRevision(tx, ctx, {
        exceptionId,
        studentAccountId: cur.student_account_id as string,
        sessionEventId: cur.session_event_id as string,
        version,
        type: 'absent',
        reason: (cur.reason as string | null) ?? null,
        arriveAt: null,
        makeupConsent: Boolean(cur.makeup_consent),
        makeupSlots: slots,
        makeupStatus: 'completed',
        chapterId,
        ledgerEvent: 'attendance.makeup_completed',
        auditAction: 'attendance.makeup_completed',
        detail: {
          exceptionId,
          sessionEventId: cur.session_event_id as string,
          version,
          makeupStatus: 'completed',
        },
      })
      return toException(row)
    }) as Promise<AttendanceException>
  }
}
