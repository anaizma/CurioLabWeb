// -------------------------------------------------------------------------
// The public verification URL (05-api-surface.md "Public site": GET /verify/:token,
// public_site.read, M). PUBLIC and token-gated (runPublic, no AuthContext): the
// VerificationService returns the minimal verified record ONLY when the subject's
// public_profile consent is currently active, otherwise the IDENTICAL neutral
// not-shared response — not-shared and not-existent are indistinguishable, and
// the shape is marked `noindex`. Always answers 200 (a status code must not leak
// existence either).
// -------------------------------------------------------------------------

import { VerificationService, type VerificationView } from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runPublic } from '../run.js'
import { reqStr } from '../respond.js'
import type { ControllerResult, PublicInputBase } from '../types.js'

export interface ViewVerificationInput extends PublicInputBase {
  params: { token?: unknown }
}

/** GET /api/verify/:token — the public, token-gated verified record or neutral not-shared. */
export function viewVerification(
  input: ViewVerificationInput,
): Promise<ControllerResult<VerificationView>> {
  return runPublic(async () => {
    const token = reqStr(input.params?.token, 'token')
    // `authorize` is unused by the public `view` path but the service requires it.
    const view = await new VerificationService({ sql: input.sql, authorize }).view(token)
    return { status: 200, body: view }
  })
}
