// -------------------------------------------------------------------------
// Invite onboarding-entry controllers (05-api-surface.md "single-code-path
// invariant"; 06-onboarding-flows Flows A/B). These are the UNAUTHENTICATED,
// actor-less, INERT endpoints: they carry no AuthContext and never call
// `authorize`. Each creates only a `pending` account (and, for a guardian, a
// `pending` edge) with zero authority until staff verify or activate.
//
//   validateInviteToken  GET  /api/invites/:token            (kind + chapter ONLY)
//   acceptInvite         POST /api/invites/:token/accept          (email path)
//   acceptStudent        POST /api/invites/:token/accept-student  (username path)
//
// SEAM: per-endpoint rate limiting (05-api-surface: "rate limit, single-use
// token") is an edge/middleware concern, not wired here. The single-use token
// claim and the timing-safe uniform validate response are enforced in
// InviteService.
// -------------------------------------------------------------------------

import {
  InviteService,
  type AcceptInviteResult,
  type EmailCredentials,
  type UsernameCredentials,
  type ValidateInviteResult,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runPublic } from '../run.js'
import { reqStr } from '../respond.js'
import type { ControllerResult, PublicInputBase } from '../types.js'

/** The InviteService needs an `authorize` dep for its ops methods; the inert
 * paths below never invoke it, but the constructor requires it. */
function inviteService(sql: PublicInputBase['sql']): InviteService {
  return new InviteService({ sql, authorize })
}

export interface ValidateInviteInput extends PublicInputBase {
  params: { token?: unknown }
}

/** GET /api/invites/:token — timing-safe validate; {usable, kind, chapter} only. */
export function validateInviteToken(
  input: ValidateInviteInput,
): Promise<ControllerResult<ValidateInviteResult>> {
  return runPublic(async () => {
    const token = reqStr(input.params?.token, 'token')
    const result = await inviteService(input.sql).validateInvite(token)
    return { status: 200, body: result }
  })
}

export interface AcceptInviteInput extends PublicInputBase {
  params: { token?: unknown }
  body: {
    email?: unknown
    password?: unknown
    legalName?: unknown
    displayName?: unknown
    dateOfBirth?: unknown
  }
}

/** POST /api/invites/:token/accept — the email (guardian/mentor/staff) path. */
export function acceptInvite(input: AcceptInviteInput): Promise<ControllerResult<AcceptInviteResult>> {
  return runPublic(async () => {
    const token = reqStr(input.params?.token, 'token')
    const credentials: EmailCredentials = {
      email: reqStr(input.body?.email, 'email'),
      password: reqStr(input.body?.password, 'password'),
      legalName: reqStr(input.body?.legalName, 'legalName'),
      displayName: reqStr(input.body?.displayName, 'displayName'),
      dateOfBirth: reqStr(input.body?.dateOfBirth, 'dateOfBirth'),
    }
    const result = await inviteService(input.sql).acceptInvite(token, credentials)
    return { status: 201, body: result }
  })
}

export interface AcceptStudentInput extends PublicInputBase {
  params: { token?: unknown }
  body: {
    username?: unknown
    password?: unknown
    legalName?: unknown
    displayName?: unknown
  }
}

/** POST /api/invites/:token/accept-student — the username (guardian-mediated) path. */
export function acceptStudent(input: AcceptStudentInput): Promise<ControllerResult<AcceptInviteResult>> {
  return runPublic(async () => {
    const token = reqStr(input.params?.token, 'token')
    const credentials: UsernameCredentials = {
      username: reqStr(input.body?.username, 'username'),
      password: reqStr(input.body?.password, 'password'),
      legalName: reqStr(input.body?.legalName, 'legalName'),
      displayName: reqStr(input.body?.displayName, 'displayName'),
    }
    const result = await inviteService(input.sql).acceptInvite(token, credentials)
    return { status: 201, body: result }
  })
}
