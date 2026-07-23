// -------------------------------------------------------------------------
// ChapterService — Platform administration (05-api-surface.md "Platform
// administration": CRUD /admin/chapters; capability `chapter.manage`). Standing
// up and reconfiguring the organization's chapters. There is no other path to
// create a chapter (before this, chapters existed only via test seeds).
//
// `chapter.manage` is scope 'platform' (03-authorization.md): reachable ONLY
// through the platform override, so a `platform_admin` may create/update any
// chapter and no chapter role ever can (a chapter cannot be its own scope on
// create — there is no row yet). The write is gated through the injected
// `authorize` wrapper over `can`, and runs under the runtime write backstop.
//
// A new chapter is created `prospective` (02-data-model.md chapter status enum
// `prospective`,`active`,`paused`,`closed`); the create input carries no status.
// `update` patches the mutable status / tier / name.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP route
// (POST /api/admin/chapters, PATCH /api/admin/chapters/:id) is a thin adapter.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { ChapterNotFoundError } from './errors.js'

/** Chapter tier / status enums (02-data-model.md chapter). */
export type ChapterTier = 'seed' | 'active' | 'distinguished'
export type ChapterStatus = 'prospective' | 'active' | 'paused' | 'closed'

/**
 * The injected `authorize` dependency, narrowed to this service's one capability
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type ChapterAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'chapter.manage',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ChapterServiceDeps {
  sql: Sql
  authorize: ChapterAuthorizeFn
}

export interface CreateChapterInput {
  name: string
  slug: string
  tier: ChapterTier
  timezone: string
}

/** Mutable fields of an existing chapter (02-data-model.md). */
export interface UpdateChapterInput {
  name?: string
  tier?: ChapterTier
  status?: ChapterStatus
}

export interface ChapterResult {
  chapterId: string
  name: string
  slug: string
  tier: ChapterTier
  status: ChapterStatus
  timezone: string
}

function toResult(row: Record<string, unknown>): ChapterResult {
  return {
    chapterId: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    tier: row.tier as ChapterTier,
    status: row.status as ChapterStatus,
    timezone: row.timezone as string,
  }
}

export class ChapterService {
  private readonly sql: Sql
  private readonly authorize: ChapterAuthorizeFn

  constructor(deps: ChapterServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Create a chapter (`chapter.manage`, platform_admin only). Status defaults to
   * `prospective`. Authorization is platform-scoped, so it needs no chapter row —
   * gated before any mutation.
   */
  async create(input: CreateChapterInput, ctx: AuthContext): Promise<ChapterResult> {
    // Platform scope: the decision is independent of any chapter row.
    await this.authorize(ctx, 'chapter.manage', {}, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [row] = await tx`
        insert into chapter (name, slug, tier, status, timezone)
        values (${input.name}, ${input.slug}, ${input.tier}, 'prospective', ${input.timezone})
        returning id, name, slug, tier, status, timezone
      `
      return toResult(row!)
    }) as Promise<ChapterResult>
  }

  /**
   * Update a chapter's mutable status / tier / name (`chapter.manage`,
   * platform_admin only). Authorization is platform-scoped and independent of the
   * row, so it runs first; a missing chapter is then a typed not-found (no
   * existence leak, since a non-admin is denied before the load result matters).
   */
  async update(
    chapterId: string,
    patch: UpdateChapterInput,
    ctx: AuthContext,
  ): Promise<ChapterResult> {
    const resource: Resource = { id: chapterId }
    await this.authorize(ctx, 'chapter.manage', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        update chapter set
          name   = coalesce(${patch.name ?? null}, name),
          tier   = coalesce(${patch.tier ?? null}, tier),
          status = coalesce(${patch.status ?? null}, status)
        where id = ${chapterId}
        returning id, name, slug, tier, status, timezone
      `
      if (row === undefined) throw new ChapterNotFoundError(chapterId)
      return toResult(row)
    }) as Promise<ChapterResult>
  }
}
