// -------------------------------------------------------------------------
// The Lab controllers (05-api-surface.md "The Lab"; milestone-2.md §M2.6). Each
// resolves the session cookie to an AuthContext (context.ts, via runAuthed),
// runs under `withRequest`, and calls a Lab service under the injected runtime
// `authorize`. A thrown `Forbidden` (a denied capability, a minor without
// `platform_participation`, a wrong-chapter caller, a minor resolving) maps to an
// opaque 403 with no reason (respond.ts). The minor `feed.view`/`feed.post` gate,
// the `moderation.resolve` age gate, and the feed read-logging all live in the
// services / registry — these controllers add no bespoke permission logic.
//
//   viewFeed          GET    /api/lab/feed                         (feed.view)
//   createPost        POST   /api/lab/posts                        (feed.post)
//   editPost          PATCH  /api/lab/posts/:id                    (feed.post own)
//   createComment     POST   /api/lab/posts/:id/comments           (feed.comment)
//   addReaction       POST   /api/lab/{posts,comments}/:id/reactions   (feed.react)
//   removeReaction    DELETE /api/lab/{posts,comments}/:id/reactions   (feed.react)
//   fileReport        POST   /api/lab/reports                      (feed.report)
//   hidePost          POST   /api/lab/posts/:id/hide       (feed.moderate | feed.hide_safety)
//   removePost        POST   /api/lab/posts/:id/remove             (feed.moderate)
//   moderationQueue   GET    /api/lab/moderation/queue             (feed.moderate)
//   transitionReport  POST   /api/lab/moderation/:id/{ack,resolve,escalate}
//                                              (feed.moderate / moderation.resolve)
// -------------------------------------------------------------------------

import {
  PostService,
  CommentService,
  ReactionService,
  FeedService,
  ModerationService,
  type AuthoredPostType,
  type CreatePostResult,
  type EditPostResult,
  type CreateCommentResult,
  type AddReactionResult,
  type RemoveReactionResult,
  type ContentStatusResult,
  type HideSafetyResult,
  type FeedFilters,
  type FeedViewResult,
  type FileReportResult,
  type AcknowledgeResult,
  type ResolveResult,
  type EscalateResult,
  type ModerationClass,
  type ModerationReason,
  type ModerationAction,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { ValidationError, optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

// ---- validation tables (mirror the service / DB enums) --------------------

const AUTHORED_POST_TYPES: readonly AuthoredPostType[] = [
  'wip',
  'finished_project',
  'question',
  'session_recap',
]
const REACTION_TARGET_TYPES = ['post', 'comment'] as const
const MODERATION_CLASSES: readonly ModerationClass[] = ['safety', 'ordinary']
const MODERATION_REASONS: readonly ModerationReason[] = [
  'harmful',
  'sexual',
  'threatening',
  'self_harm_disclosure',
  'off_topic',
  'unkind',
  'spam',
  'quality',
]
const MODERATION_ACTIONS: readonly ModerationAction[] = [
  'none',
  'hidden',
  'removed',
  'dismissed',
  'escalated',
]

type ReactionTargetType = (typeof REACTION_TARGET_TYPES)[number]

/** Parse an optional integer query param, or `undefined` when absent/invalid. */
function optInt(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// ---- Feed read ------------------------------------------------------------

export interface ViewFeedInput extends AuthedInputBase {
  /** The parsed query string (searchParams flattened to a record). */
  query: Record<string, string | null | undefined>
}

/** GET /api/lab/feed — the scoped feed read with filters (feed.view). */
export function viewFeed(input: ViewFeedInput): Promise<ControllerResult<FeedViewResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const q = input.query ?? {}
    const filters: FeedFilters = {
      chapterId: reqStr(q.chapterId, 'chapterId'),
      podId: optStr(q.podId),
      type: q.type ? String(q.type) : undefined,
      authorMembershipId: q.authorMembershipId ? String(q.authorMembershipId) : undefined,
      limit: optInt(q.limit),
      offset: optInt(q.offset),
      includeHidden: q.includeHidden === 'true' || q.includeHidden === '1',
    }
    const result = await new FeedService({ sql, authorize }).view(ctx, filters)
    return { status: 200, body: result }
  })
}

// ---- Posts ----------------------------------------------------------------

export interface CreatePostInputHttp extends AuthedInputBase {
  body: { chapterId?: unknown; podId?: unknown; type?: unknown; body?: unknown }
}

/** POST /api/lab/posts — create a member-authored post (feed.post). */
export function createPost(input: CreatePostInputHttp): Promise<ControllerResult<CreatePostResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(input.body?.chapterId, 'chapterId')
    const type = reqStr(input.body?.type, 'type')
    if (!AUTHORED_POST_TYPES.includes(type as AuthoredPostType)) {
      // `milestone` (and any unknown type) is not a member-authored type.
      throw new ValidationError(`invalid post type: ${type}`)
    }
    const body = reqStr(input.body?.body, 'body')
    const podId = optStr(input.body?.podId)
    const result = await new PostService({ sql, authorize }).create(
      { chapterId, podId, type: type as AuthoredPostType, body },
      ctx,
    )
    return { status: 201, body: result }
  })
}

export interface EditPostInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { body?: unknown }
}

/** PATCH /api/lab/posts/:id — edit own post body (feed.post, own). */
export function editPost(input: EditPostInput): Promise<ControllerResult<EditPostResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const postId = reqStr(input.params?.id, 'id')
    const body = reqStr(input.body?.body, 'body')
    const result = await new PostService({ sql, authorize }).edit(postId, body, ctx)
    return { status: 200, body: result }
  })
}

export interface PostIdInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/lab/posts/:id/remove — remove a post (feed.moderate; blanks body). */
export function removePost(input: PostIdInput): Promise<ControllerResult<ContentStatusResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const postId = reqStr(input.params?.id, 'id')
    const result = await new PostService({ sql, authorize }).remove(postId, ctx)
    return { status: 200, body: result }
  })
}

export interface HidePostInput extends AuthedInputBase {
  params: { id?: unknown }
  body?: { safety?: unknown; reason?: unknown }
}

/**
 * POST /api/lab/posts/:id/hide — hide a post. Default is the `feed.moderate` hide
 * (`published -> hidden`, reversible). With `{ safety: true }` it is the
 * `feed.hide_safety` on-sight hide (any chapter instructor, not pod-bound), which
 * hides and auto-files a `class = safety` report atomically.
 */
export function hidePost(
  input: HidePostInput,
): Promise<ControllerResult<ContentStatusResult | HideSafetyResult>> {
  return runAuthed<ContentStatusResult | HideSafetyResult>(input, async (ctx, sql) => {
    const postId = reqStr(input.params?.id, 'id')
    const svc = new PostService({ sql, authorize })
    if (input.body?.safety === true) {
      const reason = optStr(input.body?.reason)
      if (reason !== null && !MODERATION_REASONS.includes(reason as ModerationReason)) {
        throw new ValidationError(`invalid moderation reason: ${reason}`)
      }
      const result = await svc.hideSafety(
        postId,
        ctx,
        reason !== null ? { reason: reason as ModerationReason } : {},
      )
      return { status: 200, body: result }
    }
    const result = await svc.hide(postId, ctx)
    return { status: 200, body: result }
  })
}

// ---- Comments -------------------------------------------------------------

export interface CreateCommentInputHttp extends AuthedInputBase {
  params: { id?: unknown }
  body: { body?: unknown }
}

/** POST /api/lab/posts/:id/comments — comment on a post (feed.comment). */
export function createComment(
  input: CreateCommentInputHttp,
): Promise<ControllerResult<CreateCommentResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const postId = reqStr(input.params?.id, 'id')
    const body = reqStr(input.body?.body, 'body')
    const result = await new CommentService({ sql, authorize }).create(postId, { body }, ctx)
    return { status: 201, body: result }
  })
}

// ---- Reactions ------------------------------------------------------------

export interface ReactionInput extends AuthedInputBase {
  /** Which target table the route addresses (`posts` vs `comments`). */
  targetType: ReactionTargetType
  params: { id?: unknown }
  body: { kind?: unknown }
}

function reactionTarget(input: ReactionInput): { type: ReactionTargetType; id: string; kind: string } {
  const type = input.targetType
  if (!REACTION_TARGET_TYPES.includes(type)) {
    throw new ValidationError(`invalid reaction target type: ${type}`)
  }
  return { type, id: reqStr(input.params?.id, 'id'), kind: reqStr(input.body?.kind, 'kind') }
}

/** POST /api/lab/{posts,comments}/:id/reactions — react (feed.react). */
export function addReaction(input: ReactionInput): Promise<ControllerResult<AddReactionResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const t = reactionTarget(input)
    const result = await new ReactionService({ sql, authorize }).add(
      { type: t.type, id: t.id },
      t.kind,
      ctx,
    )
    return { status: 201, body: result }
  })
}

/** DELETE /api/lab/{posts,comments}/:id/reactions — unreact (feed.react). */
export function removeReaction(
  input: ReactionInput,
): Promise<ControllerResult<RemoveReactionResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const t = reactionTarget(input)
    const result = await new ReactionService({ sql, authorize }).remove(
      { type: t.type, id: t.id },
      t.kind,
      ctx,
    )
    return { status: 200, body: result }
  })
}

// ---- Moderation -----------------------------------------------------------

export interface FileReportInputHttp extends AuthedInputBase {
  body: {
    targetType?: unknown
    targetId?: unknown
    class?: unknown
    reason?: unknown
    note?: unknown
  }
}

/** POST /api/lab/reports — file a moderation report (feed.report). */
export function fileReport(input: FileReportInputHttp): Promise<ControllerResult<FileReportResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const targetType = reqStr(input.body?.targetType, 'targetType')
    if (!REACTION_TARGET_TYPES.includes(targetType as ReactionTargetType)) {
      throw new ValidationError(`invalid report target type: ${targetType}`)
    }
    const targetId = reqStr(input.body?.targetId, 'targetId')
    const klass = reqStr(input.body?.class, 'class')
    if (!MODERATION_CLASSES.includes(klass as ModerationClass)) {
      throw new ValidationError(`invalid report class: ${klass}`)
    }
    const reason = reqStr(input.body?.reason, 'reason')
    if (!MODERATION_REASONS.includes(reason as ModerationReason)) {
      throw new ValidationError(`invalid report reason: ${reason}`)
    }
    const result = await new ModerationService({ sql, authorize }).fileReport(
      {
        target: { type: targetType as ReactionTargetType, id: targetId },
        class: klass as ModerationClass,
        reason: reason as ModerationReason,
        note: optStr(input.body?.note),
      },
      ctx,
    )
    return { status: 201, body: result }
  })
}

/** One report-queue row: unresolved, ordered by SLA due time. */
export interface ModerationQueueRow {
  reportId: string
  targetType: string
  targetId: string
  class: ModerationClass
  reason: string
  dueAt: Date
  filedAt: Date
  acknowledgedAt: Date | null
  escalatedAt: Date | null
}
export interface ModerationQueueResult {
  reports: ModerationQueueRow[]
}

export interface ModerationQueueInput extends AuthedInputBase {
  query: Record<string, string | null | undefined>
}

/**
 * GET /api/lab/moderation/queue — the unresolved report queue for a chapter,
 * ordered by `due_at` (feed.moderate). No ModerationService read method exists,
 * so this authorizes `feed.moderate` against the chapter (a deny writes one
 * permission.denied and throws Forbidden -> opaque 403) then reads directly.
 */
export function moderationQueue(
  input: ModerationQueueInput,
): Promise<ControllerResult<ModerationQueueResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const chapterId = reqStr(input.query?.chapterId, 'chapterId')
    await authorize(ctx, 'feed.moderate', { chapter_id: chapterId }, { sql })
    const rows = await sql`
      select id, target_type, target_id, class, reason, due_at, filed_at, acknowledged_at, escalated_at
      from moderation_report
      where chapter_id = ${chapterId} and resolved_at is null
      order by due_at asc
    `
    const reports: ModerationQueueRow[] = rows.map((r) => ({
      reportId: r.id as string,
      targetType: r.target_type as string,
      targetId: r.target_id as string,
      class: r.class as ModerationClass,
      reason: r.reason as string,
      dueAt: r.due_at as Date,
      filedAt: r.filed_at as Date,
      acknowledgedAt: (r.acknowledged_at as Date | null) ?? null,
      escalatedAt: (r.escalated_at as Date | null) ?? null,
    }))
    return { status: 200, body: { reports } }
  })
}

export type ReportAction = 'ack' | 'resolve' | 'escalate'

export interface TransitionReportInput extends AuthedInputBase {
  /** The lifecycle edge, from the route path (`ack` | `resolve` | `escalate`). */
  action: ReportAction
  params: { id?: unknown }
  body?: { action?: unknown }
}

/**
 * POST /api/lab/moderation/:id/{ack,resolve,escalate} — the report lifecycle.
 * `resolve` carries `moderation.resolve` (age >= 18); the other edges carry
 * `feed.moderate`. The action for `resolve` (the ModerationAction taken) comes
 * from the body.
 */
export function transitionReport(
  input: TransitionReportInput,
): Promise<ControllerResult<AcknowledgeResult | ResolveResult | EscalateResult>> {
  return runAuthed<AcknowledgeResult | ResolveResult | EscalateResult>(input, async (ctx, sql) => {
    const reportId = reqStr(input.params?.id, 'id')
    const svc = new ModerationService({ sql, authorize })
    switch (input.action) {
      case 'ack':
        return { status: 200, body: await svc.acknowledge(reportId, ctx) }
      case 'escalate':
        return { status: 200, body: await svc.escalate(reportId, ctx) }
      case 'resolve': {
        const action = reqStr(input.body?.action, 'action')
        if (!MODERATION_ACTIONS.includes(action as ModerationAction)) {
          throw new ValidationError(`invalid moderation action: ${action}`)
        }
        return { status: 200, body: await svc.resolve(reportId, ctx, action as ModerationAction) }
      }
      default:
        throw new ValidationError(`unknown report action: ${String(input.action)}`)
    }
  })
}
