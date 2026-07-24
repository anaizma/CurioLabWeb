// -------------------------------------------------------------------------
// CalendarService — the shared, audience-scoped chapter calendar (guardian/
// director portal work order, Feature 1). A Chapter Director authors a chapter's
// calendar of sessions, orientations, meetings, and other events; each carries a
// set of AUDIENCES (parent | mentor | director) that scopes who may READ it, and
// precise timestamps (a kind='session' event is the source of truth for
// attendance — Feature 2 reads the real starts_at/ends_at).
//
// APPEND-ONLY (a platform invariant): calendar edits and cancels are NEW rows in
// the `calendar_event` revision log (migration 0026), never destructive mutations,
// and nothing is hard-deleted. An EDIT is a new active revision (version bumps); a
// CANCEL is a new `canceled` tombstone. Reads return the CURRENT non-canceled state
// via the `calendar_event_current` projection view. Every create/edit/cancel writes
// an audit + access_ledger row INCLUDING the audience set.
//
// Authorization (03-authorization.md + the new registry rows):
//   - WRITE  (create/edit/cancel): `calendar.manage`, chapter-scoped, chapter_director
//     (platform_admin via the override). A cross-chapter director denies out_of_scope
//     -> Forbidden.
//   - STAFF READ: `calendar.view`, chapter-scoped, TEACHING role FLOOR. `can` gates
//     the floor; THIS service refines by AUDIENCE — a non-director teaching member (a
//     mentor) sees only mentor-audience events, a director (or a platform reader)
//     sees every audience. A caller not staff of the requested chapter is Forbidden.
//   - GUARDIAN READ: `guardian.view_calendar`, guardian-scoped, matched against
//     ctx.guardianOf. Returns the child's-chapter parent-audience active events,
//     unioned across a guardian's children (each event tagged with its chapterId).
//
// Framework-agnostic: the db handle and `authorize` are injected; the thin Next
// adapters + controllers live in packages/http.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource, Role } from '@curiolab/core'
import { assertAuthorized, writeAudit, writeAccessLedger, type AuthorizeDeps } from '@curiolab/runtime'
import { CalendarEventNotFoundError, CalendarValidationError } from './errors.js'

type Db = Sql | TransactionSql

/** The two capabilities this service gates on (write + staff read + guardian read). */
export type CalendarCapability = 'calendar.manage' | 'calendar.view' | 'guardian.view_calendar'

/**
 * The injected `authorize` dependency, narrowed to this service's capabilities
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type CalendarAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: CalendarCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface CalendarServiceDeps {
  sql: Sql
  authorize: CalendarAuthorizeFn
}

export type CalendarEventKind = 'session' | 'orientation' | 'meeting' | 'other'
export type CalendarAudience = 'parent' | 'mentor' | 'director'

/** The event object shape returned by every surface (timestamps ISO-8601 UTC). */
export interface CalendarEvent {
  /** The STABLE event identity (what PATCH/DELETE target), not the revision id. */
  id: string
  chapterId: string
  title: string
  kind: CalendarEventKind
  startsAt: string
  endsAt: string
  audiences: CalendarAudience[]
  location: string | null
  notes: string | null
  createdByAccountId: string | null
  createdAt: string
}

export interface CreateCalendarEventInput {
  chapterId: string
  title: string
  kind: string
  /** ISO-8601 (or a Date); Feature 2's attendance reads these precise instants. */
  startsAt: string | Date
  endsAt: string | Date
  audiences: string[]
  location?: string | null
  notes?: string | null
}

/** A partial edit; an omitted field keeps the current revision's value. */
export interface EditCalendarEventInput {
  title?: string
  kind?: string
  startsAt?: string | Date
  endsAt?: string | Date
  audiences?: string[]
  location?: string | null
  notes?: string | null
}

export interface CancelCalendarEventResult {
  id: string
  status: 'canceled'
  version: number
}

export interface CalendarListQuery {
  chapterId?: string | null
}

const KINDS: readonly CalendarEventKind[] = ['session', 'orientation', 'meeting', 'other']
const AUDIENCES: readonly CalendarAudience[] = ['parent', 'mentor', 'director']
const TEACHING_ROLES: readonly Role[] = [
  'junior_mentor',
  'senior_instructor',
  'lead_instructor',
  'chapter_director',
]

// ---- validation ------------------------------------------------------------

function validateKind(kind: string): CalendarEventKind {
  if (!KINDS.includes(kind as CalendarEventKind)) {
    throw new CalendarValidationError('kind', `unknown calendar event kind: ${kind}`)
  }
  return kind as CalendarEventKind
}

/** A non-empty, deduped, valid subset of the three audiences (order preserved). */
function validateAudiences(input: readonly string[] | undefined): CalendarAudience[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new CalendarValidationError('audiences', 'audiences must be a non-empty set')
  }
  const seen = new Set<string>()
  const out: CalendarAudience[] = []
  for (const a of input) {
    if (!AUDIENCES.includes(a as CalendarAudience)) {
      throw new CalendarValidationError('audiences', `unknown audience: ${a}`)
    }
    if (!seen.has(a)) {
      seen.add(a)
      out.push(a as CalendarAudience)
    }
  }
  return out
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v)
}

function validateTimeRange(startsAt: Date, endsAt: Date): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new CalendarValidationError('time_range', 'startsAt / endsAt must be valid timestamps')
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new CalendarValidationError('time_range', 'endsAt must be strictly after startsAt')
  }
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()
}

/** Map a calendar_event / calendar_event_current row to the API event shape. */
function toEvent(r: Record<string, unknown>): CalendarEvent {
  return {
    id: r.event_id as string,
    chapterId: r.chapter_id as string,
    title: r.title as string,
    kind: r.kind as CalendarEventKind,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    audiences: (r.audiences as CalendarAudience[]) ?? [],
    location: (r.location as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdByAccountId: (r.created_by_account_id as string | null) ?? null,
    createdAt: iso(r.created_at),
  }
}

// ---- role/scope helpers (the audience refinement layered on calendar.view) --

/** In-force chapters where the actor holds one of `roles`. */
function chaptersForRoles(ctx: AuthContext, roles: readonly Role[]): string[] {
  const out = new Set<string>()
  for (const m of ctx.memberships) {
    if (!roles.includes(m.role) || m.status !== 'active') continue
    if (m.active_from !== null && m.active_from > ctx.now) continue
    if (m.active_until !== null && ctx.now >= m.active_until) continue
    out.add(m.chapter_id)
  }
  return [...out]
}

/** A platform reader (admin/staff) sees every audience, like a director. */
function isPlatformReader(ctx: AuthContext): boolean {
  return ctx.memberships.some(
    (m) => m.role === 'platform_admin' || m.role === 'platform_staff',
  )
}

interface CurrentRevision {
  chapterId: string
  version: number
  status: string
  title: string
  kind: CalendarEventKind
  startsAt: Date
  endsAt: Date
  audiences: CalendarAudience[]
  location: string | null
  notes: string | null
}

// ---------------------------------------------------------------------------

export class CalendarService {
  private readonly sql: Sql
  private readonly authorize: CalendarAuthorizeFn

  constructor(deps: CalendarServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /** Load the current-state revision for an event (the edit/cancel anchor). */
  private async loadCurrent(eventId: string): Promise<CurrentRevision | null> {
    const [row] = await this.sql`
      select chapter_id, version, status, title, kind, starts_at, ends_at,
             audiences, location, notes
      from calendar_event_current where event_id = ${eventId}
    `
    if (row === undefined) return null
    return {
      chapterId: row.chapter_id as string,
      version: Number(row.version),
      status: row.status as string,
      title: row.title as string,
      kind: row.kind as CalendarEventKind,
      startsAt: new Date(row.starts_at as string | Date),
      endsAt: new Date(row.ends_at as string | Date),
      audiences: row.audiences as CalendarAudience[],
      location: (row.location as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
    }
  }

  /** Append one revision row and its audit + access-ledger provenance. */
  private async writeRevision(
    tx: Db,
    ctx: AuthContext,
    args: {
      eventId: string
      chapterId: string
      version: number
      status: 'active' | 'canceled'
      title: string
      kind: CalendarEventKind
      startsAt: Date
      endsAt: Date
      audiences: CalendarAudience[]
      location: string | null
      notes: string | null
      ledgerEvent: 'calendar.created' | 'calendar.edited' | 'calendar.canceled'
      auditAction: string
      detail: Record<string, unknown>
    },
  ): Promise<Record<string, unknown>> {
    const [row] = await tx`
      insert into calendar_event (
        event_id, chapter_id, version, status, title, kind, starts_at, ends_at,
        audiences, location, notes, created_by_account_id
      ) values (
        ${args.eventId}, ${args.chapterId}, ${args.version}, ${args.status},
        ${args.title}, ${args.kind}, ${args.startsAt}, ${args.endsAt},
        ${args.audiences}::calendar_audience[], ${args.location}, ${args.notes}, ${ctx.account.id}
      )
      returning event_id, chapter_id, version, status, title, kind, starts_at, ends_at,
                audiences, location, notes, created_by_account_id, created_at
    `
    const realActor = ctx.session.impersonation?.real_actor_account_id ?? null
    await writeAudit(tx, {
      action: args.auditAction,
      subjectType: 'calendar_event',
      subjectId: args.eventId,
      actorAccountId: ctx.account.id,
      realActorAccountId: realActor,
      chapterId: args.chapterId,
      detail: args.detail,
    })
    await writeAccessLedger(tx, {
      event: args.ledgerEvent,
      actorAccountId: ctx.account.id,
      realActorAccountId: realActor,
      chapterId: args.chapterId,
      detail: args.detail,
    })
    return row!
  }

  /**
   * Create an event in a chapter (`calendar.manage`, chapter-scoped to chapterId).
   * A director may create only in THEIR chapter; a platform_admin in any. Validates
   * the time range + audiences BEFORE authorizing (a malformed body is a 400 for
   * anyone; a well-formed cross-chapter body is a 403).
   */
  async createEvent(input: CreateCalendarEventInput, ctx: AuthContext): Promise<CalendarEvent> {
    const kind = validateKind(input.kind)
    const audiences = validateAudiences(input.audiences)
    const startsAt = toDate(input.startsAt)
    const endsAt = toDate(input.endsAt)
    validateTimeRange(startsAt, endsAt)

    const resource: Resource = { chapter_id: input.chapterId }
    await this.authorize(ctx, 'calendar.manage', resource, { sql: this.sql })

    const eventId = randomUUID()
    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const row = await this.writeRevision(tx, ctx, {
        eventId,
        chapterId: input.chapterId,
        version: 1,
        status: 'active',
        title: input.title,
        kind,
        startsAt,
        endsAt,
        audiences,
        location: input.location ?? null,
        notes: input.notes ?? null,
        ledgerEvent: 'calendar.created',
        auditAction: 'calendar.created',
        detail: { eventId, audiences },
      })
      return toEvent(row)
    }) as Promise<CalendarEvent>
  }

  /**
   * Edit an event (`calendar.manage`). Loads the current revision to resolve the
   * event's chapter (the authorization scope) — a missing event is a typed
   * not-found. Writes a NEW active revision (version + 1) with the merged fields;
   * the prior revision is retained (append-only).
   */
  async editEvent(
    eventId: string,
    patch: EditCalendarEventInput,
    ctx: AuthContext,
  ): Promise<CalendarEvent> {
    const cur = await this.loadCurrent(eventId)
    if (cur === null) throw new CalendarEventNotFoundError(eventId)

    const resource: Resource = { id: eventId, chapter_id: cur.chapterId }
    await this.authorize(ctx, 'calendar.manage', resource, { sql: this.sql })

    const kind = patch.kind !== undefined ? validateKind(patch.kind) : cur.kind
    const audiences =
      patch.audiences !== undefined ? validateAudiences(patch.audiences) : cur.audiences
    const startsAt = patch.startsAt !== undefined ? toDate(patch.startsAt) : cur.startsAt
    const endsAt = patch.endsAt !== undefined ? toDate(patch.endsAt) : cur.endsAt
    validateTimeRange(startsAt, endsAt)
    const version = cur.version + 1

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const row = await this.writeRevision(tx, ctx, {
        eventId,
        chapterId: cur.chapterId,
        version,
        status: 'active',
        title: patch.title ?? cur.title,
        kind,
        startsAt,
        endsAt,
        audiences,
        location: patch.location !== undefined ? patch.location : cur.location,
        notes: patch.notes !== undefined ? patch.notes : cur.notes,
        ledgerEvent: 'calendar.edited',
        auditAction: 'calendar.edited',
        detail: { eventId, priorAudiences: cur.audiences, audiences, version },
      })
      return toEvent(row)
    }) as Promise<CalendarEvent>
  }

  /**
   * Cancel an event (`calendar.manage`). Writes a `canceled` tombstone revision
   * (version + 1) carrying the current fields — never a row delete. The event then
   * drops out of reads (which filter status='active'); the row + the tombstone both
   * remain.
   */
  async cancelEvent(eventId: string, ctx: AuthContext): Promise<CancelCalendarEventResult> {
    const cur = await this.loadCurrent(eventId)
    if (cur === null) throw new CalendarEventNotFoundError(eventId)

    const resource: Resource = { id: eventId, chapter_id: cur.chapterId }
    await this.authorize(ctx, 'calendar.manage', resource, { sql: this.sql })

    const version = cur.version + 1
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      await this.writeRevision(tx, ctx, {
        eventId,
        chapterId: cur.chapterId,
        version,
        status: 'canceled',
        title: cur.title,
        kind: cur.kind,
        startsAt: cur.startsAt,
        endsAt: cur.endsAt,
        audiences: cur.audiences,
        location: cur.location,
        notes: cur.notes,
        ledgerEvent: 'calendar.canceled',
        auditAction: 'calendar.canceled',
        detail: { eventId, audiences: cur.audiences, version },
      })
      return { id: eventId, status: 'canceled' as const, version }
    }) as Promise<CancelCalendarEventResult>
  }

  /**
   * GET /ops/calendar — the staff view, chapter-scoped (`calendar.view`). Resolves
   * the target chapter(s): an explicit `chapterId` (a cross-chapter caller denies
   * out_of_scope -> Forbidden), else the caller's in-force teaching chapters, else
   * (a platform reader) all chapters. AUDIENCE refinement: a director of a chapter
   * (or a platform reader) sees EVERY audience; a non-director teaching member (a
   * mentor) sees only mentor-audience events. Only non-canceled events are returned.
   */
  async listStaffCalendar(
    ctx: AuthContext,
    query: CalendarListQuery = {},
  ): Promise<{ items: CalendarEvent[] }> {
    const requested = query.chapterId
    const sql = this.sql

    let chapters: string[] | null
    if (requested != null && requested !== '') {
      await this.authorize(ctx, 'calendar.view', { chapter_id: requested }, { sql })
      chapters = [requested]
    } else {
      const teaching = chaptersForRoles(ctx, TEACHING_ROLES)
      if (teaching.length > 0) {
        await this.authorize(ctx, 'calendar.view', { chapter_id: teaching[0]! }, { sql })
        chapters = teaching
      } else {
        // No teaching chapter and no filter: only the platform override passes.
        await this.authorize(ctx, 'calendar.view', {}, { sql })
        chapters = null
      }
    }

    const seesAll = isPlatformReader(ctx)
    const directorCh = chaptersForRoles(ctx, ['chapter_director'])

    const rows = await sql`
      select event_id, chapter_id, title, kind, starts_at, ends_at, audiences,
             location, notes, created_by_account_id, created_at
      from calendar_event_current
      where status = 'active'
        and ${chapters === null ? sql`true` : sql`chapter_id in ${sql(chapters)}`}
        and ${
          seesAll
            ? sql`true`
            : directorCh.length > 0
              ? sql`(chapter_id in ${sql(directorCh)} or 'mentor' = any(audiences))`
              : sql`'mentor' = any(audiences)`
        }
      order by starts_at asc
    `
    return { items: rows.map(toEvent) }
  }

  /**
   * GET /guardian/calendar — the guardian view (`guardian.view_calendar`). Resolves
   * the guardian's verified children (ctx.guardianOf) to their active chapters and
   * returns the parent-audience, non-canceled events across them, each tagged with
   * its chapterId. Authorized against one of the guardian's children (the guardian
   * scope); a guardian with no verified child denies out_of_scope -> Forbidden.
   */
  async listGuardianCalendar(ctx: AuthContext): Promise<{ items: CalendarEvent[] }> {
    const anchor = ctx.guardianOf[0]
    const resource: Resource =
      anchor != null ? { subjectAccountId: anchor } : { subjectAccountId: null }
    await this.authorize(ctx, 'guardian.view_calendar', resource, { sql: this.sql })

    // Reachable only on allow, which required at least one verified child.
    const children = ctx.guardianOf
    const chapterRows = await this.sql`
      select distinct chapter_id from membership
      where account_id in ${this.sql(children)} and status = 'active'
    `
    const chapters = chapterRows.map((r) => r.chapter_id as string)
    if (chapters.length === 0) return { items: [] }

    const rows = await this.sql`
      select event_id, chapter_id, title, kind, starts_at, ends_at, audiences,
             location, notes, created_by_account_id, created_at
      from calendar_event_current
      where status = 'active'
        and 'parent' = any(audiences)
        and chapter_id in ${this.sql(chapters)}
      order by starts_at asc
    `
    return { items: rows.map(toEvent) }
  }
}
