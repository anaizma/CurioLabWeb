// -------------------------------------------------------------------------
// NewsletterService — Milestone 3.5: the newsletter_issue lifecycle service and
// coupling E (publish re-checks each student item's external_publication consent,
// atomically; the send is enqueued only after commit).
//
// Lifecycle (04-state-machines newsletter_issue): draft -> in_review ->
// scheduled -> published -> archived, plus scheduled -> blocked (a consent
// re-check failed) and the blocked retries. Each edge is validated with the pure
// `canTransition('newsletter_issue', ...)` and gated through the injected
// `authorize` wrapper over `can`:
//
//   - draft         `newsletter.draft`         (instructor/comms/director) -> `draft`;
//   - submitReview  `newsletter.submit_review`  (drafter)  `draft -> in_review`;
//   - returnToDraft `newsletter.return`         (director) `in_review -> draft`;
//   - schedule      `newsletter.schedule`       (director) `in_review -> scheduled`,
//                                               recording scheduled_for;
//   - publish       `newsletter.publish`        (director; or platform_staff for a
//                                               zero-student issue) `scheduled ->
//                                               published` — coupling E;
//   - unblock       `newsletter.return` / `newsletter.schedule` (director)
//                                               `blocked -> in_review / scheduled`;
//   - unpublish     `newsletter.unpublish`      (director/admin) `published ->
//                                               archived`, redacting the affected
//                                               item on a consent-driven unpublish.
//
// Coupling E (04-state-machines): the consent verification (under a FOR UPDATE
// lock on each student item's `consent_current` row) and the status change are
// ONE transaction; the send is enqueued only AFTER commit. `publish` hydrates
// each student item's external_publication snapshot (scoped to the ISSUE) onto
// the resource BEFORE `authorize` — so a DIRECT publish with a missing/absent
// item consent is DENIED by `can` (subject_consent_missing / _unknown) exactly
// like project.publishPublic — then RE-checks it under the row lock inside the
// publish transaction (a concurrent revoke blocks on that row, so a send never
// goes out for revoked work). The enqueue is a documented seam (no mailer here).
//
// runScheduledNewsletters is the system auto-publish job (no actor, so it does
// NOT go through `authorize`): for each due scheduled issue it re-checks consent
// at that instant under the same row lock — success -> published, failure ->
// blocked and a notify seam naming the student whose consent stopped it.
//
// Read policy (02-data-model): only `published` is readable without a session and
// `archived` is staff-read only. This service adds no read method (reads land
// with the M3.7 HTTP layer); any reader must enforce that policy.
//
// Framework-agnostic: the db handle, `authorize`, and the notify/enqueue seams
// are injected; the HTTP routes (M3.7) and subscribers/webhooks (M3.6) are later.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource, StudentAuthoredItem } from '@curiolab/core'
import { can, canTransition } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import {
  IllegalNewsletterTransitionError,
  NewsletterIssueNotFoundError,
  NewsletterPublishConsentChangedError,
} from './errors.js'

/** The body a student-authored item is redacted to on a consent-driven unpublish. */
export const REDACTED_NEWSLETTER_ITEM_BODY = '[redacted: publication consent withdrawn]'

/** The newsletter lifecycle capabilities this service gates through `authorize`. */
export type NewsletterCapability =
  | 'newsletter.draft'
  | 'newsletter.submit_review'
  | 'newsletter.return'
  | 'newsletter.schedule'
  | 'newsletter.publish'
  | 'newsletter.unpublish'

/**
 * The injected `authorize` dependency, narrowed to this service's capabilities
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type NewsletterAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: NewsletterCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

/**
 * The send seam (coupling E: "the send is enqueued only after commit"). No mailer
 * here — a caller wires the concrete enqueue at the edge (M3.6 subscribers). Fired
 * AFTER the publish transaction commits, so a failed enqueue never unpublishes.
 */
export type EnqueueSend = (issueId: string) => void | Promise<void>

/**
 * The notify seam for the scheduled-job block path (04-state-machines
 * "scheduled -> blocked | ... | director notified with the specific student
 * whose consent stopped it"). No mailer here; defaults to a no-op.
 */
export type NewsletterNotification = {
  kind: 'issue_blocked'
  issueId: string
  chapterId: string | null
  student: string
}
export type NewsletterNotifier = (event: NewsletterNotification) => void | Promise<void>

export interface NewsletterServiceDeps {
  sql: Sql
  authorize: NewsletterAuthorizeFn
  /** The enqueue-after-commit send seam (coupling E). Defaults to a no-op. */
  enqueueSend?: EnqueueSend
}

export interface NewsletterItemInput {
  /** Null = a staff-written item; non-null = a student-authored item (consent-gated). */
  authorStudentAccountId?: string | null
  /** The project/post this item points at. */
  ref?: string | null
  body: string
}

export interface CreateNewsletterInput {
  /** Null = platform-wide (only reachable by platform_admin via platformGrant). */
  chapterId?: string | null
  title: string
  body: string
  items?: NewsletterItemInput[]
}

export interface NewsletterResult {
  issueId: string
  status: string
}

/** The unblock target: back to review, or straight back onto the schedule. */
export type UnblockTarget = 'in_review' | 'scheduled'

export interface UnpublishOptions {
  /**
   * When the unpublish is driven by an `external_publication` revocation, the
   * student whose consent was withdrawn — that student's item bodies are redacted
   * in the SAME transaction as the archive (extends coupling C2). Omit for a plain
   * director/admin unpublish.
   */
  consentRevokedStudentAccountId?: string | null
}

interface IssueItemRow {
  authorStudentAccountId: string | null
}

interface IssueRow {
  id: string
  chapterId: string | null
  status: string
  items: IssueItemRow[]
}

export class NewsletterService {
  private readonly sql: Sql
  private readonly authorize: NewsletterAuthorizeFn
  private readonly enqueueSend: EnqueueSend | undefined

  constructor(deps: NewsletterServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.enqueueSend = deps.enqueueSend
  }

  private async load(issueId: string): Promise<IssueRow> {
    const [row] = await this.sql`
      select id, chapter_id, status from newsletter_issue where id = ${issueId}
    `
    if (row === undefined) throw new NewsletterIssueNotFoundError(issueId)
    const items = await this.sql`
      select author_student_account_id from newsletter_item where issue_id = ${issueId} order by created_at asc
    `
    return {
      id: row.id as string,
      chapterId: (row.chapter_id as string | null) ?? null,
      status: row.status as string,
      items: items.map((it) => ({
        authorStudentAccountId: (it.author_student_account_id as string | null) ?? null,
      })),
    }
  }

  /**
   * Hydrate each student-authored item's external_publication snapshot (scoped to
   * the ISSUE) onto the resource, so `can`'s subjectConsent gate reads it (absent
   * -> subject_consent_unknown, inactive/mismatched -> subject_consent_missing).
   * When `lock` is set the `consent_current` rows are taken FOR UPDATE — the
   * coupling-E serialization point inside the publish transaction. `can` never
   * fetches; the repository hydrates.
   */
  private async buildPublishResource(
    db: Sql | TransactionSql,
    issue: IssueRow,
    lock: boolean,
  ): Promise<Resource> {
    const studentAuthoredItems: StudentAuthoredItem[] = []
    for (const it of issue.items) {
      if (it.authorStudentAccountId == null) continue
      const student = it.authorStudentAccountId
      const rows = lock
        ? await db`
            select active, scope_ref from consent_current
            where student_account_id = ${student} and type = 'external_publication'
            for update
          `
        : await db`
            select active, scope_ref from consent_current
            where student_account_id = ${student} and type = 'external_publication'
          `
      const snap = rows[0]
      studentAuthoredItems.push({
        student,
        consent:
          snap === undefined
            ? {}
            : {
                external_publication: {
                  active: snap.active as boolean,
                  scopeRef: (snap.scope_ref as string | null) ?? null,
                },
              },
      })
    }
    return { id: issue.id, chapter_id: issue.chapterId, studentAuthoredItems }
  }

  /** Legality of the edge itself (independent of the actor), via the pure guard. */
  private assertLegal(from: string, to: string): void {
    const legal = canTransition('newsletter_issue', from, to)
    if (!legal.allowed) {
      throw new IllegalNewsletterTransitionError(from, to, legal.reason)
    }
  }

  /**
   * Create a draft issue (`newsletter.draft`, chapter-scoped: instructor, comms,
   * or director), optionally with items. A student-authored item carries a
   * non-null `author_student_account_id`; that is what the publish gate later
   * requires consent for. Platform-wide (chapterId null) is reachable only by a
   * platform_admin (platformGrant).
   */
  async draft(input: CreateNewsletterInput, ctx: AuthContext): Promise<NewsletterResult> {
    const resource: Resource = { chapter_id: input.chapterId ?? null }
    await this.authorize(ctx, 'newsletter.draft', resource, { sql: this.sql })

    const items = input.items ?? []
    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [row] = await tx`
        insert into newsletter_issue (chapter_id, title, body)
        values (${input.chapterId ?? null}, ${input.title}, ${input.body})
        returning id, status
      `
      const issueId = row!.id as string
      for (const item of items) {
        await tx`
          insert into newsletter_item (issue_id, author_student_account_id, ref, body)
          values (${issueId}, ${item.authorStudentAccountId ?? null}, ${item.ref ?? null}, ${item.body})
        `
      }
      return { issueId, status: row!.status as string }
    }) as Promise<NewsletterResult>
  }

  /** Submit for review (`newsletter.submit_review`, drafter; `draft -> in_review`). */
  async submitReview(issueId: string, ctx: AuthContext): Promise<NewsletterResult> {
    const issue = await this.load(issueId)
    await this.authorize(ctx, 'newsletter.submit_review', this.scopeResource(issue), { sql: this.sql })
    this.assertLegal(issue.status, 'in_review')
    return this.applyStatus(issueId, issue.status, 'in_review', 'draft')
  }

  /** Return to draft (`newsletter.return`, director; `in_review -> draft`). */
  async returnToDraft(issueId: string, ctx: AuthContext): Promise<NewsletterResult> {
    const issue = await this.load(issueId)
    await this.authorize(ctx, 'newsletter.return', this.scopeResource(issue), { sql: this.sql })
    this.assertLegal(issue.status, 'draft')
    return this.applyStatus(issueId, issue.status, 'draft', 'in_review')
  }

  /**
   * Schedule (`newsletter.schedule`, director; `in_review -> scheduled`), recording
   * the send time. The auto-publish job (`runScheduledNewsletters`) fires when
   * scheduled_for <= now.
   */
  async schedule(issueId: string, ctx: AuthContext, scheduledFor: Date): Promise<NewsletterResult> {
    const issue = await this.load(issueId)
    await this.authorize(ctx, 'newsletter.schedule', this.scopeResource(issue), { sql: this.sql })
    this.assertLegal(issue.status, 'scheduled')
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update newsletter_issue set status = 'scheduled', scheduled_for = ${scheduledFor}
        where id = ${issueId} and status = 'in_review'
        returning id
      `
      if (rows.length === 0) {
        throw new IllegalNewsletterTransitionError(issue.status, 'scheduled', 'illegal_transition')
      }
      return { issueId, status: 'scheduled' }
    }) as Promise<NewsletterResult>
  }

  /**
   * Retry a blocked issue (`newsletter.return` -> in_review, or `newsletter.schedule`
   * -> scheduled), after consent is obtained. `scheduledFor` is required for the
   * scheduled target.
   */
  async unblock(
    issueId: string,
    ctx: AuthContext,
    target: UnblockTarget,
    scheduledFor?: Date,
  ): Promise<NewsletterResult> {
    const issue = await this.load(issueId)
    const capability = target === 'in_review' ? 'newsletter.return' : 'newsletter.schedule'
    await this.authorize(ctx, capability, this.scopeResource(issue), { sql: this.sql })
    this.assertLegal(issue.status, target)
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows =
        target === 'scheduled'
          ? await tx`
              update newsletter_issue set status = 'scheduled', scheduled_for = ${scheduledFor ?? null}
              where id = ${issueId} and status = 'blocked'
              returning id
            `
          : await tx`
              update newsletter_issue set status = 'in_review'
              where id = ${issueId} and status = 'blocked'
              returning id
            `
      if (rows.length === 0) {
        throw new IllegalNewsletterTransitionError(issue.status, target, 'illegal_transition')
      }
      return { issueId, status: target }
    }) as Promise<NewsletterResult>
  }

  /**
   * Publish (`newsletter.publish`, director; or platform_staff for a zero-student
   * issue). Coupling E: the per-item external_publication snapshot (scoped to the
   * issue) is hydrated BEFORE `authorize`, so a direct publish with a missing item
   * consent is DENIED by `can`; then, inside ONE transaction, each student item's
   * `consent_current` row is taken FOR UPDATE and the check is RE-run (a concurrent
   * revoke blocks on that row). On success `scheduled -> published`, stamping
   * `published_by`/`published_at`; the send is enqueued AFTER commit.
   */
  async publish(issueId: string, ctx: AuthContext): Promise<NewsletterResult> {
    const issue = await this.load(issueId)
    const resource = await this.buildPublishResource(this.sql, issue, false)
    await this.authorize(ctx, 'newsletter.publish', resource, { sql: this.sql })

    this.assertLegal(issue.status, 'published')
    await this.sql.begin(async (tx) => {
      assertAuthorized()
      // Coupling-E serialization point: lock each student item's consent_current
      // row and RE-verify through the same pure `can` (no audit — this is the
      // post-lock re-check, not a fresh authorization).
      const locked = await this.buildPublishResource(tx, issue, true)
      const recheck = can(ctx, 'newsletter.publish', locked)
      if (!recheck.allowed) {
        throw new NewsletterPublishConsentChangedError(issueId, recheck.reason)
      }
      const rows = await tx`
        update newsletter_issue
        set status = 'published', published_by = ${ctx.account.id}, published_at = now()
        where id = ${issueId} and status = 'scheduled'
        returning id
      `
      if (rows.length === 0) {
        throw new IllegalNewsletterTransitionError(issue.status, 'published', 'illegal_transition')
      }
    })

    // Enqueue-after-commit seam (coupling E): only once the status change committed.
    if (this.enqueueSend !== undefined) await this.enqueueSend(issueId)
    return { issueId, status: 'published' }
  }

  /**
   * Unpublish (`newsletter.unpublish`, director/admin; `published -> archived`).
   * Archived issues are staff-read only. When driven by a consent revocation
   * (`consentRevokedStudentAccountId`), the affected student's item bodies are
   * redacted in the SAME transaction as the archive (extends coupling C2).
   */
  async unpublish(
    issueId: string,
    ctx: AuthContext,
    opts: UnpublishOptions = {},
  ): Promise<NewsletterResult> {
    const issue = await this.load(issueId)
    await this.authorize(ctx, 'newsletter.unpublish', this.scopeResource(issue), { sql: this.sql })
    this.assertLegal(issue.status, 'archived')
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update newsletter_issue set status = 'archived'
        where id = ${issueId} and status = 'published'
        returning id
      `
      if (rows.length === 0) {
        throw new IllegalNewsletterTransitionError(issue.status, 'archived', 'illegal_transition')
      }
      if (opts.consentRevokedStudentAccountId != null) {
        await tx`
          update newsletter_item set body = ${REDACTED_NEWSLETTER_ITEM_BODY}
          where issue_id = ${issueId} and author_student_account_id = ${opts.consentRevokedStudentAccountId}
        `
      }
      return { issueId, status: 'archived' }
    }) as Promise<NewsletterResult>
  }

  /** The chapter-scoped resource for the non-consent lifecycle edges. */
  private scopeResource(issue: IssueRow): Resource {
    return { id: issue.id, chapter_id: issue.chapterId }
  }

  /** Apply a plain status change under the write backstop, guarded by `from`. */
  private applyStatus(
    issueId: string,
    observed: string,
    to: string,
    guardFrom: string,
  ): Promise<NewsletterResult> {
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update newsletter_issue set status = ${to}
        where id = ${issueId} and status = ${guardFrom}
        returning id
      `
      if (rows.length === 0) {
        throw new IllegalNewsletterTransitionError(observed, to, 'illegal_transition')
      }
      return { issueId, status: to }
    }) as Promise<NewsletterResult>
  }
}

// ---------------------------------------------------------------------------
// The system auto-publish job (scheduling is a go-live wiring step).
// ---------------------------------------------------------------------------

export interface RunScheduledNewslettersDeps {
  sql: Sql
  /** The enqueue-after-commit send seam. Defaults to a no-op. */
  enqueueSend?: EnqueueSend
  /** The block notify seam. Defaults to a no-op. */
  notifier?: NewsletterNotifier
}

export interface RunScheduledNewslettersResult {
  published: string[]
  blocked: Array<{ issueId: string; student: string }>
}

/**
 * The system auto-publish job (04-state-machines: "scheduled -> published |
 * ... | system at the scheduled time", and "scheduled -> blocked | consent
 * re-check fails | system"). For each issue whose `scheduled_for <= now`, it
 * re-checks each student item's `external_publication` consent (scoped to the
 * issue) at that instant under a FOR UPDATE lock (coupling E): all consented ->
 * `published`; the first missing -> `blocked` and a notify naming that student.
 * No actor -> NOT through `authorize`; it is a system job. Scheduling is wired at
 * go-live; this is the pure job body, callable with an explicit `now` for tests.
 */
export async function runScheduledNewsletters(
  deps: RunScheduledNewslettersDeps,
  now: Date = new Date(),
): Promise<RunScheduledNewslettersResult> {
  const due = await deps.sql`
    select id, chapter_id from newsletter_issue
    where status = 'scheduled' and scheduled_for is not null and scheduled_for <= ${now}
    order by scheduled_for asc
  `

  const published: string[] = []
  const blocked: Array<{ issueId: string; student: string; chapterId: string | null }> = []

  for (const issue of due) {
    const issueId = issue.id as string
    const chapterId = (issue.chapter_id as string | null) ?? null

    const outcome = (await deps.sql.begin(async (tx) => {
      // Distinct student authors of this issue; lock each consent_current row.
      const students = await tx`
        select distinct author_student_account_id as student from newsletter_item
        where issue_id = ${issueId} and author_student_account_id is not null
      `
      let failing: string | null = null
      for (const s of students) {
        const student = s.student as string
        const [cur] = await tx`
          select active, scope_ref from consent_current
          where student_account_id = ${student} and type = 'external_publication'
          for update
        `
        const consented =
          cur !== undefined && cur.active === true && (cur.scope_ref as string | null) === issueId
        if (!consented) {
          failing = student
          break
        }
      }
      if (failing === null) {
        await tx`
          update newsletter_issue set status = 'published', published_at = ${now}
          where id = ${issueId} and status = 'scheduled'
        `
        return { kind: 'published' as const }
      }
      await tx`
        update newsletter_issue set status = 'blocked'
        where id = ${issueId} and status = 'scheduled'
      `
      return { kind: 'blocked' as const, student: failing }
    })) as { kind: 'published' } | { kind: 'blocked'; student: string }

    if (outcome.kind === 'published') {
      published.push(issueId)
    } else {
      blocked.push({ issueId, student: outcome.student, chapterId })
    }
  }

  // After-commit seams: enqueue sends and fire block notifications. A failed
  // seam must not roll back a completed status change, so they run post-commit.
  for (const id of published) {
    if (deps.enqueueSend !== undefined) await deps.enqueueSend(id)
  }
  for (const b of blocked) {
    if (deps.notifier !== undefined) {
      await deps.notifier({ kind: 'issue_blocked', issueId: b.issueId, chapterId: b.chapterId, student: b.student })
    }
  }

  return {
    published,
    blocked: blocked.map((b) => ({ issueId: b.issueId, student: b.student })),
  }
}
