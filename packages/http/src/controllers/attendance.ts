// -------------------------------------------------------------------------
// Attendance & make-up check-in controllers (guardian/director portal work order,
// Feature 2). Thin adapters over the framework-agnostic AttendanceService: resolve
// the session to an AuthContext (runAuthed), then call the service, which gates
// through `authorize` and reads/writes the append-only attendance_exception log.
//
//   submitAttendance      POST /api/guardian/children/:id/attendance         (attendance.submit)
//   viewChildAttendance   GET  /api/guardian/children/:id/attendance         (attendance.view_child; GET-exempt)
//   listStaffAttendance   GET  /api/ops/attendance                           (attendance.view; GET-exempt)
//   completeMakeup        POST /api/ops/attendance/:id/makeup-complete        (attendance.resolve)
//
// A null session is an opaque 403 (runAuthed); a cross-guardian / non-staff / cross-
// chapter caller is an opaque 403 from the service's authorize (Forbidden). The
// slot-before-next-session validation + the counts live in the service.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import {
  AttendanceService,
  type AttendanceCounts,
  type AttendanceException,
  type StaffRosterItem,
  type SubmitExceptionInput,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

type QueryValue = string | string[] | null | undefined

interface ChildAttendanceEnvelope {
  items: AttendanceException[]
  counts: AttendanceCounts
}
interface StaffAttendanceEnvelope {
  items: StaffRosterItem[]
  counts: AttendanceCounts
}

function svc(sql: Sql) {
  return new AttendanceService({ sql, authorize })
}

/** Parse a repeatable / CSV make-up slots param into a string[] (the service validates). */
function parseSlots(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x))
  if (v == null) return []
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface SubmitAttendanceInput extends AuthedInputBase {
  params: { id?: unknown }
  body: {
    sessionEventId?: unknown
    type?: unknown
    reason?: unknown
    arriveAt?: unknown
    makeupConsent?: unknown
    makeupSlots?: unknown
  }
}

/** POST /api/guardian/children/:id/attendance — submit an absent/late exception. */
export function submitAttendance(
  input: SubmitAttendanceInput,
): Promise<ControllerResult<AttendanceException>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const b = input.body ?? {}
    const payload: SubmitExceptionInput = {
      sessionEventId: reqStr(b.sessionEventId, 'sessionEventId'),
      type: reqStr(b.type, 'type'),
      reason: optStr(b.reason),
      arriveAt: optStr(b.arriveAt),
      makeupConsent: b.makeupConsent === true || b.makeupConsent === 'true',
      makeupSlots: parseSlots(b.makeupSlots),
    }
    const exception = await svc(sql).submitException(childId, payload, ctx)
    return { status: 201, body: exception }
  })
}

export interface ChildAttendanceInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** GET /api/guardian/children/:id/attendance — the child's exceptions + counts. */
export function viewChildAttendance(
  input: ChildAttendanceInput,
): Promise<ControllerResult<ChildAttendanceEnvelope>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const result = await svc(sql).viewChildAttendance(childId, ctx)
    return { status: 200, body: result }
  })
}

export interface StaffAttendanceInput extends AuthedInputBase {
  query?: Record<string, QueryValue>
}

/** GET /api/ops/attendance — the staff roster (?sessionEventId= OR ?chapterId=&termId=). */
export function listStaffAttendance(
  input: StaffAttendanceInput,
): Promise<ControllerResult<StaffAttendanceEnvelope>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listStaffAttendance(ctx, {
      sessionEventId: optStr(input.query?.sessionEventId),
      chapterId: optStr(input.query?.chapterId),
      termId: optStr(input.query?.termId),
    })
    return { status: 200, body: result }
  })
}

export interface CompleteMakeupInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/ops/attendance/:id/makeup-complete — mark the make-up check-in done. */
export function completeMakeup(
  input: CompleteMakeupInput,
): Promise<ControllerResult<AttendanceException>> {
  return runAuthed(input, async (ctx, sql) => {
    const id = reqStr(input.params?.id, 'id')
    const result = await svc(sql).completeMakeup(id, ctx)
    return { status: 200, body: result }
  })
}
