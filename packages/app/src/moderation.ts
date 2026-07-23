// -------------------------------------------------------------------------
// The Lab — moderation services (Milestone 2.4). The ModerationService (file /
// acknowledge / resolve / escalate a `moderation_report`) and the
// `sweepOverdueReports` job body.
//
// Authorization (03-authorization.md): every mutation is gated through the
// injected `authorize` wrapper over the pure `can`.
//   - fileReport      -> `feed.report`   (any chapter/pod participant; NOT
//                        pod-bound to the target; no consent gate)
//   - acknowledge     -> `feed.moderate` (a moderator picks the report up)
//   - resolve         -> `moderation.resolve` (carries `actorCondition age >= 18`,
//                        so a minor mentor is denied `actor_condition_failed`)
//   - escalate        -> `feed.moderate` (a moderator escalates by hand)
// Every mutation runs under the `assertAuthorized()` repository-write backstop.
//
// Lifecycle (04-state-machines.md): the report has NO status column — its state
// is derived from the lifecycle timestamps (`filed` -> `acknowledged` set
// `acknowledged_at`; `resolved` sets `resolved_at`+`action_taken`; `escalated`
// reachable from any pre-resolution state sets `escalated_at`). Edge legality is
// checked with the pure `canTransition('moderation_report', ...)`; the actor's
// permission to take the edge is the capability above via `authorize`.
//
// The SLA (`due_at`) is the generated column (24h for `safety`, 72h for
// `ordinary`); "SLA met" is `resolved_at <= due_at`, returned on resolve and
// queryable. A `safety` filing warrants immediate escalation to the Chapter
// Director — modelled here as a documented `notifier` seam (no mailer in this
// layer). The escalation job body escalates any `resolved_at IS NULL AND due_at <
// now AND escalated_at IS NULL`; a stale `safety` report (an unresponsive
// Director) targets `platform_admin`, an `ordinary` one the Chapter Director.
//
// Framework-agnostic: the db handle, `authorize`, and the notifier are injected;
// the HTTP routes (M2.6) and the job scheduling (a go-live step) are wired later.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { canTransition } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import {
  CommentNotFoundError,
  IllegalModerationTransitionError,
  ModerationReportNotFoundError,
  PostNotFoundError,
} from './errors.js'

/** The moderation report classes and the reason taxonomy (mirror the DB enums). */
export type ModerationClass = 'safety' | 'ordinary'
export type ModerationReason =
  | 'harmful'
  | 'sexual'
  | 'threatening'
  | 'self_harm_disclosure'
  | 'off_topic'
  | 'unkind'
  | 'spam'
  | 'quality'
export type ModerationAction = 'none' | 'hidden' | 'removed' | 'dismissed' | 'escalated'

/** The derived lifecycle state of a report (there is no status column). */
export type ModerationState = 'filed' | 'acknowledged' | 'resolved' | 'escalated'

/**
 * The injected `authorize` dependency, narrowed to the moderation capabilities
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP).
 */
export type ModerationAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'feed.report' | 'feed.moderate' | 'moderation.resolve',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

/**
 * The escalation/notification seam (04-state-machines.md: a `safety` filing
 * "notifies the Chapter Director immediately"; escalation "notifies the
 * escalation target"). No mailer here — a caller wires a concrete notifier at
 * the edge. Defaults to a no-op.
 */
export type ModerationNotification =
  | { kind: 'safety_report_filed'; reportId: string; chapterId: string; targetType: string; targetId: string }
  | { kind: 'report_escalated'; reportId: string; chapterId: string; escalatedTo: string | null; class: ModerationClass }
export type ModerationNotifier = (event: ModerationNotification) => void | Promise<void>

export interface ModerationServiceDeps {
  sql: Sql
  authorize: ModerationAuthorizeFn
  /** The documented notification seam. Defaults to a no-op. */
  notifier?: ModerationNotifier
}

/** A report target: a post or a comment (the two M2-wired target types). */
export interface ModerationTarget {
  type: 'post' | 'comment'
  id: string
}

export interface FileReportInput {
  target: ModerationTarget
  class: ModerationClass
  reason: ModerationReason
  note?: string | null
}

export interface FileReportResult {
  reportId: string
  status: 'filed'
  class: ModerationClass
  dueAt: Date
}

export interface AcknowledgeResult {
  reportId: string
  status: 'acknowledged'
}

export interface ResolveResult {
  reportId: string
  status: 'resolved'
  actionTaken: ModerationAction
  slaMet: boolean
}

export interface EscalateResult {
  reportId: string
  status: 'escalated'
  escalatedTo: string | null
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

interface ReportRow {
  chapterId: string
  class: ModerationClass
  filedAt: Date
  acknowledgedAt: Date | null
  resolvedAt: Date | null
  escalatedAt: Date | null
}

/** Derive the lifecycle state from the timestamps (there is no status column). */
function reportState(r: {
  acknowledgedAt: Date | null
  resolvedAt: Date | null
  escalatedAt: Date | null
}): ModerationState {
  if (r.resolvedAt !== null) return 'resolved'
  if (r.escalatedAt !== null) return 'escalated'
  if (r.acknowledgedAt !== null) return 'acknowledged'
  return 'filed'
}

/**
 * Resolve the target content's chapter/pod, so `feed.report` authorizes against
 * the same chapter/pod scope the feed write path uses. A comment scopes to its
 * post's chapter/pod.
 */
async function loadTargetScope(
  sql: Sql,
  target: ModerationTarget,
): Promise<{ chapterId: string; podId: string | null }> {
  if (target.type === 'post') {
    const [row] = await sql`select chapter_id, pod_id from post where id = ${target.id}`
    if (row === undefined) throw new PostNotFoundError(target.id)
    return { chapterId: row.chapter_id as string, podId: (row.pod_id as string | null) ?? null }
  }
  const [row] = await sql`
    select p.chapter_id, p.pod_id from comment c join post p on p.id = c.post_id where c.id = ${target.id}
  `
  if (row === undefined) throw new CommentNotFoundError(target.id)
  return { chapterId: row.chapter_id as string, podId: (row.pod_id as string | null) ?? null }
}

/** The actor's active membership row id in `chapterId`, or null (a platform actor). */
async function resolveResolverMembership(
  sql: Sql | TransactionSql,
  accountId: string,
  chapterId: string,
): Promise<string | null> {
  const [row] = await sql`
    select id from membership
    where account_id = ${accountId} and chapter_id = ${chapterId} and status = 'active'
    order by created_at desc limit 1
  `
  return row === undefined ? null : (row.id as string)
}

/**
 * The escalation target account for a report: a `safety` report whose Chapter
 * Director was the (now unresponsive) immediate responder escalates to a
 * `platform_admin`; an `ordinary` report escalates to the Chapter Director. May
 * be null if no such active membership exists (the notifier seam surfaces that).
 */
async function resolveEscalationTarget(
  sql: Sql | TransactionSql,
  chapterId: string,
  klass: ModerationClass,
): Promise<string | null> {
  if (klass === 'safety') {
    const [row] = await sql`
      select account_id from membership where role = 'platform_admin' and status = 'active'
      order by created_at asc limit 1
    `
    return row === undefined ? null : (row.account_id as string)
  }
  const [row] = await sql`
    select account_id from membership
    where chapter_id = ${chapterId} and role = 'chapter_director' and status = 'active'
    order by created_at asc limit 1
  `
  return row === undefined ? null : (row.account_id as string)
}

// ---------------------------------------------------------------------------
// ModerationService.
// ---------------------------------------------------------------------------

export class ModerationService {
  private readonly sql: Sql
  private readonly authorize: ModerationAuthorizeFn
  private readonly notifier: ModerationNotifier

  constructor(deps: ModerationServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.notifier = deps.notifier ?? ((): void => undefined)
  }

  private async loadReport(reportId: string): Promise<ReportRow> {
    const [row] = await this.sql`
      select chapter_id, class, filed_at, acknowledged_at, resolved_at, escalated_at
      from moderation_report where id = ${reportId}
    `
    if (row === undefined) throw new ModerationReportNotFoundError(reportId)
    return {
      chapterId: row.chapter_id as string,
      class: row.class as ModerationClass,
      filedAt: row.filed_at as Date,
      acknowledgedAt: (row.acknowledged_at as Date | null) ?? null,
      resolvedAt: (row.resolved_at as Date | null) ?? null,
      escalatedAt: (row.escalated_at as Date | null) ?? null,
    }
  }

  /**
   * File a report against a post/comment (`feed.report`). Authorized against the
   * target's chapter/pod (any participant, not pod-bound, no consent gate). The
   * `class` drives the SLA via the generated `due_at`. The reporter is the
   * actor's account (accounts, to accommodate platform actors). A `safety` filing
   * fires the documented escalation notification seam.
   */
  async fileReport(input: FileReportInput, ctx: AuthContext): Promise<FileReportResult> {
    const scope = await loadTargetScope(this.sql, input.target)
    const resource: Resource = {
      id: input.target.id,
      chapter_id: scope.chapterId,
      pod_id: scope.podId,
      reportClass: input.class,
    }
    await this.authorize(ctx, 'feed.report', resource, { sql: this.sql })

    const result = (await this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        insert into moderation_report (
          target_type, target_id, reporter_account_id, chapter_id, class, reason, note
        ) values (
          ${input.target.type}, ${input.target.id}, ${ctx.account.id}, ${scope.chapterId},
          ${input.class}, ${input.reason}, ${input.note ?? null}
        ) returning id, due_at
      `
      return { reportId: row!.id as string, dueAt: row!.due_at as Date }
    })) as { reportId: string; dueAt: Date }

    if (input.class === 'safety') {
      await this.notifier({
        kind: 'safety_report_filed',
        reportId: result.reportId,
        chapterId: scope.chapterId,
        targetType: input.target.type,
        targetId: input.target.id,
      })
    }

    return { reportId: result.reportId, status: 'filed', class: input.class, dueAt: result.dueAt }
  }

  /** Acknowledge a report (`feed.moderate`; `filed -> acknowledged`; sets acknowledged_at). */
  async acknowledge(reportId: string, ctx: AuthContext): Promise<AcknowledgeResult> {
    const report = await this.loadReport(reportId)
    const resource: Resource = { id: reportId, chapter_id: report.chapterId }
    await this.authorize(ctx, 'feed.moderate', resource, { sql: this.sql })

    const from = reportState(report)
    const legal = canTransition('moderation_report', from, 'acknowledged')
    if (!legal.allowed) throw new IllegalModerationTransitionError(from, 'acknowledged', legal.reason)

    await this.sql.begin(async (tx) => {
      assertAuthorized()
      await tx`update moderation_report set acknowledged_at = now() where id = ${reportId}`
    })
    return { reportId, status: 'acknowledged' }
  }

  /**
   * Resolve a report (`moderation.resolve`, which carries `actorCondition age >=
   * 18`, so a minor mentor is denied). Legal from `acknowledged` or `escalated`.
   * Sets `resolved_at`, `action_taken`, and the resolver account + membership
   * (membership when the resolver has one). Returns whether the SLA was met
   * (`resolved_at <= due_at`).
   */
  async resolve(reportId: string, ctx: AuthContext, action: ModerationAction): Promise<ResolveResult> {
    const report = await this.loadReport(reportId)
    const resource: Resource = { id: reportId, chapter_id: report.chapterId }
    await this.authorize(ctx, 'moderation.resolve', resource, { sql: this.sql })

    const from = reportState(report)
    const legal = canTransition('moderation_report', from, 'resolved')
    if (!legal.allowed) throw new IllegalModerationTransitionError(from, 'resolved', legal.reason)

    const membershipId = await resolveResolverMembership(this.sql, ctx.account.id, report.chapterId)

    const slaMet = (await this.sql.begin(async (tx) => {
      assertAuthorized()
      const [row] = await tx`
        update moderation_report
        set resolved_at = now(), action_taken = ${action},
            resolver_account_id = ${ctx.account.id}, resolver_membership_id = ${membershipId}
        where id = ${reportId}
        returning (resolved_at <= due_at) as sla_met
      `
      return row!.sla_met as boolean
    })) as boolean

    return { reportId, status: 'resolved', actionTaken: action, slaMet }
  }

  /**
   * Escalate a report by hand (`feed.moderate`; `filed`/`acknowledged` ->
   * `escalated`). Sets `escalated_at` and the escalation target account (a
   * `safety` report to `platform_admin`, an `ordinary` one to the Chapter
   * Director), and fires the notification seam.
   */
  async escalate(reportId: string, ctx: AuthContext): Promise<EscalateResult> {
    const report = await this.loadReport(reportId)
    const resource: Resource = { id: reportId, chapter_id: report.chapterId }
    await this.authorize(ctx, 'feed.moderate', resource, { sql: this.sql })

    const from = reportState(report)
    const legal = canTransition('moderation_report', from, 'escalated')
    if (!legal.allowed) throw new IllegalModerationTransitionError(from, 'escalated', legal.reason)

    const escalatedTo = await resolveEscalationTarget(this.sql, report.chapterId, report.class)
    await this.sql.begin(async (tx) => {
      assertAuthorized()
      await tx`update moderation_report set escalated_at = now(), escalated_to = ${escalatedTo} where id = ${reportId}`
    })
    await this.notifier({
      kind: 'report_escalated',
      reportId,
      chapterId: report.chapterId,
      escalatedTo,
      class: report.class,
    })
    return { reportId, status: 'escalated', escalatedTo }
  }
}

// ---------------------------------------------------------------------------
// The escalation job body (scheduling is a go-live wiring step).
// ---------------------------------------------------------------------------

export interface SweepOverdueReportsDeps {
  sql: Sql
  /** The documented notification seam. Defaults to a no-op. */
  notifier?: ModerationNotifier
}

export interface SweepOverdueReportsResult {
  escalated: Array<{ reportId: string; class: ModerationClass; escalatedTo: string | null }>
}

/**
 * The timer job body (04-state-machines.md "Moderation report"): escalate every
 * report where `resolved_at IS NULL AND due_at < now AND escalated_at IS NULL`,
 * setting `escalated_at` and the escalation target (a `safety` report — an
 * unresponsive Chapter Director — to `platform_admin`; an `ordinary` one to the
 * Chapter Director) and firing the notification seam. Scheduling is wired at
 * go-live; this is the pure job body, callable with an explicit `now` for tests.
 */
export async function sweepOverdueReports(
  deps: SweepOverdueReportsDeps,
  now: Date = new Date(),
): Promise<SweepOverdueReportsResult> {
  const notifier = deps.notifier ?? ((): void => undefined)
  const escalated = (await deps.sql.begin(async (tx) => {
    const overdue = await tx`
      select id, chapter_id, class from moderation_report
      where resolved_at is null and escalated_at is null and due_at < ${now}
      order by due_at asc
    `
    const out: Array<{ reportId: string; class: ModerationClass; escalatedTo: string | null }> = []
    for (const r of overdue) {
      const chapterId = r.chapter_id as string
      const klass = r.class as ModerationClass
      const escalatedTo = await resolveEscalationTarget(tx, chapterId, klass)
      await tx`
        update moderation_report set escalated_at = ${now}, escalated_to = ${escalatedTo} where id = ${r.id as string}
      `
      out.push({ reportId: r.id as string, class: klass, escalatedTo })
    }
    return out
  })) as Array<{ reportId: string; class: ModerationClass; escalatedTo: string | null }>

  for (const e of escalated) {
    // Fire notifications after the transaction commits (a failed notify must not
    // roll back a completed escalation).
    const [row] = await deps.sql`select chapter_id from moderation_report where id = ${e.reportId}`
    await notifier({
      kind: 'report_escalated',
      reportId: e.reportId,
      chapterId: (row?.chapter_id as string) ?? '',
      escalatedTo: e.escalatedTo,
      class: e.class,
    })
  }

  return { escalated }
}
