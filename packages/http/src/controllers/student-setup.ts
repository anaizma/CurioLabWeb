// -------------------------------------------------------------------------
// Student setup-credential controllers — the account-origination chain's §3
// student-credential step (StudentSetupService).
//
//   provisionStudentSetup  POST /api/guardian/children/:id/setup-credential
//                          guardian-authed (guardian.provision_child): the verified
//                          guardian mints the child's one-time, guardian-routed
//                          `minor_setup` credential. runAuthed -> the service
//                          authorizes the guardian scope + the §3 gate.
//   redeemStudentSetup     POST /api/setup/student/:token
//                          UNAUTHENTICATED, token-gated (like invite accept): the
//                          child redeems the credential to set the password; the
//                          account stays `pending`. runPublic -> no actor.
// -------------------------------------------------------------------------

import {
  StudentSetupService,
  type ProvisionSetupCredentialResult,
  type RedeemSetupCredentialResult,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed, runPublic } from '../run.js'
import { optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult, PublicInputBase } from '../types.js'

function studentSetupService(sql: AuthedInputBase['sql']): StudentSetupService {
  return new StudentSetupService({ sql, authorize })
}

export interface ProvisionStudentSetupInput extends AuthedInputBase {
  params: { id?: unknown }
  /** The trusted client IP threaded from the route adapter for the §8 ledger. */
  clientIp?: string | null
}

/**
 * POST /api/guardian/children/:id/setup-credential — the verified guardian mints
 * their child's one-time setup credential (guardian.provision_child). Returns the
 * raw token ONCE (the guardian-delivery seam) plus its expiry.
 */
export function provisionStudentSetup(
  input: ProvisionStudentSetupInput,
): Promise<ControllerResult<ProvisionSetupCredentialResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const result = await studentSetupService(sql).provisionSetupCredential(childId, ctx, {
      clientIp: input.clientIp ?? null,
    })
    return { status: 200, body: result }
  })
}

export interface RedeemStudentSetupInput extends PublicInputBase {
  params: { token?: unknown }
  body: { password?: unknown; notificationEmail?: unknown }
}

/**
 * POST /api/setup/student/:token — the child redeems the one-time `minor_setup`
 * credential (with the guardian present) to set the account password. Token-gated,
 * unauthenticated; the account stays `pending` (no membership activation). An
 * expired/consumed/unknown token is one opaque 401 (invalid_token).
 *
 * OPTIONALLY sets the student's hidden, outbound-only `notification_email` when the
 * body carries `notificationEmail` — but ONLY when the whole authorization chain
 * holds (STUDENT_NOTIFICATION_EMAIL_ENABLED on + an active student_notification_email
 * grant + 13+), else a 403. DARK by default; enabling makes a minor directly
 * contactable and is COUNSEL-GATED.
 */
export function redeemStudentSetup(
  input: RedeemStudentSetupInput,
): Promise<ControllerResult<RedeemSetupCredentialResult>> {
  return runPublic(async () => {
    const token = reqStr(input.params?.token, 'token')
    const password = reqStr(input.body?.password, 'password')
    const notificationEmail = optStr(input.body?.notificationEmail)
    const result = await studentSetupService(input.sql).redeemSetupCredential(token, password, {
      now: input.now,
      notificationEmail,
    })
    return { status: 200, body: result }
  })
}
