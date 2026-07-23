// -------------------------------------------------------------------------
// Public funnel controllers — the Stage 2 token-gated chain (design §7.2/§8).
//
//   startStage2           POST /api/public/stage2/start    — consumes the lead token.
//   saveParentSection     POST /api/public/stage2/parent   — 2A, parent token.
//   saveStudentSection    POST /api/public/stage2/student  — 2B, student token.
//   reviewStage2          POST /api/public/stage2/review   — 2C, parent token.
//   submitStage2          POST /api/public/stage2/submit   — 2C, parent token.
//   sendBack              POST /api/public/stage2/send-back — 2C -> 2B, parent token.
//
// Every op is UNAUTHENTICATED and token-gated: the opaque parent/student token is
// the only gate (Stage2Service does the timing-safe compare). The Stage-2 parent
// token originates from the lead's `token_hash`, issued at createLead — start
// consumes it. Stage 1 (`POST /api/apply`) is owned by the web/frontend (design
// §7.3), NOT this layer; there is no lead-write controller here.
// -------------------------------------------------------------------------

import {
  Stage2Service,
  type Answers,
  type ReviewStage2Result,
  type SaveParentSectionResult,
  type StartStage2Result,
  type SubmitStage2Result,
} from '@curiolab/app'
import { runPublic } from '../run.js'
import { reqObj, reqStr } from '../respond.js'
import type { ControllerResult, PublicInputBase } from '../types.js'

// ---- Stage 2 --------------------------------------------------------------

export interface Stage2StartInput extends PublicInputBase {
  body: { token?: unknown }
}

/** POST /api/public/stage2/start — consume the lead's Stage-2 token; create the draft. */
export function startStage2(input: Stage2StartInput): Promise<ControllerResult<StartStage2Result>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const result = await new Stage2Service({ sql: input.sql }).startStage2(token)
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
    const result = await new Stage2Service({ sql: input.sql }).saveParentSection(token, answers)
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
    await new Stage2Service({ sql: input.sql }).saveStudentSection(token, answers)
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
    const result = await new Stage2Service({ sql: input.sql }).reviewStage2(token)
    return { status: 200, body: result }
  })
}

/** POST /api/public/stage2/submit — 2C submit (parent token only); mints the application. */
export function submitStage2(
  input: Stage2ReviewInput,
): Promise<ControllerResult<SubmitStage2Result>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const result = await new Stage2Service({ sql: input.sql }).submitStage2(token)
    return { status: 201, body: result }
  })
}

/** POST /api/public/stage2/send-back — 2C -> 2B (parent token). */
export function sendBack(input: Stage2ReviewInput): Promise<ControllerResult<{ sentBack: true }>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    await new Stage2Service({ sql: input.sql }).sendBack(token)
    return { status: 200, body: { sentBack: true } }
  })
}
