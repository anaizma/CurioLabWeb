// -------------------------------------------------------------------------
// The Lab — feed content services (Milestone 2.2). PostService, CommentService,
// ReactionService: the member-authored write surface over the M2.1 `post`,
// `comment`, and `reaction` tables.
//
// Authorization (03-authorization.md): every mutation is gated through the
// injected `authorize` wrapper over the pure `can`, under one of the feed
// capabilities — `feed.post` (create/edit), `feed.comment` (comment),
// `feed.react` (react), `feed.moderate` (hide/unhide/remove). All are
// chapter/pod scoped and gate minors on `platform_participation`; alumni are not
// participants, so they deny `role_not_permitted`. A stranger denies
// `out_of_scope`. Every mutation runs under the `assertAuthorized()`
// repository-write backstop.
//
// Lifecycle (04-state-machines.md): `published -> hidden -> published` is
// reversible; `-> removed` blanks the body, retains the row, and is terminal.
// Edge legality is checked with the pure `canTransition('feed_post' | 'comment',
// ...)`; the actor's permission to take the edge is `feed.moderate` via
// `authorize`. Both must hold.
//
// Authorship is by membership (02-data-model): the post/comment
// `author_membership_id` and the reaction `membership_id` are the actor's
// in-scope active membership in the target chapter/pod. `can` matches the
// membership in the AuthContext; the membership ROW id is resolved from the db
// here (the context carries capacity and scope, not the row id).
//
// Scope note (milestone-2.md §M2.2): `milestone` posts are system-generated and
// created only by M2.5's system path — the member create path rejects both a
// `milestone` type and a `system_generated` flag. Feed read/filters (M2.3),
// moderation reports / `feed.hide_safety` (M2.4), and the HTTP layer (M2.6) are
// out of scope here.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP
// routes (M2.6) are wired later.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { canTransition } from '@curiolab/core'
import {
  Forbidden,
  assertAuthorized,
  writeAudit,
  type AuditEntryInput,
  type AuthorizeDeps,
} from '@curiolab/runtime'
import {
  CommentNotFoundError,
  FeedAuthorMembershipNotFoundError,
  IllegalFeedContentTransitionError,
  PostMilestoneForbiddenError,
  PostNotFoundError,
} from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to the feed capabilities
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type FeedAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'feed.view' | 'feed.post' | 'feed.comment' | 'feed.react' | 'feed.moderate',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

/** The audit writer seam (structurally the runtime `writeAudit`). Injected so
 * the read-logging fails-closed path is testable with a throwing writer. */
export type FeedAuditWriter = (
  sql: Sql | TransactionSql,
  entry: AuditEntryInput,
) => Promise<string>

export interface FeedServiceDeps {
  sql: Sql
  authorize: FeedAuthorizeFn
  /** Defaults to the runtime `writeAudit`. */
  auditWriter?: FeedAuditWriter
}

/** The member-authored post types; `milestone` is the system path only. */
export type AuthoredPostType = 'wip' | 'finished_project' | 'question' | 'session_recap'

export interface CreatePostInput {
  chapterId: string
  podId?: string | null
  /** `milestone` is rejected — it is the system path (M2.5) only. */
  type: AuthoredPostType | 'milestone'
  body: string
  /** Always false on this path; a truthy value is rejected. */
  systemGenerated?: boolean
}

export interface CreatePostResult {
  postId: string
  status: string
  authorMembershipId: string
}

export interface EditPostResult {
  postId: string
  body: string
}

export interface CreateCommentInput {
  body: string
}

export interface CreateCommentResult {
  commentId: string
  status: string
  authorMembershipId: string
}

/** A reaction target: a post or a comment, by id. */
export interface ReactionTarget {
  type: 'post' | 'comment'
  id: string
}

export interface AddReactionResult {
  reactionId: string
  membershipId: string
}

export interface RemoveReactionResult {
  removed: boolean
}

export interface ContentStatusResult {
  id: string
  status: string
  body: string
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

/**
 * Resolve the actor's in-scope active membership ROW id in `chapterId`,
 * preferring a membership whose pod matches `podId` (a pod-scoped author), then
 * a chapter-wide membership, then any active one. `can` has already matched an
 * in-force membership in the AuthContext, so absence here is a data mismatch.
 */
async function resolveAuthorMembership(
  sql: Sql,
  accountId: string,
  chapterId: string,
  podId: string | null,
): Promise<string> {
  const rows = await sql`
    select id, pod_id from membership
    where account_id = ${accountId} and chapter_id = ${chapterId} and status = 'active'
    order by created_at desc
  `
  if (rows.length === 0) throw new FeedAuthorMembershipNotFoundError(accountId, chapterId)
  const exact = rows.find((r) => (r.pod_id as string | null) === podId)
  const chapterWide = rows.find((r) => (r.pod_id as string | null) === null)
  const pick = exact ?? chapterWide ?? rows[0]!
  return pick.id as string
}

/** Apply a content-status change on `post`/`comment`; `removed` blanks the body. */
async function applyContentStatus(
  tx: TransactionSql,
  table: 'post' | 'comment',
  id: string,
  target: 'published' | 'hidden' | 'removed',
): Promise<ContentStatusResult> {
  if (table === 'post') {
    const [row] =
      target === 'removed'
        ? await tx`update post set status = 'removed', body = '' where id = ${id} returning id, status, body`
        : await tx`update post set status = ${target} where id = ${id} returning id, status, body`
    return { id, status: row!.status as string, body: row!.body as string }
  }
  const [row] =
    target === 'removed'
      ? await tx`update comment set status = 'removed', body = '' where id = ${id} returning id, status, body`
      : await tx`update comment set status = ${target} where id = ${id} returning id, status, body`
  return { id, status: row!.status as string, body: row!.body as string }
}

/**
 * The shared hide/unhide/remove flow for a post or comment: authorize
 * `feed.moderate` against the content's chapter/pod, check the edge is legal
 * with `canTransition`, then apply the status change under the backstop.
 */
async function moderateContent(deps: {
  sql: Sql
  authorize: FeedAuthorizeFn
  machine: 'feed_post' | 'comment'
  table: 'post' | 'comment'
  id: string
  status: string
  chapterId: string
  podId: string | null
  target: 'published' | 'hidden' | 'removed'
  ctx: AuthContext
}): Promise<ContentStatusResult> {
  const { sql, authorize, machine, table, id, status, chapterId, podId, target, ctx } = deps
  const resource: Resource = { id, chapter_id: chapterId, pod_id: podId }
  await authorize(ctx, 'feed.moderate', resource, { sql })

  const legal = canTransition(machine, status, target)
  if (!legal.allowed) {
    throw new IllegalFeedContentTransitionError(machine, status, target, legal.reason)
  }

  return sql.begin(async (tx) => {
    assertAuthorized()
    return applyContentStatus(tx, table, id, target)
  }) as Promise<ContentStatusResult>
}

// ---------------------------------------------------------------------------
// PostService.
// ---------------------------------------------------------------------------

interface PostRow {
  chapterId: string
  podId: string | null
  status: string
  authorAccountId: string
}

export class PostService {
  private readonly sql: Sql
  private readonly authorize: FeedAuthorizeFn

  constructor(deps: FeedServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  private async loadPost(postId: string): Promise<PostRow> {
    const [row] = await this.sql`
      select p.chapter_id, p.pod_id, p.status, m.account_id as author_account_id
      from post p
      join membership m on m.id = p.author_membership_id
      where p.id = ${postId}
    `
    if (row === undefined) throw new PostNotFoundError(postId)
    return {
      chapterId: row.chapter_id as string,
      podId: (row.pod_id as string | null) ?? null,
      status: row.status as string,
      authorAccountId: row.author_account_id as string,
    }
  }

  /**
   * Create a member-authored post (`feed.post`). The author is the actor's
   * in-scope active membership for the target chapter/pod; the post's
   * `author_membership_id`, `chapter_id`, `pod_id` follow. `milestone` type and
   * `system_generated` are rejected (the system path, M2.5, owns those).
   */
  async create(input: CreatePostInput, ctx: AuthContext): Promise<CreatePostResult> {
    // Pure guards before any IO or authorization: this path never mints a
    // milestone or a system_generated post.
    if (input.type === 'milestone') throw new PostMilestoneForbiddenError('milestone_type')
    if (input.systemGenerated === true) throw new PostMilestoneForbiddenError('system_generated')

    const chapterId = input.chapterId
    const podId = input.podId ?? null
    const resource: Resource = { chapter_id: chapterId, pod_id: podId }

    // Authorize first (writes one permission.denied and throws Forbidden on
    // deny), BEFORE resolving authorship or mutating.
    await this.authorize(ctx, 'feed.post', resource, { sql: this.sql })

    const authorMembershipId = await resolveAuthorMembership(this.sql, ctx.account.id, chapterId, podId)

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into post (chapter_id, pod_id, author_membership_id, type, body, system_generated)
        values (${chapterId}, ${podId}, ${authorMembershipId}, ${input.type}, ${input.body}, false)
        returning id, status
      `
      return {
        postId: row!.id as string,
        status: row!.status as string,
        authorMembershipId,
      }
    }) as Promise<CreatePostResult>
  }

  /**
   * Edit a post's body (`feed.post`, own). Gated through `authorize` (the actor
   * must be an in-scope participant), then an ownership guard: only the post's
   * author may edit it. A non-author edit is refused with an opaque Forbidden and
   * a `permission.denied` audit row (reason `not_post_author`).
   */
  async edit(postId: string, body: string, ctx: AuthContext): Promise<EditPostResult> {
    const post = await this.loadPost(postId)
    const resource: Resource = { id: postId, chapter_id: post.chapterId, pod_id: post.podId }
    await this.authorize(ctx, 'feed.post', resource, { sql: this.sql })

    if (post.authorAccountId !== ctx.account.id) {
      await writeAudit(this.sql, {
        action: 'permission.denied',
        subjectType: 'post',
        subjectId: postId,
        actorAccountId: ctx.account.id,
        realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
        chapterId: post.chapterId,
        detail: { capability: 'feed.post', reason: 'not_post_author', resourceId: postId },
      })
      throw new Forbidden()
    }

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`update post set body = ${body} where id = ${postId} returning id, body`
      return { postId, body: row!.body as string }
    }) as Promise<EditPostResult>
  }

  /** Hide a post (`feed.moderate`; `published -> hidden`; reversible). */
  async hide(postId: string, ctx: AuthContext): Promise<ContentStatusResult> {
    const post = await this.loadPost(postId)
    return moderateContent({
      sql: this.sql,
      authorize: this.authorize,
      machine: 'feed_post',
      table: 'post',
      id: postId,
      status: post.status,
      chapterId: post.chapterId,
      podId: post.podId,
      target: 'hidden',
      ctx,
    })
  }

  /** Unhide a post (`feed.moderate`; `hidden -> published`). */
  async unhide(postId: string, ctx: AuthContext): Promise<ContentStatusResult> {
    const post = await this.loadPost(postId)
    return moderateContent({
      sql: this.sql,
      authorize: this.authorize,
      machine: 'feed_post',
      table: 'post',
      id: postId,
      status: post.status,
      chapterId: post.chapterId,
      podId: post.podId,
      target: 'published',
      ctx,
    })
  }

  /** Remove a post (`feed.moderate`; `-> removed`, blanks the body, terminal). */
  async remove(postId: string, ctx: AuthContext): Promise<ContentStatusResult> {
    const post = await this.loadPost(postId)
    return moderateContent({
      sql: this.sql,
      authorize: this.authorize,
      machine: 'feed_post',
      table: 'post',
      id: postId,
      status: post.status,
      chapterId: post.chapterId,
      podId: post.podId,
      target: 'removed',
      ctx,
    })
  }
}

// ---------------------------------------------------------------------------
// CommentService.
// ---------------------------------------------------------------------------

interface CommentRow {
  chapterId: string
  podId: string | null
  status: string
}

export class CommentService {
  private readonly sql: Sql
  private readonly authorize: FeedAuthorizeFn

  constructor(deps: FeedServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /** The post's chapter/pod (a comment authorizes against its post's scope). */
  private async loadPostScope(postId: string): Promise<{ chapterId: string; podId: string | null }> {
    const [row] = await this.sql`select chapter_id, pod_id from post where id = ${postId}`
    if (row === undefined) throw new PostNotFoundError(postId)
    return { chapterId: row.chapter_id as string, podId: (row.pod_id as string | null) ?? null }
  }

  private async loadComment(commentId: string): Promise<CommentRow> {
    const [row] = await this.sql`
      select c.status, p.chapter_id, p.pod_id
      from comment c
      join post p on p.id = c.post_id
      where c.id = ${commentId}
    `
    if (row === undefined) throw new CommentNotFoundError(commentId)
    return {
      chapterId: row.chapter_id as string,
      podId: (row.pod_id as string | null) ?? null,
      status: row.status as string,
    }
  }

  /**
   * Comment on a post (`feed.comment`, minor gated). Authorized against the
   * post's chapter/pod; authored by the actor's in-scope active membership.
   */
  async create(
    postId: string,
    input: CreateCommentInput,
    ctx: AuthContext,
  ): Promise<CreateCommentResult> {
    const scope = await this.loadPostScope(postId)
    const resource: Resource = { id: postId, chapter_id: scope.chapterId, pod_id: scope.podId }
    await this.authorize(ctx, 'feed.comment', resource, { sql: this.sql })

    const authorMembershipId = await resolveAuthorMembership(
      this.sql,
      ctx.account.id,
      scope.chapterId,
      scope.podId,
    )

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into comment (post_id, author_membership_id, body)
        values (${postId}, ${authorMembershipId}, ${input.body})
        returning id, status
      `
      return {
        commentId: row!.id as string,
        status: row!.status as string,
        authorMembershipId,
      }
    }) as Promise<CreateCommentResult>
  }

  /** Hide a comment (`feed.moderate`; `published -> hidden`; reversible). */
  async hide(commentId: string, ctx: AuthContext): Promise<ContentStatusResult> {
    const c = await this.loadComment(commentId)
    return moderateContent({
      sql: this.sql,
      authorize: this.authorize,
      machine: 'comment',
      table: 'comment',
      id: commentId,
      status: c.status,
      chapterId: c.chapterId,
      podId: c.podId,
      target: 'hidden',
      ctx,
    })
  }

  /** Unhide a comment (`feed.moderate`; `hidden -> published`). */
  async unhide(commentId: string, ctx: AuthContext): Promise<ContentStatusResult> {
    const c = await this.loadComment(commentId)
    return moderateContent({
      sql: this.sql,
      authorize: this.authorize,
      machine: 'comment',
      table: 'comment',
      id: commentId,
      status: c.status,
      chapterId: c.chapterId,
      podId: c.podId,
      target: 'published',
      ctx,
    })
  }

  /** Remove a comment (`feed.moderate`; `-> removed`, blanks the body, terminal). */
  async remove(commentId: string, ctx: AuthContext): Promise<ContentStatusResult> {
    const c = await this.loadComment(commentId)
    return moderateContent({
      sql: this.sql,
      authorize: this.authorize,
      machine: 'comment',
      table: 'comment',
      id: commentId,
      status: c.status,
      chapterId: c.chapterId,
      podId: c.podId,
      target: 'removed',
      ctx,
    })
  }
}

// ---------------------------------------------------------------------------
// ReactionService.
// ---------------------------------------------------------------------------

export class ReactionService {
  private readonly sql: Sql
  private readonly authorize: FeedAuthorizeFn

  constructor(deps: FeedServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /** The target's chapter/pod (a reaction authorizes against its target's scope). */
  private async loadTargetScope(
    target: ReactionTarget,
  ): Promise<{ chapterId: string; podId: string | null }> {
    if (target.type === 'post') {
      const [row] = await this.sql`select chapter_id, pod_id from post where id = ${target.id}`
      if (row === undefined) throw new PostNotFoundError(target.id)
      return { chapterId: row.chapter_id as string, podId: (row.pod_id as string | null) ?? null }
    }
    const [row] = await this.sql`
      select p.chapter_id, p.pod_id
      from comment c join post p on p.id = c.post_id
      where c.id = ${target.id}
    `
    if (row === undefined) throw new CommentNotFoundError(target.id)
    return { chapterId: row.chapter_id as string, podId: (row.pod_id as string | null) ?? null }
  }

  /**
   * Add a reaction (`feed.react`), enforcing the unique
   * `(target_type, target_id, membership_id, kind)`. IDEMPOTENT: a repeat of the
   * same reaction is a no-op (`on conflict do nothing`) and returns the existing
   * row — a "like" button clicked twice stays liked rather than erroring. A
   * different `kind` on the same target is a new row.
   */
  async add(target: ReactionTarget, kind: string, ctx: AuthContext): Promise<AddReactionResult> {
    const scope = await this.loadTargetScope(target)
    const resource: Resource = { id: target.id, chapter_id: scope.chapterId, pod_id: scope.podId }
    await this.authorize(ctx, 'feed.react', resource, { sql: this.sql })

    const membershipId = await resolveAuthorMembership(
      this.sql,
      ctx.account.id,
      scope.chapterId,
      scope.podId,
    )

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      await tx`
        insert into reaction (target_type, target_id, membership_id, kind)
        values (${target.type}, ${target.id}, ${membershipId}, ${kind})
        on conflict (target_type, target_id, membership_id, kind) do nothing
      `
      const [row] = await tx`
        select id from reaction
        where target_type = ${target.type} and target_id = ${target.id}
          and membership_id = ${membershipId} and kind = ${kind}
      `
      return { reactionId: row!.id as string, membershipId }
    }) as Promise<AddReactionResult>
  }

  /** Remove a reaction (`feed.react`). Idempotent: absent is not an error. */
  async remove(
    target: ReactionTarget,
    kind: string,
    ctx: AuthContext,
  ): Promise<RemoveReactionResult> {
    const scope = await this.loadTargetScope(target)
    const resource: Resource = { id: target.id, chapter_id: scope.chapterId, pod_id: scope.podId }
    await this.authorize(ctx, 'feed.react', resource, { sql: this.sql })

    const membershipId = await resolveAuthorMembership(
      this.sql,
      ctx.account.id,
      scope.chapterId,
      scope.podId,
    )

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        delete from reaction
        where target_type = ${target.type} and target_id = ${target.id}
          and membership_id = ${membershipId} and kind = ${kind}
        returning id
      `
      return { removed: rows.length > 0 }
    }) as Promise<RemoveReactionResult>
  }
}

// ---------------------------------------------------------------------------
// FeedService — the Lab feed READ + filters (Milestone 2.3).
//
// `view(ctx, filters)` is gated through the injected `authorize` under
// `feed.view` (03-authorization.md), scoped to the actor's chapter or pod (the
// scope resolution lives in `can`: any in-force participant membership in the
// target chapter matches `chapter` scope; a pod membership matches `pod` scope;
// a different chapter denies `out_of_scope`). Minors without
// `platform_participation` are denied `feed.view` by the registry gate — this
// service does not re-implement that.
//
// Visibility: ordinary viewers see only `published`. A `feed.moderate` holder
// may opt into `hidden` via the `includeHidden` flag, which is enforced through
// a SECOND `authorize(feed.moderate)` call (so a non-moderator who sets the flag
// is denied, rather than silently seeing nothing). `removed` is NEVER returned.
//
// Read-logging (milestone-2.md §M2.3): the `can` `minor_record.read` obligation
// is per single resource and does not fit a list. So this service handles it:
// when a query SURFACES content authored by a minor from OUTSIDE the actor's
// pod, it writes EXACTLY ONE `minor_record.read` audit entry FOR THE QUERY (not
// one per post — the documented granularity choice; the `detail` carries the
// scope and counts, never PII), inside the SAME transaction as the read. If that
// audit write fails, the transaction rolls back and the read returns nothing —
// the same fail-closed contract the runtime obligation path uses (must-not #25).
// An in-pod read (the actor's pod equals the minor's pod) logs nothing.
// ---------------------------------------------------------------------------

/** The default page size and the hard cap on a single feed page. */
export const FEED_DEFAULT_LIMIT = 50
export const FEED_MAX_LIMIT = 100

export interface FeedFilters {
  /** The chapter whose feed to read (the scope target). */
  chapterId: string
  /** Narrow to a pod (also the scope target when the actor is pod-scoped). */
  podId?: string | null
  /** Filter by post type. */
  type?: string
  /** Filter by author membership. */
  authorMembershipId?: string
  /** Page size (defaults to FEED_DEFAULT_LIMIT, capped at FEED_MAX_LIMIT). */
  limit?: number
  /** Offset for pagination (stable newest-first order). */
  offset?: number
  /** Opt into `hidden` posts; requires `feed.moderate` (enforced). */
  includeHidden?: boolean
}

export interface FeedPostView {
  postId: string
  chapterId: string
  podId: string | null
  authorMembershipId: string
  type: string
  body: string
  status: string
  systemGenerated: boolean
  createdAt: Date
  /** Published comments only. */
  commentCount: number
  /** Total reactions on the post. */
  reactionCount: number
}

export interface FeedViewResult {
  posts: FeedPostView[]
  limit: number
  offset: number
}

/** Internal read row (adds the author minor/pod facts used for read-logging). */
interface FeedReadRow {
  id: string
  chapter_id: string
  pod_id: string | null
  author_membership_id: string
  type: string
  body: string
  status: string
  system_generated: boolean
  created_at: Date
  comment_count: number
  reaction_count: number
  author_pod: string | null
  author_is_minor: boolean
}

/**
 * The actor's pod for the target chapter, mirroring `can`'s scope match: prefer
 * an in-force membership on the filtered pod, else any in-force membership in the
 * chapter; its `pod_id` (possibly null for a chapter-wide role) is the pod the
 * "minor outside the actor's pod" comparison is made against.
 */
function resolveActorPod(ctx: AuthContext, chapterId: string, podId: string | null): string | null {
  const inForce = (m: (typeof ctx.memberships)[number]): boolean => {
    if (m.status !== 'active') return false
    if (m.active_from !== null && m.active_from > ctx.now) return false
    if (m.active_until !== null && ctx.now >= m.active_until) return false
    return true
  }
  if (podId !== null) {
    const podMatch = ctx.memberships.find((m) => inForce(m) && m.chapter_id === chapterId && m.pod_id === podId)
    if (podMatch) return podMatch.pod_id
  }
  const chapterMatch = ctx.memberships.find((m) => inForce(m) && m.chapter_id === chapterId)
  return chapterMatch?.pod_id ?? null
}

export class FeedService {
  private readonly sql: Sql
  private readonly authorize: FeedAuthorizeFn
  private readonly auditWriter: FeedAuditWriter

  constructor(deps: FeedServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.auditWriter = deps.auditWriter ?? writeAudit
  }

  /**
   * Read the Lab feed for `ctx`, scoped to `filters.chapterId` (and optionally a
   * pod). Returns `published` posts (plus `hidden` for a moderator opting in via
   * `includeHidden`); never `removed`. Supports type / pod / author filters and
   * newest-first offset pagination. Surfacing a minor's out-of-pod content emits
   * exactly one transactional `minor_record.read` audit entry for the query.
   */
  async view(ctx: AuthContext, filters: FeedFilters): Promise<FeedViewResult> {
    const chapterId = filters.chapterId
    const podId = filters.podId ?? null
    const resource: Resource = { chapter_id: chapterId, pod_id: podId }

    // 1. The scope + consent gate. Denies out_of_scope for a foreign chapter and
    // actor_consent_missing for an unconsented minor (writes permission.denied,
    // throws an opaque Forbidden).
    await this.authorize(ctx, 'feed.view', resource, { sql: this.sql })

    // 2. `hidden` is opt-in and moderator-only: a second gate under feed.moderate
    // (an ordinary viewer who sets the flag is denied rather than silently empty).
    if (filters.includeHidden === true) {
      await this.authorize(ctx, 'feed.moderate', resource, { sql: this.sql })
    }
    const statuses = filters.includeHidden === true ? ['published', 'hidden'] : ['published']

    const actorPod = resolveActorPod(ctx, chapterId, podId)
    const limit = Math.min(Math.max(filters.limit ?? FEED_DEFAULT_LIMIT, 1), FEED_MAX_LIMIT)
    const offset = Math.max(filters.offset ?? 0, 0)

    const sql = this.sql
    return sql.begin(async (tx) => {
      const rows = (await tx`
        select
          p.id, p.chapter_id, p.pod_id, p.author_membership_id, p.type, p.body,
          p.status, p.system_generated, p.created_at,
          m.pod_id as author_pod,
          (a.date_of_birth > ((now() at time zone ch.timezone)::date - interval '18 years')) as author_is_minor,
          (select count(*)::int from comment c where c.post_id = p.id and c.status = 'published') as comment_count,
          (select count(*)::int from reaction r where r.target_type = 'post' and r.target_id = p.id) as reaction_count
        from post p
        join membership m on m.id = p.author_membership_id
        join account a on a.id = m.account_id
        join chapter ch on ch.id = p.chapter_id
        where p.chapter_id = ${chapterId}
          and p.status in ${tx(statuses)}
          ${podId !== null ? tx`and p.pod_id = ${podId}` : tx``}
          ${filters.type !== undefined ? tx`and p.type = ${filters.type}` : tx``}
          ${filters.authorMembershipId !== undefined ? tx`and p.author_membership_id = ${filters.authorMembershipId}` : tx``}
        order by p.created_at desc, p.id desc
        limit ${limit} offset ${offset}
      `) as unknown as FeedReadRow[]

      // Content authored by a minor whose pod differs from the actor's pod.
      const outOfPodMinor = rows.filter(
        (r) => r.author_is_minor && (r.author_pod ?? null) !== actorPod,
      )
      if (outOfPodMinor.length > 0) {
        // Exactly ONE entry for the whole query (the granularity choice): a list
        // read cannot use `can`'s per-resource obligation. detail carries scope
        // and counts only — never a name, body, or other PII. Written inside this
        // transaction so a failed audit rolls the read back (fail-closed).
        assertAuthorized()
        const distinctMinorAuthors = new Set(outOfPodMinor.map((r) => r.author_membership_id)).size
        await this.auditWriter(tx, {
          action: 'minor_record.read',
          subjectType: 'feed_query',
          subjectId: null,
          actorAccountId: ctx.account.id,
          realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
          chapterId,
          detail: {
            obligation: 'minor_record.read',
            granularity: 'per_query',
            scope: { chapterId, podId, includeHidden: filters.includeHidden === true },
            outOfPodMinorPostCount: outOfPodMinor.length,
            minorAuthorMembershipCount: distinctMinorAuthors,
          },
        })
      }

      const posts: FeedPostView[] = rows.map((r) => ({
        postId: r.id,
        chapterId: r.chapter_id,
        podId: r.pod_id,
        authorMembershipId: r.author_membership_id,
        type: r.type,
        body: r.body,
        status: r.status,
        systemGenerated: r.system_generated,
        createdAt: r.created_at,
        commentCount: r.comment_count,
        reactionCount: r.reaction_count,
      }))
      return { posts, limit, offset }
    }) as Promise<FeedViewResult>
  }
}
