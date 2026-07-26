import type { Sql } from 'postgres'
import { canTransition, type AuthContext, type Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { writeApplicationEvent, type EventWriter } from './events.js'
import {
  ApplicationNotFoundError,
  IllegalTransitionError,
  InvalidInterviewDateError,
} from './errors.js'

/**
 * The injected `authorize` dependency. Structurally the runtime `authorize`
 * wrapper, taken by injection so the service is testable without HTTP and so
 * the deny/backstop paths can be exercised with a stub.
 */
export type AuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'application.view' | 'application.transition',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ApplicationServiceDeps {
  sql: Sql
  authorize: AuthorizeFn
  /** Injectable event-append seam (defaults to the real insert). */
  eventWriter?: EventWriter
}

export type ApplicationKind = 'student' | 'university_role'

/** An ops-transition request against an existing application. */
export interface TransitionInput {
  applicationId: string
  note?: string | null
  /**
   * scheduleInterview only: the scheduled slot (a Date or an ISO string) and its
   * location. Both optional — a director may flip to interview_scheduled and fill
   * the slot in later; when `interviewAt` is provided it is validated as a real
   * timestamp. Ignored by the other transitions.
   */
  interviewAt?: Date | string
  interviewLocation?: string | null
}

export interface TransitionOutcome {
  applicationId: string
  from: string
  to: string
}

export interface ReopenOutcome {
  /** The new successor application (status `submitted`). */
  applicationId: string
  /** The declined application it was reopened from (left immutable). */
  reopenedFromId: string
}

interface ApplicationRow {
  id: string
  status: string
  chapterId: string
}

export class ApplicationService {
  private readonly sql: Sql
  private readonly authorize: AuthorizeFn
  private readonly eventWriter: EventWriter

  constructor(deps: ApplicationServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.eventWriter = deps.eventWriter ?? writeApplicationEvent
  }

  // NOTE: the old public `submitApplication` write is GONE. The public surface
  // is now Stage 1 lead capture (`LeadService.createLead`), which creates an
  // `application_lead`, never an `application`. The `application` row is created
  // only at 2C submit (part B). This service now owns only the ops transitions
  // below, which operate on an `application` once it exists.

  // ---- Ops transitions (PATCH /ops/applications/:id) -----------------------
  // Each is gated through the injected `authorize` wrapper under
  // `application.transition`, validates legality with `canTransition`, and
  // writes an `application_event` atomically with the status change.

  /** submitted -> screening. */
  screen(ctx: AuthContext, input: TransitionInput): Promise<TransitionOutcome> {
    return this.applyTransition(ctx, input, 'screening')
  }

  /**
   * screening -> interview_scheduled, capturing the interview slot. `interviewAt`
   * (Date or ISO string) and `interviewLocation` are optional; when `interviewAt`
   * is given it is validated as a real timestamp BEFORE any write (an unparseable
   * value throws InvalidInterviewDateError, leaving status unchanged). A reschedule
   * is this same action setting a new time. The slot is written in the same
   * transaction as the status flip and the event.
   */
  scheduleInterview(ctx: AuthContext, input: TransitionInput): Promise<TransitionOutcome> {
    const interviewAt = normalizeInterviewAt(input.interviewAt)
    const interviewLocation = input.interviewLocation ?? null
    return this.applyTransition(ctx, input, 'interview_scheduled', { interviewAt, interviewLocation })
  }

  /** interview_scheduled -> accepted. */
  accept(ctx: AuthContext, input: TransitionInput): Promise<TransitionOutcome> {
    return this.applyTransition(ctx, input, 'accepted')
  }

  /** any active stage -> declined. */
  decline(ctx: AuthContext, input: TransitionInput): Promise<TransitionOutcome> {
    return this.applyTransition(ctx, input, 'declined')
  }

  /** any active stage -> withdrawn (terminal). */
  withdraw(ctx: AuthContext, input: TransitionInput): Promise<TransitionOutcome> {
    return this.applyTransition(ctx, input, 'withdrawn')
  }

  /**
   * Reopen a declined application. Mints a SUCCESSOR row in `submitted` with
   * `reopened_from_id` pointing at the declined row; the declined row stays
   * immutable (06-onboarding-flows / 02-data-model). The `declined -> submitted`
   * edge is the legality check; a non-declined application is rejected.
   */
  async reopen(ctx: AuthContext, input: TransitionInput): Promise<ReopenOutcome> {
    const declined = await this.load(input.applicationId)
    const legal = canTransition('application', declined.status, 'submitted')
    if (!legal.allowed) {
      throw new IllegalTransitionError(declined.status, 'submitted', legal.reason)
    }

    const resource: Resource = { id: declined.id, chapter_id: declined.chapterId }
    await this.authorize(ctx, 'application.transition', resource, { sql: this.sql })

    let successorId = ''
    await this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [full] = await tx`select * from application where id = ${declined.id}`
      const [succ] = await tx`
        insert into application (
          kind, chapter_id, status, applicant_name, applicant_contact_email,
          guardian_name, guardian_email, guardian_signature_ref, track, github_url,
          reopened_from_id
        ) values (
          ${full!.kind}, ${full!.chapter_id}, 'submitted', ${full!.applicant_name},
          ${full!.applicant_contact_email}, ${full!.guardian_name}, ${full!.guardian_email},
          ${full!.guardian_signature_ref}, ${full!.track}, ${full!.github_url},
          ${declined.id}
        ) returning id
      `
      successorId = succ!.id as string
      await this.eventWriter(tx, {
        applicationId: successorId,
        fromStatus: null,
        toStatus: 'submitted',
        actorId: ctx.account.id,
        note: input.note ?? `reopened from ${declined.id}`,
      })
    })

    return { applicationId: successorId, reopenedFromId: declined.id }
  }

  /**
   * Dismiss a duplicate-applicant flag (a director's manual "not a duplicate"
   * decision). Gated on `application.transition` (chapter-scoped), same as the
   * transitions above. Stamps duplicate_cleared_at/by; leaves
   * duplicate_flagged_at/duplicate_of_application_id intact as the audit
   * trail. NOT a status change: `status` is untouched and no
   * `application_event` is written (that would corrupt the current-status
   * "Date" column). Harmless no-op (columns just get overwritten) if the
   * application was never flagged.
   */
  async clearDuplicateFlag(ctx: AuthContext, input: TransitionInput): Promise<{ applicationId: string }> {
    const app = await this.load(input.applicationId)
    const resource: Resource = { id: app.id, chapter_id: app.chapterId }
    await this.authorize(ctx, 'application.transition', resource, { sql: this.sql })
    await this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      await tx`
        update application
        set duplicate_cleared_at = now(), duplicate_cleared_by = ${ctx.account.id}
        where id = ${app.id}
      `
    })
    return { applicationId: app.id }
  }

  private async applyTransition(
    ctx: AuthContext,
    input: TransitionInput,
    to: string,
    interview?: { interviewAt: Date | null; interviewLocation: string | null },
  ): Promise<TransitionOutcome> {
    const app = await this.load(input.applicationId)

    // 1. Legality: is `from -> to` a legal edge of the application lifecycle?
    const legal = canTransition('application', app.status, to)
    if (!legal.allowed) {
      throw new IllegalTransitionError(app.status, to, legal.reason)
    }

    // 2. Authorization: gated through the injected `authorize` wrapper. On deny
    // it writes one permission.denied audit row and throws an opaque Forbidden.
    const resource: Resource = { id: app.id, chapter_id: app.chapterId }
    await this.authorize(ctx, 'application.transition', resource, { sql: this.sql })

    // 3. Atomic: the status change (and, for scheduleInterview, the interview
    // slot) and the event insert commit together.
    await this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      if (interview !== undefined) {
        await tx`
          update application
          set status = ${to},
              interview_at = ${interview.interviewAt},
              interview_location = ${interview.interviewLocation}
          where id = ${app.id}
        `
      } else {
        await tx`update application set status = ${to} where id = ${app.id}`
      }
      await this.eventWriter(tx, {
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: to,
        actorId: ctx.account.id,
        note: input.note ?? null,
      })
    })

    return { applicationId: app.id, from: app.status, to }
  }

  private async load(applicationId: string): Promise<ApplicationRow> {
    const [row] = await this.sql`
      select id, status, chapter_id from application where id = ${applicationId}
    `
    if (row === undefined) throw new ApplicationNotFoundError(applicationId)
    return { id: row.id as string, status: row.status as string, chapterId: row.chapter_id as string }
  }
}

/**
 * Normalize an optional `interviewAt` (Date or ISO string) to a Date, or null
 * when absent. A provided-but-unparseable value throws InvalidInterviewDateError
 * (validated as a real timestamp before any write).
 */
function normalizeInterviewAt(value: Date | string | undefined): Date | null {
  if (value === undefined || value === null) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) throw new InvalidInterviewDateError(value)
  return d
}
