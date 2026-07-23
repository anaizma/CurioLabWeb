// -------------------------------------------------------------------------
// Ops back-office controllers (05-api-surface.md "Operations back office").
// Every mutation resolves a chapter_director (or platform grant) session to an
// AuthContext and calls its service under `authorize`; a deny surfaces as an
// opaque 403 with one permission.denied audit row (owned by the runtime layer).
//
//   transitionApplication  PATCH /api/ops/applications/:id   (application.transition)
//   createEnrollment       POST  /api/ops/enrollments        (enrollment.create)
//   issueInvite            POST  /api/ops/invites            (member.invite)
//   resendInvite           POST  /api/ops/invites/:id/resend (member.invite)
//   verifyGuardianship     POST  /api/ops/guardianships/:id/verify (guardianship.verify)
//   activateMembership     POST  /api/ops/memberships/:id/activate (member.activate)
//   reviewDeletion         POST  /api/ops/deletion-requests/:id/review  (deletion.review)
//   fulfillDeletion        POST  /api/ops/deletion-requests/:id/fulfill (deletion.fulfill)
//   fulfillExport          POST  /api/ops/export-requests/:id/fulfill   (export.fulfill)
// -------------------------------------------------------------------------

import {
  ApplicationService,
  DeletionFulfillmentService,
  EnrollmentService,
  ExportFulfillmentService,
  GuardianshipService,
  InMemoryStorageAdapter,
  InviteService,
  MembershipActivationService,
  type CreateEnrollmentResult,
  type DeletionOutcome,
  type FulfillDeletionResult,
  type FulfillExportResult,
  type InviteKind,
  type IssueInviteResult,
  type ActivateStudentResult,
  type ReviewDeletionResult,
  type StorageAdapter,
  type VerifyGuardianshipResult,
  type GuardianVerificationMethod,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { ValidationError, optStr, reqObj, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

// ---- Application transitions ----------------------------------------------

export interface ApplicationTransitionBody {
  applicationId: string
  from?: string
  to?: string
  reopenedFromId?: string
}

export interface TransitionApplicationInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { action?: unknown; note?: unknown }
}

/** PATCH /api/ops/applications/:id — a lifecycle transition (incl. reopen). */
export function transitionApplication(
  input: TransitionApplicationInput,
): Promise<ControllerResult<ApplicationTransitionBody>> {
  return runAuthed<ApplicationTransitionBody>(input, async (ctx, sql) => {
    const applicationId = reqStr(input.params?.id, 'id')
    const action = reqStr(input.body?.action, 'action')
    const note = optStr(input.body?.note)
    const svc = new ApplicationService({ sql, authorize })
    const tinput = { applicationId, note }

    if (action === 'reopen') {
      const r = await svc.reopen(ctx, tinput)
      return {
        status: 201,
        body: { applicationId: r.applicationId, reopenedFromId: r.reopenedFromId },
      }
    }

    let outcome
    switch (action) {
      case 'screen':
        outcome = await svc.screen(ctx, tinput)
        break
      case 'schedule-interview':
      case 'scheduleInterview':
        outcome = await svc.scheduleInterview(ctx, tinput)
        break
      case 'accept':
        outcome = await svc.accept(ctx, tinput)
        break
      case 'decline':
        outcome = await svc.decline(ctx, tinput)
        break
      case 'withdraw':
        outcome = await svc.withdraw(ctx, tinput)
        break
      default:
        throw new ValidationError(`unknown application action: ${action}`)
    }
    return {
      status: 200,
      body: { applicationId: outcome.applicationId, from: outcome.from, to: outcome.to },
    }
  })
}

// ---- Enrollment -----------------------------------------------------------

export interface CreateEnrollmentInput extends AuthedInputBase {
  body: {
    applicationId?: unknown
    studentAccountId?: unknown
    dateOfBirth?: unknown
    chapterId?: unknown
    termId?: unknown
    guardianNameOnForm?: unknown
    signatureDate?: unknown
    signedForm?: unknown
  }
  /** Injectable storage backend; defaults to an in-memory adapter (delivery deferred). */
  storage?: StorageAdapter
}

/** POST /api/ops/enrollments — coupling D (enrollment.create). */
export function createEnrollment(
  input: CreateEnrollmentInput,
): Promise<ControllerResult<CreateEnrollmentResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const b = input.body
    const form = reqObj(b?.signedForm, 'signedForm')
    const svc = new EnrollmentService({
      sql,
      authorize,
      storage: input.storage ?? new InMemoryStorageAdapter(),
    })
    const result = await svc.createEnrollment(
      {
        applicationId: reqStr(b?.applicationId, 'applicationId'),
        studentAccountId: optStr(b?.studentAccountId),
        dateOfBirth: b?.dateOfBirth == null ? undefined : String(b.dateOfBirth),
        chapterId: reqStr(b?.chapterId, 'chapterId'),
        termId: reqStr(b?.termId, 'termId'),
        guardianNameOnForm: reqStr(b?.guardianNameOnForm, 'guardianNameOnForm'),
        signatureDate: new Date(reqStr(b?.signatureDate, 'signatureDate')),
        signedForm: {
          body: reqStr(form.body, 'signedForm.body'),
          contentType: optStr(form.contentType) ?? undefined,
          key: optStr(form.key) ?? undefined,
        },
      },
      ctx,
    )
    return { status: 201, body: result }
  })
}

// ---- Invites --------------------------------------------------------------

const INVITE_KINDS: readonly InviteKind[] = ['guardian', 'student', 'mentor', 'staff']

export interface IssueInviteInput extends AuthedInputBase {
  body: {
    kind?: unknown
    chapterId?: unknown
    targetEmail?: unknown
    enrollmentRecordId?: unknown
    intendedAccountId?: unknown
  }
}

/** POST /api/ops/invites — issue an invite (member.invite). */
export function issueInvite(input: IssueInviteInput): Promise<ControllerResult<IssueInviteResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const kind = reqStr(input.body?.kind, 'kind') as InviteKind
    if (!INVITE_KINDS.includes(kind)) throw new ValidationError(`unknown invite kind: ${kind}`)
    const result = await new InviteService({ sql, authorize }).issueInvite(
      {
        kind,
        chapterId: reqStr(input.body?.chapterId, 'chapterId'),
        targetEmail: optStr(input.body?.targetEmail),
        enrollmentRecordId: optStr(input.body?.enrollmentRecordId),
        intendedAccountId: optStr(input.body?.intendedAccountId),
      },
      ctx,
    )
    return { status: 201, body: result }
  })
}

export interface ResendInviteInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/ops/invites/:id/resend — supersede + reissue (member.invite). */
export function resendInvite(
  input: ResendInviteInput,
): Promise<ControllerResult<IssueInviteResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const inviteId = reqStr(input.params?.id, 'id')
    const result = await new InviteService({ sql, authorize }).resendInvite(inviteId, ctx)
    return { status: 201, body: result }
  })
}

// ---- Guardianship verify --------------------------------------------------

export interface VerifyGuardianshipInput extends AuthedInputBase {
  params: { id?: unknown }
  body?: { verificationMethod?: unknown }
}

/** POST /api/ops/guardianships/:id/verify — the name-match authority floor. */
export function verifyGuardianship(
  input: VerifyGuardianshipInput,
): Promise<ControllerResult<VerifyGuardianshipResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const guardianshipId = reqStr(input.params?.id, 'id')
    const method = optStr(input.body?.verificationMethod)
    const result = await new GuardianshipService({ sql, authorize }).verifyGuardianship(
      guardianshipId,
      ctx,
      method ? { verificationMethod: method as GuardianVerificationMethod } : {},
    )
    return { status: 200, body: result }
  })
}

// ---- Membership activation ------------------------------------------------

export interface ActivateMembershipInput extends AuthedInputBase {
  params: { id?: unknown }
  body?: { note?: unknown }
}

/** POST /api/ops/memberships/:id/activate — couplings A + F. */
export function activateMembership(
  input: ActivateMembershipInput,
): Promise<ControllerResult<ActivateStudentResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const membershipId = reqStr(input.params?.id, 'id')
    const result = await new MembershipActivationService({ sql, authorize }).activateStudent(
      membershipId,
      ctx,
      { note: optStr(input.body?.note) },
    )
    return { status: 200, body: result }
  })
}

// ---- Deletion review / fulfillment ----------------------------------------

export interface DeletionRequestInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/ops/deletion-requests/:id/review — requested -> under_review. */
export function reviewDeletion(
  input: DeletionRequestInput,
): Promise<ControllerResult<ReviewDeletionResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const requestId = reqStr(input.params?.id, 'id')
    const result = await new DeletionFulfillmentService({ sql, authorize }).reviewDeletion(
      requestId,
      ctx,
    )
    return { status: 200, body: result }
  })
}

export interface FulfillDeletionInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { decision?: unknown; decisionReason?: unknown }
}

/** POST /api/ops/deletion-requests/:id/fulfill — apply the tiered review outcome. */
export function fulfillDeletion(
  input: FulfillDeletionInput,
): Promise<ControllerResult<FulfillDeletionResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const requestId = reqStr(input.params?.id, 'id')
    const decision = reqStr(input.body?.decision, 'decision')
    let outcome: DeletionOutcome
    switch (decision) {
      case 'full':
        outcome = { decision: 'full' }
        break
      case 'redaction':
        outcome = { decision: 'redaction' }
        break
      case 'refused':
        outcome = { decision: 'refused', decisionReason: optStr(input.body?.decisionReason) }
        break
      case 'partial':
        outcome = { decision: 'partial', decisionReason: reqStr(input.body?.decisionReason, 'decisionReason') }
        break
      default:
        throw new ValidationError(`unknown deletion decision: ${decision}`)
    }
    const result = await new DeletionFulfillmentService({ sql, authorize }).fulfillDeletion(
      requestId,
      ctx,
      outcome,
    )
    return { status: 200, body: result }
  })
}

// ---- Export fulfillment ---------------------------------------------------

export interface FulfillExportInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/ops/export-requests/:id/fulfill — assemble the review-right bundle. */
export function fulfillExport(
  input: FulfillExportInput,
): Promise<ControllerResult<FulfillExportResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const requestId = reqStr(input.params?.id, 'id')
    const result = await new ExportFulfillmentService({ sql, authorize }).fulfillExport(
      requestId,
      ctx,
    )
    return { status: 200, body: result }
  })
}
