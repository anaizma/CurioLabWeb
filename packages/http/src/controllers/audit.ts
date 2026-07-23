// -------------------------------------------------------------------------
// Audit readers (05-api-surface.md: GET /ops/audit — chapter-scoped for a
// director; GET /admin/audit — cross-chapter for platform staff). Each read is
// itself logged: one `audit.read` entry PER QUERY (not per row). The gate now
// routes through `authorize(ctx, 'audit.view', …)` — a first-class registry
// capability (scope 'chapter', roles [chapter_director]; the platform override
// grants any chapter and the global trail) — restoring the single-code-path
// invariant: a deny writes one reasoned permission.denied row and throws Forbidden
// (opaque 403). The read + the audit.read log use only the existing runtime
// primitives (a direct audit_entry read and `writeAudit`), inventing no app service.
//
//   readOpsAudit    GET /api/ops/audit    a chapter_director reads their chapter
//   readAdminAudit  GET /api/admin/audit  platform_admin / platform_staff, global
// -------------------------------------------------------------------------

import type { AuthContext } from '@curiolab/core'
import { authorize, writeAudit } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { FORBIDDEN_BODY, optStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/** One audit_entry row as the readers project it (references only, no PII beyond ids). */
export interface AuditEntryView {
  id: string
  at: string
  action: string
  subjectType: string
  subjectId: string | null
  actorAccountId: string | null
  realActorAccountId: string | null
  chapterId: string | null
  detail: Record<string, unknown>
}

export interface OpsAuditResult {
  chapterId: string
  entries: AuditEntryView[]
}

export interface AdminAuditResult {
  entries: AuditEntryView[]
}

export interface ReadAuditInput extends AuthedInputBase {
  query?: { chapterId?: unknown; limit?: unknown }
}

/** The chapters the actor may read audit for as a director (in-force chapter_director). */
function directorChapters(ctx: AuthContext): string[] {
  return ctx.memberships
    .filter((m) => {
      if (m.role !== 'chapter_director' || m.status !== 'active') return false
      if (m.active_from !== null && m.active_from > ctx.now) return false
      if (m.active_until !== null && ctx.now >= m.active_until) return false
      return true
    })
    .map((m) => m.chapter_id)
}

function parseLimit(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseInt(v, 10) : NaN
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

function toView(r: Record<string, unknown>): AuditEntryView {
  return {
    id: r.id as string,
    at: (r.at as Date).toISOString(),
    action: r.action as string,
    subjectType: r.subject_type as string,
    subjectId: (r.subject_id as string | null) ?? null,
    actorAccountId: (r.actor_account_id as string | null) ?? null,
    realActorAccountId: (r.real_actor_account_id as string | null) ?? null,
    chapterId: (r.chapter_id as string | null) ?? null,
    detail: (r.detail as Record<string, unknown> | null) ?? {},
  }
}

/**
 * GET /api/ops/audit — a Chapter Director reads their chapter's audit trail.
 * The chapter is `?chapterId` (must be one the actor directs) or, when absent,
 * the actor's director chapter. A platform reader may name any chapter (via the
 * platform override). The chapter-scoped `audit.view` gate runs through
 * `authorize`; a deny is an opaque 403 with one permission.denied row. One
 * `audit.read` entry is written for the query on allow.
 */
export function readOpsAudit(input: ReadAuditInput): Promise<ControllerResult<OpsAuditResult>> {
  return runAuthed<OpsAuditResult>(input, async (ctx, sql) => {
    const requested = optStr(input.query?.chapterId)
    const chapters = directorChapters(ctx)
    const chapterId = requested ?? (chapters.length > 0 ? chapters[0]! : null)

    // No chapter to scope to (a caller with no ?chapterId and no director chapter):
    // an opaque 403 with no decision to attribute, like a null-session runAuthed.
    if (chapterId === null) {
      return { status: 403, body: FORBIDDEN_BODY as unknown as OpsAuditResult }
    }

    // Chapter-scoped gate. A director of another chapter denies out_of_scope; a
    // non-director role in the chapter denies role_not_permitted; a platform
    // reader is granted by the override. Deny -> Forbidden -> 403 + permission.denied.
    await authorize(ctx, 'audit.view', { chapter_id: chapterId }, { sql })

    const limit = parseLimit(input.query?.limit)
    const rows = await sql`
      select id, at, action, subject_type, subject_id, actor_account_id,
             real_actor_account_id, chapter_id, detail
      from audit_entry where chapter_id = ${chapterId}
      order by at desc limit ${limit}
    `
    const entries = rows.map(toView)

    await writeAudit(sql, {
      action: 'audit.read',
      subjectType: 'audit',
      subjectId: null,
      actorAccountId: ctx.account.id,
      realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
      chapterId,
      detail: { scope: 'chapter', returned: entries.length },
    })

    return { status: 200, body: { chapterId, entries } }
  })
}

/**
 * GET /api/admin/audit — a platform reader reads the cross-chapter audit trail
 * (optionally filtered to one `?chapterId`). The global read is authorized via
 * `audit.view` on a resource with NO chapter, so ONLY the platform override
 * satisfies it (a chapter director's chapter scope cannot match a null chapter) —
 * making this endpoint platform-only through the same single code path. A deny is
 * an opaque 403 with one permission.denied row. One `audit.read` entry is written
 * for the query on allow.
 */
export function readAdminAudit(input: ReadAuditInput): Promise<ControllerResult<AdminAuditResult>> {
  return runAuthed<AdminAuditResult>(input, async (ctx, sql) => {
    await authorize(ctx, 'audit.view', {}, { sql })
    const filterChapter = optStr(input.query?.chapterId)
    const limit = parseLimit(input.query?.limit)
    const rows = filterChapter
      ? await sql`
          select id, at, action, subject_type, subject_id, actor_account_id,
                 real_actor_account_id, chapter_id, detail
          from audit_entry where chapter_id = ${filterChapter}
          order by at desc limit ${limit}
        `
      : await sql`
          select id, at, action, subject_type, subject_id, actor_account_id,
                 real_actor_account_id, chapter_id, detail
          from audit_entry
          order by at desc limit ${limit}
        `
    const entries = rows.map(toView)

    await writeAudit(sql, {
      action: 'audit.read',
      subjectType: 'audit',
      subjectId: null,
      actorAccountId: ctx.account.id,
      realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
      chapterId: filterChapter,
      detail: { scope: 'global', chapterFilter: filterChapter, returned: entries.length },
    })

    return { status: 200, body: { entries } }
  })
}
