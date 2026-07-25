// -------------------------------------------------------------------------
// Director-portal READ controllers (admin/director work order P1;
// docs/platform/director-portal-read-endpoints.md). Thin GET adapters over the
// framework-agnostic OpsReadService: resolve the session to an AuthContext
// (runAuthed), then call the service, which gates a chapter-scoped READ
// capability through the injected `authorize` and reads one query set. A null
// session is an opaque 403 (runAuthed); a cross-chapter / non-director caller is
// an opaque 403 from the service's authorize (Forbidden). No manifest entries —
// GET is exempt from the route-manifest guard (only mutating methods are).
//
//   listApplications      GET /api/ops/applications            (application.read)
//   getApplication        GET /api/ops/applications/:id        (application.read)
//   listInvites           GET /api/ops/invites                 (invite.read)
//   listMemberships       GET /api/ops/memberships             (membership.read)
//   listGuardianships     GET /api/ops/guardianships           (guardianship.read)
//   listMediaReviewQueue  GET /api/ops/media/review-queue      (media.review)
//   listDeletionRequests  GET /api/ops/deletion-requests       (deletion.read)
//   listExportRequests    GET /api/ops/export-requests         (export.read)
//   listEnrollments       GET /api/ops/enrollments             (enrollment.read)
//   listPods              GET /api/ops/pods                     (pod.read)
//   listTerms             GET /api/ops/terms                    (pod.read)
//   opsDashboard          GET /api/ops/dashboard               (application.read)
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import {
  OpsReadService,
  type ApplicationListResult,
  type ApplicationDetail,
  type InviteListItem,
  type MembershipListItem,
  type GuardianshipListItem,
  type MediaReviewItem,
  type DeletionRequestItem,
  type ExportRequestItem,
  type EnrollmentListItem,
  type PodListItem,
  type TermListItem,
  type DashboardSummary,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { reqStr, optStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

/** A query value may arrive as a single string or (repeatable param) an array. */
type QueryValue = string | string[] | null | undefined
export interface ReadQueryInput extends AuthedInputBase {
  query?: Record<string, QueryValue>
}
export interface ReadDetailInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** A bare list envelope (pagination can be added later without a breaking change). */
interface ListEnvelope<T> {
  items: T[]
}

/**
 * Parse a repeatable / CSV filter param into a deduped list, or undefined when
 * absent. Accepts `?status=a&status=b` (array) AND `?status=a,b` (CSV).
 */
function parseList(v: QueryValue): string[] | undefined {
  if (v == null) return undefined
  const raw = Array.isArray(v) ? v : [v]
  const out = raw.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean)
  return out.length > 0 ? Array.from(new Set(out)) : undefined
}

/** The frontend uses `interview`; the DB enum value is `interview_scheduled`. */
function normalizeApplicationStatuses(list: string[] | undefined): string[] | undefined {
  if (list === undefined) return undefined
  return list.map((s) => (s === 'interview' ? 'interview_scheduled' : s))
}

function chapterId(input: ReadQueryInput): string | null {
  return optStr(input.query?.chapterId)
}

function svc(sql: Sql) {
  return new OpsReadService({ sql, authorize })
}

// ---- applications ---------------------------------------------------------

export function listApplications(
  input: ReadQueryInput,
): Promise<ControllerResult<ApplicationListResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const statuses = normalizeApplicationStatuses(parseList(input.query?.status))
    const view = optStr(input.query?.view) === 'full' ? ('full' as const) : null
    const termId = optStr(input.query?.termId)
    const result = await svc(sql).listApplications(ctx, {
      chapterId: chapterId(input),
      ...(statuses ? { statuses } : {}),
      ...(view ? { view } : {}),
      ...(termId != null ? { termId } : {}),
    })
    return { status: 200, body: result }
  })
}

export function getApplication(
  input: ReadDetailInput,
): Promise<ControllerResult<ApplicationDetail>> {
  return runAuthed(input, async (ctx, sql) => {
    const id = reqStr(input.params?.id, 'id')
    const result = await svc(sql).getApplication(ctx, id)
    return { status: 200, body: result }
  })
}

// ---- invites --------------------------------------------------------------

export function listInvites(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<InviteListItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listInvites(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}

// ---- memberships (roster) -------------------------------------------------

export function listMemberships(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<MembershipListItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const statuses = parseList(input.query?.status)
    const roles = parseList(input.query?.role)
    const result = await svc(sql).listMemberships(ctx, {
      chapterId: chapterId(input),
      ...(statuses ? { statuses } : {}),
      ...(roles ? { roles } : {}),
    })
    return { status: 200, body: result }
  })
}

// ---- guardianships --------------------------------------------------------

export function listGuardianships(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<GuardianshipListItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listGuardianships(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}

// ---- media review queue ---------------------------------------------------

export function listMediaReviewQueue(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<MediaReviewItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listMediaReviewQueue(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}

// ---- deletion / export requests -------------------------------------------

export function listDeletionRequests(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<DeletionRequestItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listDeletionRequests(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}

export function listExportRequests(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<ExportRequestItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listExportRequests(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}

// ---- enrollments ----------------------------------------------------------

export function listEnrollments(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<EnrollmentListItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listEnrollments(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}

// ---- pods / terms ---------------------------------------------------------

export function listPods(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<PodListItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listPods(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}

export function listTerms(
  input: ReadQueryInput,
): Promise<ControllerResult<ListEnvelope<TermListItem>>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listTerms(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}

// ---- dashboard ------------------------------------------------------------

export function opsDashboard(
  input: ReadQueryInput,
): Promise<ControllerResult<DashboardSummary>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).dashboard(ctx, { chapterId: chapterId(input) })
    return { status: 200, body: result }
  })
}
