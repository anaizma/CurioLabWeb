// -------------------------------------------------------------------------
// Account self-service ("My Information") controllers (AccountService).
//
//   getAccount    GET   /api/account — the caller's OWN info, assembled per role
//                 (self-session read, no capability — like GET /api/auth/session;
//                 GET-exempt from the route manifest). Never another member's row.
//   updateAccount PATCH /api/account — edit the editable fields, server-enforced.
//                 Body { email?: string, school?: string }. Gated through
//                 `authorize` under `account.self.manage` (own scope); email is
//                 role-aware (adult → account.email; student → the gated
//                 notification primary write), school is students-only. Each
//                 accepted change is audited.
//
// Both act on ctx.account.id (there is no id parameter), so a caller can only ever
// read or write their OWN account.
// -------------------------------------------------------------------------

import { AccountService, type AccountInfo } from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

function accountService(sql: AuthedInputBase['sql']): AccountService {
  return new AccountService({ sql, authorize })
}

export type GetAccountInput = AuthedInputBase

/** GET /api/account — the caller's OWN "My Information" view (self-session read). */
export function getAccount(input: GetAccountInput): Promise<ControllerResult<AccountInfo>> {
  return runAuthed(input, async (ctx, sql) => {
    const body = await accountService(sql).getAccount(ctx, { now: input.now })
    return { status: 200, body }
  })
}

export interface UpdateAccountInputHttp extends AuthedInputBase {
  /** `{ email?: string, school?: string }` — any other field is ignored. */
  body: { email?: unknown; school?: unknown }
}

/**
 * PATCH /api/account — update the caller's editable fields (email — role-aware;
 * school — students only). Server-enforced through `account.self.manage` + the
 * per-field rules; returns the fresh self-view. A bad adult email is a 400, a
 * student under-13 / flag-off / no-grant email is an opaque 403, a non-student
 * school edit is an opaque 403.
 */
export function updateAccount(input: UpdateAccountInputHttp): Promise<ControllerResult<AccountInfo>> {
  return runAuthed(input, async (ctx, sql) => {
    const body = await accountService(sql).updateAccount(
      ctx,
      { email: input.body?.email, school: input.body?.school },
      { now: input.now },
    )
    return { status: 200, body }
  })
}
