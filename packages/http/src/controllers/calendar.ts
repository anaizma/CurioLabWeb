// -------------------------------------------------------------------------
// Shared chapter calendar controllers (guardian/director portal work order,
// Feature 1). Thin adapters over the framework-agnostic CalendarService: resolve
// the session to an AuthContext (runAuthed), then call the service, which gates
// through `authorize` and reads/writes the append-only calendar_event log.
//
//   createCalendarEvent  POST   /api/ops/calendar        (calendar.manage)
//   editCalendarEvent    PATCH  /api/ops/calendar/:id    (calendar.manage)
//   cancelCalendarEvent  DELETE /api/ops/calendar/:id    (calendar.manage)
//   listStaffCalendar    GET    /api/ops/calendar        (calendar.view; GET-exempt)
//   listGuardianCalendar GET    /api/guardian/calendar   (guardian.view_calendar; GET-exempt)
//
// The audience-filtering rules (a mentor sees mentor-audience events, a director
// all; a guardian sees the child's-chapter parent-audience events) live in the
// service. A null session is an opaque 403 (runAuthed); a cross-chapter / non-staff
// caller is an opaque 403 from the service's authorize (Forbidden).
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import {
  CalendarService,
  type CalendarEvent,
  type CancelCalendarEventResult,
  type EditCalendarEventInput,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

type QueryValue = string | string[] | null | undefined

interface ListEnvelope {
  items: CalendarEvent[]
}

function svc(sql: Sql) {
  return new CalendarService({ sql, authorize })
}

/** Parse a repeatable / CSV audience param into a string[] (the service validates). */
function parseAudiences(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x))
  if (v == null) return []
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface CreateCalendarInput extends AuthedInputBase {
  body: {
    chapterId?: unknown
    title?: unknown
    kind?: unknown
    startsAt?: unknown
    endsAt?: unknown
    audiences?: unknown
    location?: unknown
    notes?: unknown
  }
}

/** POST /api/ops/calendar — create an event (calendar.manage). */
export function createCalendarEvent(
  input: CreateCalendarInput,
): Promise<ControllerResult<CalendarEvent>> {
  return runAuthed(input, async (ctx, sql) => {
    const b = input.body
    const event = await svc(sql).createEvent(
      {
        chapterId: reqStr(b?.chapterId, 'chapterId'),
        title: reqStr(b?.title, 'title'),
        kind: reqStr(b?.kind, 'kind'),
        startsAt: reqStr(b?.startsAt, 'startsAt'),
        endsAt: reqStr(b?.endsAt, 'endsAt'),
        audiences: parseAudiences(b?.audiences),
        location: optStr(b?.location),
        notes: optStr(b?.notes),
      },
      ctx,
    )
    return { status: 201, body: event }
  })
}

export interface EditCalendarInput extends AuthedInputBase {
  params: { id?: unknown }
  body: {
    title?: unknown
    kind?: unknown
    startsAt?: unknown
    endsAt?: unknown
    audiences?: unknown
    location?: unknown
    notes?: unknown
  }
}

/** PATCH /api/ops/calendar/:id — edit an event, a new revision (calendar.manage). */
export function editCalendarEvent(input: EditCalendarInput): Promise<ControllerResult<CalendarEvent>> {
  return runAuthed(input, async (ctx, sql) => {
    const id = reqStr(input.params?.id, 'id')
    const b = input.body ?? {}
    const patch: EditCalendarEventInput = {}
    if (b.title !== undefined) patch.title = reqStr(b.title, 'title')
    if (b.kind !== undefined) patch.kind = reqStr(b.kind, 'kind')
    if (b.startsAt !== undefined) patch.startsAt = reqStr(b.startsAt, 'startsAt')
    if (b.endsAt !== undefined) patch.endsAt = reqStr(b.endsAt, 'endsAt')
    if (b.audiences !== undefined) patch.audiences = parseAudiences(b.audiences)
    if (b.location !== undefined) patch.location = optStr(b.location)
    if (b.notes !== undefined) patch.notes = optStr(b.notes)
    const event = await svc(sql).editEvent(id, patch, ctx)
    return { status: 200, body: event }
  })
}

export interface CancelCalendarInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** DELETE /api/ops/calendar/:id — cancel an event, a tombstone (calendar.manage). */
export function cancelCalendarEvent(
  input: CancelCalendarInput,
): Promise<ControllerResult<CancelCalendarEventResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const id = reqStr(input.params?.id, 'id')
    const result = await svc(sql).cancelEvent(id, ctx)
    return { status: 200, body: result }
  })
}

export interface StaffCalendarInput extends AuthedInputBase {
  query?: Record<string, QueryValue>
}

/** GET /api/ops/calendar — the staff view, audience-filtered (calendar.view). */
export function listStaffCalendar(
  input: StaffCalendarInput,
): Promise<ControllerResult<ListEnvelope>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listStaffCalendar(ctx, { chapterId: optStr(input.query?.chapterId) })
    return { status: 200, body: result }
  })
}

/** GET /api/guardian/calendar — the guardian view, parent-audience (guardian.view_calendar). */
export function listGuardianCalendar(
  input: AuthedInputBase,
): Promise<ControllerResult<ListEnvelope>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listGuardianCalendar(ctx)
    return { status: 200, body: result }
  })
}
