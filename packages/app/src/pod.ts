// -------------------------------------------------------------------------
// PodService — Platform administration (05-api-surface.md "Platform
// administration": CRUD /admin/pods, and the pod-assignment ops rows;
// capability `pod.manage`). A pod belongs to a chapter and a term and carries an
// optional mentor membership (02-data-model.md pod: `chapter_id`, `term_id`,
// `name`, `mentor_membership_id`). A `pod_assignment` maps a senior instructor to
// a pod for a term (02-data-model.md pod_assignment: composite-unique
// `(membership_id, pod_id, term_id)` — "the entire definition of instructor
// scope").
//
// `pod.manage` is scope 'chapter' (03-authorization.md): a `chapter_director`
// manages pods only in THEIR chapter; a `platform_admin` in any chapter via the
// platform override. `create` takes the chapter id directly; `assign`/`unassign`
// load the pod to resolve its chapter before authorizing against it, so a
// director of another chapter is denied `out_of_scope`.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP routes
// (POST /api/ops/pods, POST/DELETE /api/ops/pods/:id/assignments/...) are thin
// adapters.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { PodNotFoundError } from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's one capability
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type PodAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'pod.manage',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface PodServiceDeps {
  sql: Sql
  authorize: PodAuthorizeFn
}

export interface CreatePodInput {
  termId: string
  name: string
  /** An optional senior-instructor membership as the pod's mentor. */
  mentorMembershipId?: string | null
}

export interface PodResult {
  podId: string
  chapterId: string
  termId: string
  name: string
  mentorMembershipId: string | null
}

export interface PodAssignmentResult {
  podAssignmentId: string
  podId: string
  membershipId: string
  termId: string
}

export interface UnassignResult {
  podId: string
  membershipId: string
  termId: string
  removed: boolean
}

export class PodService {
  private readonly sql: Sql
  private readonly authorize: PodAuthorizeFn

  constructor(deps: PodServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /** Resolve a pod's chapter (the authorization scope for assign/unassign). */
  private async loadChapter(podId: string): Promise<string> {
    const [row] = await this.sql`select chapter_id from pod where id = ${podId}`
    if (row === undefined) throw new PodNotFoundError(podId)
    return row.chapter_id as string
  }

  /**
   * Create a pod in a chapter (`pod.manage`, chapter-scoped to `chapterId`). A
   * director may create only in their own chapter; a platform_admin in any.
   */
  async create(
    chapterId: string,
    input: CreatePodInput,
    ctx: AuthContext,
  ): Promise<PodResult> {
    const resource: Resource = { chapter_id: chapterId }
    await this.authorize(ctx, 'pod.manage', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [row] = await tx`
        insert into pod (chapter_id, term_id, name, mentor_membership_id)
        values (${chapterId}, ${input.termId}, ${input.name}, ${input.mentorMembershipId ?? null})
        returning id, chapter_id, term_id, name, mentor_membership_id
      `
      return {
        podId: row!.id as string,
        chapterId: row!.chapter_id as string,
        termId: row!.term_id as string,
        name: row!.name as string,
        mentorMembershipId: (row!.mentor_membership_id as string | null) ?? null,
      }
    }) as Promise<PodResult>
  }

  /**
   * Assign a senior instructor to a pod for a term (`pod.manage`): a
   * `pod_assignment` row `(membership_id, pod_id, term_id)`. Scoped to the pod's
   * chapter. Idempotent on the composite unique — a re-assign returns the existing
   * row rather than raising.
   */
  async assign(
    podId: string,
    membershipId: string,
    termId: string,
    ctx: AuthContext,
  ): Promise<PodAssignmentResult> {
    const chapterId = await this.loadChapter(podId)
    const resource: Resource = { id: podId, chapter_id: chapterId }
    await this.authorize(ctx, 'pod.manage', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into pod_assignment (membership_id, pod_id, term_id)
        values (${membershipId}, ${podId}, ${termId})
        on conflict (membership_id, pod_id, term_id) do update set membership_id = excluded.membership_id
        returning id
      `
      return { podAssignmentId: row!.id as string, podId, membershipId, termId }
    }) as Promise<PodAssignmentResult>
  }

  /**
   * Remove a senior instructor's assignment from a pod for a term (`pod.manage`).
   * Scoped to the pod's chapter. `removed` reflects whether a row was deleted.
   */
  async unassign(
    podId: string,
    membershipId: string,
    termId: string,
    ctx: AuthContext,
  ): Promise<UnassignResult> {
    const chapterId = await this.loadChapter(podId)
    const resource: Resource = { id: podId, chapter_id: chapterId }
    await this.authorize(ctx, 'pod.manage', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        delete from pod_assignment
        where membership_id = ${membershipId} and pod_id = ${podId} and term_id = ${termId}
        returning id
      `
      return { podId, membershipId, termId, removed: rows.length > 0 }
    }) as Promise<UnassignResult>
  }
}
