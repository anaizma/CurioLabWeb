// -------------------------------------------------------------------------
// ProjectService — Milestone 3.2: the project lifecycle service, plus coupling
// C2 (external_publication revoke -> project de-list) wired into the consent
// revoke seam.
//
// Lifecycle (04-state-machines project): `draft -> submitted -> verified ->
// public_listed`, with the de-list `public_listed -> verified`. Each edge is
// validated with the pure `canTransition('project', ...)` and gated through the
// injected `authorize` wrapper over `can`:
//
//   - create        `project.create`        (a student for their own membership,
//                                            or an instructor) -> status `draft`;
//   - submit         `project.submit`        (owner student) `draft -> submitted`;
//   - verify         `project.verify`        (instructor in the project's pod, or
//                                            director) `submitted -> verified`,
//                                            stamping verified_by / verified_at —
//                                            a verified project is then eligible as
//                                            a tier_transition evidence_ref;
//   - publishPublic  `project.publish_public`(chapter_director) `verified ->
//                                            public_listed`, REQUIRING an active
//                                            external_publication consent for the
//                                            OWNER student scoped to this project;
//   - unpublish      `project.unpublish`     (director) `public_listed -> verified`.
//
// Subject-consent-on-the-resource (03-authorization): publishPublic hydrates the
// owner's external_publication snapshot (from consent_current) onto the resource
// BEFORE authorize; `can` reads it. A missing snapshot fails closed as
// `subject_consent_unknown`, an inactive/mismatched one as `subject_consent_missing`
// — matching the newsletter.publish pattern; the snapshot is never fetched inside
// `can`.
//
// Coupling C2 (04-state-machines): revoking the scoped external_publication
// consent reverts the project `public_listed -> verified` in the SAME transaction
// as the revoke. That runs through the `onRevoke` seam already provided by
// ConsentService; `projectExternalPublicationRevokeCascade` is the implementation.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP routes
// (M3.7) are wired later.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { canTransition } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import type { RevokeCascade } from './consent.js'
import { IllegalProjectTransitionError, ProjectNotFoundError } from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's capabilities
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type ProjectAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability:
    | 'project.create'
    | 'project.submit'
    | 'project.verify'
    | 'project.publish_public'
    | 'project.unpublish',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ProjectServiceDeps {
  sql: Sql
  authorize: ProjectAuthorizeFn
}

export interface CreateProjectInput {
  chapterId: string
  /** The student's membership; the row carries the owner's capacity and scope. */
  ownerMembershipId: string
  title: string
  summary?: string | null
}

export interface ProjectResult {
  projectId: string
  status: string
}

interface ProjectRow {
  id: string
  chapterId: string
  /** The owner membership's pod (the project's pod, for `project.verify` scope). */
  podId: string | null
  status: string
  ownerMembershipId: string
  /** The owner student's account (the subject of the external_publication gate). */
  ownerAccountId: string
}

/**
 * Coupling C2 (04-state-machines): the content consequence of an
 * `external_publication` revoke. Called inside the revoke transaction (holding
 * the student's `consent_current` FOR UPDATE lock) via ConsentService's
 * `onRevoke` seam, BEFORE the revoke row commits. The revoked consent's
 * `scope_ref` IS the project id, so a public_listed project scoped to it reverts
 * `public_listed -> verified` in the SAME transaction. verified_by / verified_at
 * are untouched (the project was verified before it was published). A no-op for
 * any other consent type (C1 photo_media is a separate cascade).
 */
export const projectExternalPublicationRevokeCascade: RevokeCascade = async (
  tx: Sql | TransactionSql,
  args: { studentAccountId: string; type: string; scopeRef: string | null },
): Promise<void> => {
  if (args.type !== 'external_publication' || args.scopeRef == null) return
  await tx`
    update project set status = 'verified'
    where id = ${args.scopeRef} and status = 'public_listed'
  `
}

export class ProjectService {
  private readonly sql: Sql
  private readonly authorize: ProjectAuthorizeFn

  constructor(deps: ProjectServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  private async load(projectId: string): Promise<ProjectRow> {
    const [row] = await this.sql`
      select
        p.id, p.chapter_id, p.status, p.owner_membership_id,
        m.pod_id as owner_pod_id, m.account_id as owner_account_id
      from project p
      join membership m on m.id = p.owner_membership_id
      where p.id = ${projectId}
    `
    if (row === undefined) throw new ProjectNotFoundError(projectId)
    return {
      id: row.id as string,
      chapterId: row.chapter_id as string,
      podId: (row.owner_pod_id as string | null) ?? null,
      status: row.status as string,
      ownerMembershipId: row.owner_membership_id as string,
      ownerAccountId: row.owner_account_id as string,
    }
  }

  /**
   * Create a project (`project.create`, chapter-scoped: a student or an
   * instructor). The owner is the passed membership; status defaults to `draft`.
   * The "own" bound for a student — that they open a project for their own
   * membership — is a caller concern; `can` gates the chapter+role floor.
   */
  async create(input: CreateProjectInput, ctx: AuthContext): Promise<ProjectResult> {
    const resource: Resource = { chapter_id: input.chapterId }
    await this.authorize(ctx, 'project.create', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [row] = await tx`
        insert into project (chapter_id, owner_membership_id, title, summary)
        values (${input.chapterId}, ${input.ownerMembershipId}, ${input.title}, ${input.summary ?? null})
        returning id, status
      `
      return { projectId: row!.id as string, status: row!.status as string }
    }) as Promise<ProjectResult>
  }

  /** Submit a project for verification (`project.submit`, owner student; `draft -> submitted`). */
  async submit(projectId: string, ctx: AuthContext): Promise<ProjectResult> {
    const p = await this.load(projectId)
    // `own` scope: the owner student is the project's owning membership account.
    const resource: Resource = { id: p.id, chapter_id: p.chapterId, ownerAccountId: p.ownerAccountId }
    await this.authorize(ctx, 'project.submit', resource, { sql: this.sql })

    this.assertLegal(p.status, 'submitted')
    return this.applyStatus(projectId, p.status, 'submitted')
  }

  /**
   * Verify a project (`project.verify`, an instructor in the project's pod or a
   * director; `submitted -> verified`), stamping `verified_by` (the actor) and
   * `verified_at`. A verified project becomes eligible as a `tier_transition`
   * evidence_ref.
   */
  async verify(projectId: string, ctx: AuthContext): Promise<ProjectResult> {
    const p = await this.load(projectId)
    const resource: Resource = { id: p.id, chapter_id: p.chapterId, pod_id: p.podId }
    await this.authorize(ctx, 'project.verify', resource, { sql: this.sql })

    this.assertLegal(p.status, 'verified')
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update project set status = 'verified', verified_by = ${ctx.account.id}, verified_at = now()
        where id = ${projectId} and status = 'submitted'
        returning id
      `
      if (rows.length === 0) {
        throw new IllegalProjectTransitionError(p.status, 'verified', 'illegal_transition')
      }
      return { projectId, status: 'verified' }
    }) as Promise<ProjectResult>
  }

  /**
   * Publish a project publicly (`project.publish_public`, chapter_director;
   * `verified -> public_listed`). REQUIRES an active `external_publication` consent
   * for the OWNER student scoped to this project. The owner's snapshot is hydrated
   * from `consent_current` onto the resource; `can` reads it (a missing snapshot
   * fails closed as `subject_consent_unknown`, an inactive/mismatched one as
   * `subject_consent_missing`). Atomic.
   */
  async publishPublic(projectId: string, ctx: AuthContext): Promise<ProjectResult> {
    const p = await this.load(projectId)

    // Hydrate the owner's external_publication snapshot BEFORE authorize (the
    // repository loads it; `can` reads it, never fetches). Absent row -> empty
    // consent set (subject_consent_unknown); present -> its active + scope_ref.
    const [snap] = await this.sql`
      select active, scope_ref from consent_current
      where student_account_id = ${p.ownerAccountId} and type = 'external_publication'
    `
    const resource: Resource = {
      id: p.id,
      chapter_id: p.chapterId,
      studentAuthoredItems: [
        {
          student: p.ownerAccountId,
          consent:
            snap === undefined
              ? {}
              : {
                  external_publication: {
                    active: snap.active as boolean,
                    scopeRef: (snap.scope_ref as string | null) ?? null,
                  },
                },
        },
      ],
    }
    await this.authorize(ctx, 'project.publish_public', resource, { sql: this.sql })

    this.assertLegal(p.status, 'public_listed')
    return this.applyStatus(projectId, p.status, 'public_listed', 'verified')
  }

  /**
   * De-list a project (`project.unpublish`, director; `public_listed -> verified`).
   * The system C2 cascade reaches the same edge via consent revoke; this is the
   * director-initiated path.
   */
  async unpublish(projectId: string, ctx: AuthContext): Promise<ProjectResult> {
    const p = await this.load(projectId)
    const resource: Resource = { id: p.id, chapter_id: p.chapterId }
    await this.authorize(ctx, 'project.unpublish', resource, { sql: this.sql })

    this.assertLegal(p.status, 'verified')
    return this.applyStatus(projectId, p.status, 'verified', 'public_listed')
  }

  /** Legality of the edge itself (independent of the actor), via the pure guard. */
  private assertLegal(from: string, to: string): void {
    const legal = canTransition('project', from, to)
    if (!legal.allowed) {
      throw new IllegalProjectTransitionError(from, to, legal.reason)
    }
  }

  /**
   * Apply a plain status change under the write backstop, guarded by the expected
   * `from` status so a concurrent change cannot double-apply. `guardFrom` defaults
   * to the observed status.
   */
  private applyStatus(
    projectId: string,
    observed: string,
    to: string,
    guardFrom: string = observed,
  ): Promise<ProjectResult> {
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update project set status = ${to}
        where id = ${projectId} and status = ${guardFrom}
        returning id
      `
      if (rows.length === 0) {
        throw new IllegalProjectTransitionError(observed, to, 'illegal_transition')
      }
      return { projectId, status: to }
    }) as Promise<ProjectResult>
  }
}
