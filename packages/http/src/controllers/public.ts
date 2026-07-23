// -------------------------------------------------------------------------
// Public funnel controllers (Milestone 1 parts A/B).
//
//   submitLead            POST /api/public/apply        — unauthenticated, inert.
//   startStage2           POST /api/ops/leads/:id/start-stage2 — staff (lead.invite).
//   saveParentSection     POST /api/public/stage2/parent   — 2A, parent token.
//   saveStudentSection    POST /api/public/stage2/student  — 2B, student token.
//   reviewStage2          POST /api/public/stage2/review   — 2C, parent token.
//   submitStage2          POST /api/public/stage2/submit   — 2C, parent token.
//   sendBack              POST /api/public/stage2/send-back — 2C -> 2B, parent token.
//
// The token-gated ops carry NO AuthContext: the opaque parent/student token is
// the only gate (Stage2Service does the timing-safe compare). start is the one
// staff-gated op, so it goes through runAuthed.
// -------------------------------------------------------------------------

import {
  LeadService,
  Stage2Service,
  type Answers,
  type ReviewStage2Result,
  type SaveParentSectionResult,
  type StartStage2Result,
  type SubmitLeadResult,
  type SubmitStage2Result,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed, runPublic } from '../run.js'
import { reqObj, reqStr, optStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult, PublicInputBase } from '../types.js'

// ---- Stage 1 --------------------------------------------------------------

export interface SubmitLeadInput extends PublicInputBase {
  body: { email?: unknown; chapterId?: unknown; referralSource?: unknown }
}

/** POST /api/public/apply — the unauthenticated, inert Stage 1 lead write. */
export function submitLead(input: SubmitLeadInput): Promise<ControllerResult<SubmitLeadResult>> {
  return runPublic(async () => {
    const email = reqStr(input.body?.email, 'email')
    const referralSource = reqStr(input.body?.referralSource, 'referralSource')
    const chapterId = optStr(input.body?.chapterId)
    const result = await new LeadService({ sql: input.sql }).submitLead({
      email,
      chapterId,
      referralSource,
    })
    return { status: 201, body: result }
  })
}

// ---- Stage 2 --------------------------------------------------------------

export interface StartStage2Input extends AuthedInputBase {
  params: { leadId?: unknown }
}

/** POST /api/ops/leads/:id/start-stage2 — staff-gated (lead.invite). */
export function startStage2(input: StartStage2Input): Promise<ControllerResult<StartStage2Result>> {
  return runAuthed(input, async (ctx, sql) => {
    const leadId = reqStr(input.params?.leadId, 'leadId')
    const result = await new Stage2Service({ sql, authorize }).startStage2(leadId, ctx)
    return { status: 201, body: result }
  })
}

export interface Stage2TokenBodyInput extends PublicInputBase {
  body: { token?: unknown; answers?: unknown }
}

/** POST /api/public/stage2/parent — 2A save (parent token); issues the student token. */
export function saveParentSection(
  input: Stage2TokenBodyInput,
): Promise<ControllerResult<SaveParentSectionResult>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const answers = reqObj(input.body?.answers, 'answers') as Answers
    const result = await new Stage2Service({ sql: input.sql, authorize }).saveParentSection(
      token,
      answers,
    )
    return { status: 200, body: result }
  })
}

/** POST /api/public/stage2/student — 2B save (student token); saves, does not submit. */
export function saveStudentSection(
  input: Stage2TokenBodyInput,
): Promise<ControllerResult<{ saved: true }>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const answers = reqObj(input.body?.answers, 'answers') as Answers
    await new Stage2Service({ sql: input.sql, authorize }).saveStudentSection(token, answers)
    return { status: 200, body: { saved: true } }
  })
}

export interface Stage2ReviewInput extends PublicInputBase {
  body: { token?: unknown }
}

/** POST /api/public/stage2/review — 2C read-only view (parent token). */
export function reviewStage2(
  input: Stage2ReviewInput,
): Promise<ControllerResult<ReviewStage2Result>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const result = await new Stage2Service({ sql: input.sql, authorize }).reviewStage2(token)
    return { status: 200, body: result }
  })
}

/** POST /api/public/stage2/submit — 2C submit (parent token only); mints the application. */
export function submitStage2(
  input: Stage2ReviewInput,
): Promise<ControllerResult<SubmitStage2Result>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const result = await new Stage2Service({ sql: input.sql, authorize }).submitStage2(token)
    return { status: 201, body: result }
  })
}

/** POST /api/public/stage2/send-back — 2C -> 2B (parent token). */
export function sendBack(input: Stage2ReviewInput): Promise<ControllerResult<{ sentBack: true }>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    await new Stage2Service({ sql: input.sql, authorize }).sendBack(token)
    return { status: 200, body: { sentBack: true } }
  })
}
