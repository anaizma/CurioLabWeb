// -------------------------------------------------------------------------
// Project lifecycle controllers (05-api-surface.md "Student profile and
// projects"). Each mutation resolves the session to an AuthContext and calls
// ProjectService under `authorize`; a deny surfaces as an opaque 403.
//
//   createProject     POST  /api/projects                (project.create)
//   submitProject     PATCH /api/projects/:id/submit      (project.submit, own)
//   verifyProject     POST  /api/projects/:id/verify      (project.verify)
//   publishProject    POST  /api/projects/:id/publish     (project.publish_public, scoped consent)
//   unpublishProject  POST  /api/projects/:id/unpublish   (project.unpublish)
// -------------------------------------------------------------------------

import { ProjectService, type ProjectResult } from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

// ---- Create ---------------------------------------------------------------

export interface CreateProjectInputHttp extends AuthedInputBase {
  body: { chapterId?: unknown; ownerMembershipId?: unknown; title?: unknown; summary?: unknown }
}

/** POST /api/projects — open a draft project (project.create). */
export function createProject(
  input: CreateProjectInputHttp,
): Promise<ControllerResult<ProjectResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await new ProjectService({ sql, authorize }).create(
      {
        chapterId: reqStr(input.body?.chapterId, 'chapterId'),
        ownerMembershipId: reqStr(input.body?.ownerMembershipId, 'ownerMembershipId'),
        title: reqStr(input.body?.title, 'title'),
        summary: optStr(input.body?.summary),
      },
      ctx,
    )
    return { status: 201, body: result }
  })
}

// ---- Lifecycle edges ------------------------------------------------------

export interface ProjectIdInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** PATCH /api/projects/:id/submit — draft -> submitted (project.submit, own). */
export function submitProject(input: ProjectIdInput): Promise<ControllerResult<ProjectResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const projectId = reqStr(input.params?.id, 'id')
    const result = await new ProjectService({ sql, authorize }).submit(projectId, ctx)
    return { status: 200, body: result }
  })
}

/** POST /api/projects/:id/verify — submitted -> verified (project.verify). */
export function verifyProject(input: ProjectIdInput): Promise<ControllerResult<ProjectResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const projectId = reqStr(input.params?.id, 'id')
    const result = await new ProjectService({ sql, authorize }).verify(projectId, ctx)
    return { status: 200, body: result }
  })
}

/** POST /api/projects/:id/publish — verified -> public_listed (project.publish_public, scoped consent). */
export function publishProject(input: ProjectIdInput): Promise<ControllerResult<ProjectResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const projectId = reqStr(input.params?.id, 'id')
    const result = await new ProjectService({ sql, authorize }).publishPublic(projectId, ctx)
    return { status: 200, body: result }
  })
}

/** POST /api/projects/:id/unpublish — public_listed -> verified (project.unpublish). */
export function unpublishProject(input: ProjectIdInput): Promise<ControllerResult<ProjectResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const projectId = reqStr(input.params?.id, 'id')
    const result = await new ProjectService({ sql, authorize }).unpublish(projectId, ctx)
    return { status: 200, body: result }
  })
}
