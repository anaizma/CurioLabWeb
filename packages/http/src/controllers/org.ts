// -------------------------------------------------------------------------
// Organization-structure controllers (05-api-surface.md "Platform
// administration": CRUD /admin/chapters, /admin/terms, /admin/pods). Each
// resolves a session to an AuthContext and calls its service under `authorize`;
// a deny surfaces as an opaque 403 with one permission.denied audit row (owned by
// the runtime layer).
//
//   createChapter   POST   /api/admin/chapters                         (chapter.manage, platform_admin)
//   updateChapter   PATCH  /api/admin/chapters/:id                     (chapter.manage, platform_admin)
//   createTerm      POST   /api/ops/terms                              (term.manage, chapter_director)
//   updateTerm      PATCH  /api/ops/terms/:id                          (term.manage, chapter_director)
//   createPod       POST   /api/ops/pods                               (pod.manage, chapter_director)
//   assignPod       POST   /api/ops/pods/:id/assignments               (pod.manage, chapter_director)
//   unassignPod     DELETE /api/ops/pods/:id/assignments/:membershipId (pod.manage, chapter_director)
// -------------------------------------------------------------------------

import {
  ChapterService,
  PodService,
  TermService,
  type ChapterResult,
  type ChapterStatus,
  type ChapterTier,
  type PodAssignmentResult,
  type PodResult,
  type TermResult,
  type UnassignResult,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { ValidationError, optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

const CHAPTER_TIERS: readonly ChapterTier[] = ['seed', 'active', 'distinguished']
const CHAPTER_STATUSES: readonly ChapterStatus[] = ['prospective', 'active', 'paused', 'closed']

function reqTier(v: unknown): ChapterTier {
  const s = reqStr(v, 'tier')
  if (!CHAPTER_TIERS.includes(s as ChapterTier)) throw new ValidationError(`unknown chapter tier: ${s}`)
  return s as ChapterTier
}

function optTier(v: unknown): ChapterTier | undefined {
  if (v == null) return undefined
  return reqTier(v)
}

function optStatus(v: unknown): ChapterStatus | undefined {
  if (v == null) return undefined
  const s = String(v)
  if (!CHAPTER_STATUSES.includes(s as ChapterStatus)) throw new ValidationError(`unknown chapter status: ${s}`)
  return s as ChapterStatus
}

// ---- Chapters (platform administration) -----------------------------------

export interface CreateChapterInputHttp extends AuthedInputBase {
  body: { name?: unknown; slug?: unknown; tier?: unknown; timezone?: unknown }
}

/** POST /api/admin/chapters — stand up a chapter (chapter.manage, platform_admin). */
export function createChapter(input: CreateChapterInputHttp): Promise<ControllerResult<ChapterResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await new ChapterService({ sql, authorize }).create(
      {
        name: reqStr(input.body?.name, 'name'),
        slug: reqStr(input.body?.slug, 'slug'),
        tier: reqTier(input.body?.tier),
        timezone: reqStr(input.body?.timezone, 'timezone'),
      },
      ctx,
    )
    return { status: 201, body: result }
  })
}

export interface UpdateChapterInputHttp extends AuthedInputBase {
  params: { id?: unknown }
  body: { name?: unknown; tier?: unknown; status?: unknown }
}

/** PATCH /api/admin/chapters/:id — reconfigure a chapter (chapter.manage, platform_admin). */
export function updateChapter(input: UpdateChapterInputHttp): Promise<ControllerResult<ChapterResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(input.params?.id, 'id')
    const result = await new ChapterService({ sql, authorize }).update(
      chapterId,
      {
        name: optStr(input.body?.name) ?? undefined,
        tier: optTier(input.body?.tier),
        status: optStatus(input.body?.status),
      },
      ctx,
    )
    return { status: 200, body: result }
  })
}

// ---- Terms (chapter administration) ---------------------------------------

export interface CreateTermInputHttp extends AuthedInputBase {
  body: { chapterId?: unknown; name?: unknown; startsOn?: unknown; endsOn?: unknown }
}

/** POST /api/ops/terms — create a term in a chapter (term.manage, chapter_director). */
export function createTerm(input: CreateTermInputHttp): Promise<ControllerResult<TermResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(input.body?.chapterId, 'chapterId')
    const result = await new TermService({ sql, authorize }).create(
      chapterId,
      {
        name: reqStr(input.body?.name, 'name'),
        startsOn: reqStr(input.body?.startsOn, 'startsOn'),
        endsOn: reqStr(input.body?.endsOn, 'endsOn'),
      },
      ctx,
    )
    return { status: 201, body: result }
  })
}

export interface UpdateTermInputHttp extends AuthedInputBase {
  params: { id?: unknown }
  body: { name?: unknown; startsOn?: unknown; endsOn?: unknown }
}

/** PATCH /api/ops/terms/:id — rename / re-date a term (term.manage, chapter_director). */
export function updateTerm(input: UpdateTermInputHttp): Promise<ControllerResult<TermResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const termId = reqStr(input.params?.id, 'id')
    const result = await new TermService({ sql, authorize }).update(
      termId,
      {
        name: optStr(input.body?.name) ?? undefined,
        startsOn: optStr(input.body?.startsOn) ?? undefined,
        endsOn: optStr(input.body?.endsOn) ?? undefined,
      },
      ctx,
    )
    return { status: 200, body: result }
  })
}

// ---- Pods + pod assignments (chapter administration) ----------------------

export interface CreatePodInputHttp extends AuthedInputBase {
  body: { chapterId?: unknown; termId?: unknown; name?: unknown; mentorMembershipId?: unknown }
}

/** POST /api/ops/pods — create a pod in a chapter (pod.manage, chapter_director). */
export function createPod(input: CreatePodInputHttp): Promise<ControllerResult<PodResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(input.body?.chapterId, 'chapterId')
    const result = await new PodService({ sql, authorize }).create(
      chapterId,
      {
        termId: reqStr(input.body?.termId, 'termId'),
        name: reqStr(input.body?.name, 'name'),
        mentorMembershipId: optStr(input.body?.mentorMembershipId),
      },
      ctx,
    )
    return { status: 201, body: result }
  })
}

export interface AssignPodInputHttp extends AuthedInputBase {
  params: { id?: unknown }
  body: { membershipId?: unknown; termId?: unknown }
}

/** POST /api/ops/pods/:id/assignments — assign a senior instructor to a pod for a term (pod.manage). */
export function assignPod(input: AssignPodInputHttp): Promise<ControllerResult<PodAssignmentResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const podId = reqStr(input.params?.id, 'id')
    const result = await new PodService({ sql, authorize }).assign(
      podId,
      reqStr(input.body?.membershipId, 'membershipId'),
      reqStr(input.body?.termId, 'termId'),
      ctx,
    )
    return { status: 201, body: result }
  })
}

export interface UnassignPodInputHttp extends AuthedInputBase {
  params: { id?: unknown; membershipId?: unknown }
  body?: { termId?: unknown }
}

/** DELETE /api/ops/pods/:id/assignments/:membershipId — remove a pod assignment (pod.manage). */
export function unassignPod(input: UnassignPodInputHttp): Promise<ControllerResult<UnassignResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const podId = reqStr(input.params?.id, 'id')
    const membershipId = reqStr(input.params?.membershipId, 'membershipId')
    const termId = reqStr(input.body?.termId, 'termId')
    const result = await new PodService({ sql, authorize }).unassign(podId, membershipId, termId, ctx)
    return { status: 200, body: result }
  })
}
