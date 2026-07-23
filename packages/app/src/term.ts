// -------------------------------------------------------------------------
// TermService — Platform administration (05-api-surface.md "Platform
// administration": CRUD /admin/terms; capability `term.manage`). A term is per
// chapter (02-data-model.md term: `chapter_id`, `name`, `starts_on`, `ends_on`).
//
// `term.manage` is scope 'chapter' (03-authorization.md): a `chapter_director`
// manages terms only in THEIR chapter (a term in another chapter denies
// `out_of_scope`); a `platform_admin` manages any chapter via the platform
// override. `create` takes the chapter id directly (the authorization resource);
// `update` loads the term to resolve its chapter before authorizing against it.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP routes
// (POST /api/ops/terms, PATCH /api/ops/terms/:id) are thin adapters.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { TermNotFoundError } from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's one capability
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type TermAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'term.manage',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface TermServiceDeps {
  sql: Sql
  authorize: TermAuthorizeFn
}

export interface CreateTermInput {
  name: string
  /** ISO date `YYYY-MM-DD` (02-data-model.md term.starts_on / ends_on). */
  startsOn: string
  endsOn: string
}

export interface UpdateTermInput {
  name?: string
  startsOn?: string
  endsOn?: string
}

export interface TermResult {
  termId: string
  chapterId: string
  name: string
  startsOn: string
  endsOn: string
}

/** Normalize a postgres `date` (returned as a Date or a string) to `YYYY-MM-DD`. */
function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function toResult(row: Record<string, unknown>): TermResult {
  return {
    termId: row.id as string,
    chapterId: row.chapter_id as string,
    name: row.name as string,
    startsOn: isoDate(row.starts_on),
    endsOn: isoDate(row.ends_on),
  }
}

export class TermService {
  private readonly sql: Sql
  private readonly authorize: TermAuthorizeFn

  constructor(deps: TermServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Create a term in a chapter (`term.manage`, chapter-scoped to `chapterId`).
   * A director may create only in their own chapter; a platform_admin in any.
   */
  async create(
    chapterId: string,
    input: CreateTermInput,
    ctx: AuthContext,
  ): Promise<TermResult> {
    const resource: Resource = { chapter_id: chapterId }
    await this.authorize(ctx, 'term.manage', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [row] = await tx`
        insert into term (chapter_id, name, starts_on, ends_on)
        values (${chapterId}, ${input.name}, ${input.startsOn}, ${input.endsOn})
        returning id, chapter_id, name, starts_on, ends_on
      `
      return toResult(row!)
    }) as Promise<TermResult>
  }

  /**
   * Update a term's name / dates (`term.manage`). The term's own chapter is the
   * authorization scope, so it is loaded first; a director of another chapter is
   * then denied `out_of_scope`. A missing term is a typed not-found.
   */
  async update(
    termId: string,
    patch: UpdateTermInput,
    ctx: AuthContext,
  ): Promise<TermResult> {
    const [existing] = await this.sql`select chapter_id from term where id = ${termId}`
    if (existing === undefined) throw new TermNotFoundError(termId)

    const resource: Resource = { id: termId, chapter_id: existing.chapter_id as string }
    await this.authorize(ctx, 'term.manage', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        update term set
          name      = coalesce(${patch.name ?? null}, name),
          starts_on = coalesce(${patch.startsOn ?? null}, starts_on),
          ends_on   = coalesce(${patch.endsOn ?? null}, ends_on)
        where id = ${termId}
        returning id, chapter_id, name, starts_on, ends_on
      `
      if (row === undefined) throw new TermNotFoundError(termId)
      return toResult(row)
    }) as Promise<TermResult>
  }
}
