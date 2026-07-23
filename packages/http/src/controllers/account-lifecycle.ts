// -------------------------------------------------------------------------
// Account-lifecycle controllers — the coming-of-age (maturation) flow and the
// 16+ credential privatization (06-onboarding-flows Flow D; 04-state-machines
// account_maturation). Each resolves the session to an AuthContext (runAuthed)
// and calls MaturationService.
//
//   addEmail          POST /api/auth/email/add                 self, 18+ (no capability)
//   confirmMaturation POST /api/ops/maturations/:id/confirm    maturation.confirm (director)
//   reissueSetup      POST /api/ops/accounts/:id/reissue-setup account.recover (director)
//   selfPrivate       POST /api/ops/students/:id/self-private  16+ witnessed (self session)
//
// addEmail and selfPrivate are SELF-initiated (gated by self-ownership + an age
// floor inside the service, no registry capability); confirmMaturation and
// reissueSetup are ops writes gated through `authorize`. The service owns every
// gate — these controllers add no bespoke permission logic.
//
// SEAM: the setup/reset token DELIVERY (and the reissue token's persistence /
// consumption endpoint) is a mailer seam — the returned token is where a future
// mailer attaches (BUILD-STATUS.md).
// -------------------------------------------------------------------------

import {
  MaturationService,
  type AddEmailResult,
  type ConfirmMaturationResult,
  type ConsumeAccountRecoveryResult,
  type PrivatizeCredentialResult,
  type ReissueSetupResult,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed, runPublic } from '../run.js'
import { reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult, PublicInputBase } from '../types.js'

function maturationService(sql: AuthedInputBase['sql']): MaturationService {
  return new MaturationService({ sql, authorize })
}

export interface AddEmailInput extends AuthedInputBase {
  body: { email?: unknown }
}

/** POST /api/auth/email/add — the 18+ student adds an email (minor -> maturation_pending). */
export function addEmail(input: AddEmailInput): Promise<ControllerResult<AddEmailResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const email = reqStr(input.body?.email, 'email')
    const result = await maturationService(sql).addEmail(ctx.account.id, email, ctx)
    return { status: 200, body: result }
  })
}

export interface ConfirmMaturationInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/ops/maturations/:id/confirm — Flow D step 3 (maturation.confirm). */
export function confirmMaturation(
  input: ConfirmMaturationInput,
): Promise<ControllerResult<ConfirmMaturationResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const accountId = reqStr(input.params?.id, 'id')
    const result = await maturationService(sql).confirmMaturation(accountId, ctx)
    return { status: 200, body: result }
  })
}

export interface ReissueSetupInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** POST /api/ops/accounts/:id/reissue-setup — Flow D step 4 (account.recover). */
export function reissueSetup(input: ReissueSetupInput): Promise<ControllerResult<ReissueSetupResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const accountId = reqStr(input.params?.id, 'id')
    const result = await maturationService(sql).reissueSetup(accountId, ctx)
    return { status: 200, body: result }
  })
}

export interface ConsumeAccountRecoveryInput extends PublicInputBase {
  body: { token?: unknown; email?: unknown; newPassword?: unknown }
}

/**
 * POST /api/auth/account-recovery — token-gated, unauthenticated (like invite
 * accept). Consumes an account_recovery setup token (minted by reissueSetup) for
 * a locked-out adult former student: sets email + a fresh password and marks the
 * token consumed. An expired, consumed, or unknown token is one opaque 401
 * (InvalidCredentialTokenError -> invalid_token).
 */
export function consumeAccountRecovery(
  input: ConsumeAccountRecoveryInput,
): Promise<ControllerResult<ConsumeAccountRecoveryResult>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const email = reqStr(input.body?.email, 'email')
    const newPassword = reqStr(input.body?.newPassword, 'newPassword')
    const result = await new MaturationService({ sql: input.sql, authorize }).consumeAccountRecovery(
      token,
      { email, newPassword },
      { now: input.now },
    )
    return { status: 200, body: result }
  })
}

export interface SelfPrivateInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { witnessedBy?: unknown }
}

/** POST /api/ops/students/:id/self-private — the 16+ witnessed credential privatization. */
export function selfPrivate(input: SelfPrivateInput): Promise<ControllerResult<PrivatizeCredentialResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const accountId = reqStr(input.params?.id, 'id')
    const witnessedBy = input.body?.witnessedBy == null ? null : String(input.body.witnessedBy)
    const result = await maturationService(sql).privatizeCredential(accountId, ctx, { witnessedBy })
    return { status: 200, body: result }
  })
}
