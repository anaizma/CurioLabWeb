// -------------------------------------------------------------------------
// The two controller runners. Both establish a fresh `withRequest` store (so
// the runtime repository-write backstop and the recorded-decision path hold)
// and funnel thrown errors through `mapError`.
//
//   - runAuthed: resolve the session to an AuthContext first. A null context
//     (no/invalid/expired session) is an OPAQUE 403 with NO audit — there is no
//     actor to attribute a permission.denied to. A resolved context runs the
//     body, whose service call goes through `authorize` (which writes the one
//     permission.denied row and throws Forbidden on deny).
//   - runPublic: no auth; the enumerated actor-less endpoints (05-api-surface).
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext } from '@curiolab/core'
import { withRequest } from '@curiolab/runtime'
import { resolveAuthContext } from './context.js'
import { mapError, FORBIDDEN_BODY } from './respond.js'
import type { AuthedInputBase, ControllerResult } from './types.js'

/** Run an authenticated controller body; a null session -> opaque 403. */
export async function runAuthed<B>(
  input: AuthedInputBase,
  fn: (ctx: AuthContext, sql: Sql) => Promise<ControllerResult<B>>,
): Promise<ControllerResult<B>> {
  const now = input.now ?? new Date()
  const ctx = await resolveAuthContext(input.sql, input.sessionToken ?? null, now)
  if (ctx === null) {
    return { status: 403, body: FORBIDDEN_BODY } as ControllerResult<B>
  }
  try {
    return await withRequest(() => fn(ctx, input.sql))
  } catch (e) {
    const mapped = mapError(e)
    if (mapped) return mapped as ControllerResult<B>
    throw e
  }
}

/** Run an unauthenticated / token-gated controller body. */
export async function runPublic<B>(
  fn: () => Promise<ControllerResult<B>>,
): Promise<ControllerResult<B>> {
  try {
    return await withRequest(fn)
  } catch (e) {
    const mapped = mapError(e)
    if (mapped) return mapped as ControllerResult<B>
    throw e
  }
}
