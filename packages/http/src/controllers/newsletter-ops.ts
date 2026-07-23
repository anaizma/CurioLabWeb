// -------------------------------------------------------------------------
// Newsletter ops controllers (05-api-surface.md "Operations back office": POST
// /ops/newsletter, PATCH, /:id/{submit,schedule,publish,unpublish}). Each
// resolves the session to an AuthContext and calls NewsletterService under
// `authorize` (drafting is WIDE, publishing NARROW + coupling E consent gate).
//
//   draftNewsletter     POST  /api/ops/newsletter            (newsletter.draft)
//   editNewsletter      PATCH /api/ops/newsletter/:id        (newsletter.draft, draft-only body edit)
//   submitNewsletter    POST  /api/ops/newsletter/:id/submit    (newsletter.submit_review)
//   scheduleNewsletter  POST  /api/ops/newsletter/:id/schedule  (newsletter.schedule)
//   publishNewsletter   POST  /api/ops/newsletter/:id/publish   (newsletter.publish, coupling E)
//   unpublishNewsletter POST  /api/ops/newsletter/:id/unpublish (newsletter.unpublish)
//
// NewsletterService exposes no title/body edit method (M3.7 forbids changing
// services), so editNewsletter authorizes `newsletter.draft` over the registry —
// the SAME single-code-path primitive the service uses for a draft write — and
// then applies a guarded draft-only UPDATE under the runtime write backstop.
// -------------------------------------------------------------------------

import {
  NewsletterService,
  NewsletterIssueNotFoundError,
  IllegalNewsletterTransitionError,
  type CreateNewsletterInput,
  type NewsletterItemInput,
  type NewsletterResult,
} from '@curiolab/app'
import type { Resource } from '@curiolab/core'
import { assertAuthorized, authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { ValidationError, optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

// ---- Draft ----------------------------------------------------------------

export interface DraftNewsletterInput extends AuthedInputBase {
  body: { chapterId?: unknown; title?: unknown; body?: unknown; items?: unknown }
}

/** Parse the optional items array; each item is `{ authorStudentAccountId?, ref?, body }`. */
function parseItems(raw: unknown): NewsletterItemInput[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) throw new ValidationError('items must be an array')
  return raw.map((it) => {
    if (it === null || typeof it !== 'object') throw new ValidationError('invalid item')
    const r = it as Record<string, unknown>
    return {
      authorStudentAccountId: optStr(r.authorStudentAccountId),
      ref: optStr(r.ref),
      body: reqStr(r.body, 'items[].body'),
    }
  })
}

/** POST /api/ops/newsletter — draft a new issue (newsletter.draft). */
export function draftNewsletter(
  input: DraftNewsletterInput,
): Promise<ControllerResult<NewsletterResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const create: CreateNewsletterInput = {
      chapterId: optStr(input.body?.chapterId),
      title: reqStr(input.body?.title, 'title'),
      body: reqStr(input.body?.body, 'body'),
      items: parseItems(input.body?.items),
    }
    const result = await new NewsletterService({ sql, authorize }).draft(create, ctx)
    return { status: 201, body: result }
  })
}

// ---- Edit (draft-only body/title) -----------------------------------------

export interface EditNewsletterInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { title?: unknown; body?: unknown }
}

/**
 * PATCH /api/ops/newsletter/:id — a draft-only title/body edit. Authorizes
 * `newsletter.draft` over the issue's chapter, then applies a guarded UPDATE
 * (only while `draft`) under the write backstop. A non-draft issue is a 409.
 */
export function editNewsletter(
  input: EditNewsletterInput,
): Promise<ControllerResult<NewsletterResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const issueId = reqStr(input.params?.id, 'id')
    const title = optStr(input.body?.title)
    const body = optStr(input.body?.body)
    if (title === null && body === null) throw new ValidationError('nothing to edit')

    const [issue] = await sql`select chapter_id, status from newsletter_issue where id = ${issueId}`
    if (issue === undefined) throw new NewsletterIssueNotFoundError(issueId)
    const chapterId = (issue.chapter_id as string | null) ?? null
    const status = issue.status as string

    const resource: Resource = { id: issueId, chapter_id: chapterId }
    await authorize(ctx, 'newsletter.draft', resource, { sql })

    return sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const rows = await tx`
        update newsletter_issue
        set title = coalesce(${title}, title), body = coalesce(${body}, body)
        where id = ${issueId} and status = 'draft'
        returning id, status
      `
      if (rows.length === 0) throw new IllegalNewsletterTransitionError(status, 'draft', 'illegal_transition')
      return { status: 200, body: { issueId, status: rows[0]!.status as string } }
    }) as Promise<ControllerResult<NewsletterResult>>
  })
}

// ---- Lifecycle actions ----------------------------------------------------

export interface NewsletterIdInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/ops/newsletter/:id/submit — draft -> in_review (newsletter.submit_review). */
export function submitNewsletter(input: NewsletterIdInput): Promise<ControllerResult<NewsletterResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const issueId = reqStr(input.params?.id, 'id')
    const result = await new NewsletterService({ sql, authorize }).submitReview(issueId, ctx)
    return { status: 200, body: result }
  })
}

export interface ScheduleNewsletterInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { scheduledFor?: unknown }
}

/** POST /api/ops/newsletter/:id/schedule — in_review -> scheduled (newsletter.schedule). */
export function scheduleNewsletter(
  input: ScheduleNewsletterInput,
): Promise<ControllerResult<NewsletterResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const issueId = reqStr(input.params?.id, 'id')
    const scheduledFor = new Date(reqStr(input.body?.scheduledFor, 'scheduledFor'))
    if (Number.isNaN(scheduledFor.getTime())) throw new ValidationError('invalid scheduledFor')
    const result = await new NewsletterService({ sql, authorize }).schedule(issueId, ctx, scheduledFor)
    return { status: 200, body: result }
  })
}

/** POST /api/ops/newsletter/:id/publish — scheduled -> published (newsletter.publish, coupling E). */
export function publishNewsletter(input: NewsletterIdInput): Promise<ControllerResult<NewsletterResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const issueId = reqStr(input.params?.id, 'id')
    const result = await new NewsletterService({ sql, authorize }).publish(issueId, ctx)
    return { status: 200, body: result }
  })
}

/** POST /api/ops/newsletter/:id/unpublish — published -> archived (newsletter.unpublish). */
export function unpublishNewsletter(input: NewsletterIdInput): Promise<ControllerResult<NewsletterResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const issueId = reqStr(input.params?.id, 'id')
    const result = await new NewsletterService({ sql, authorize }).unpublish(issueId, ctx)
    return { status: 200, body: result }
  })
}
