// -------------------------------------------------------------------------
// `authorize` — the thin app-layer wrapper over the pure `can`
// (03-authorization.md "The two-layer split"). This is the ONLY place that does
// IO for an authorization decision.
//
//   - deny  -> write ONE permission.denied audit row carrying the full
//              structured reason, then throw a generic Forbidden that leaks NO
//              reason to the caller (must-not #8, #21).
//   - allow -> record the decision on the AsyncLocalStorage request context (the
//              repository-write backstop reads it), then run obligations.
//
// A minor_record.read obligation runs in the SAME transaction as the guarded
// read: if the audit write fails, the read rolls back and nothing is returned
// (must-not #25, obligation-fails-closed). The concrete read is app-specific and
// supplied as `deps.read`; this wrapper owns the transactional contract around
// it.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { can, type AuthContext, type Capability, type Resource } from '@curiolab/core'
import type { Db } from './db.js'
import { writeAudit, type AuditEntryInput } from './audit.js'
import { recordDecision } from './context.js'
import { Forbidden } from './errors.js'

export interface AuthorizeDeps<T> {
  /** The top-level connection; `authorize` opens the obligation transaction. */
  sql: Sql
  /**
   * The concrete, app-specific read guarded by this capability. When the
   * decision emits obligations it runs inside the SAME transaction as them, so
   * a failed obligation rolls the read back.
   */
  read?: (tx: Db) => Promise<T>
  /** Injection seam for the obligation's audit write (defaults to writeAudit). */
  auditWriter?: (sql: Db, entry: AuditEntryInput) => Promise<string>
}

/**
 * Enforce `capability` for `ctx` against `resource`. Returns the result of
 * `deps.read` on allow (or undefined when no read is supplied); throws Forbidden
 * on deny.
 */
export async function authorize<T = void>(
  ctx: AuthContext,
  capability: Capability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
): Promise<T | undefined> {
  const decision = can(ctx, capability, resource)
  const runAudit = deps.auditWriter ?? writeAudit

  if (!decision.allowed) {
    // The full structured reason goes to the log; the client gets nothing.
    await writeAudit(deps.sql, {
      action: 'permission.denied',
      subjectType: 'permission',
      subjectId: null,
      actorAccountId: ctx.account.id,
      realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
      detail: {
        capability,
        reason: decision.reason,
        ...decision.detail,
        resourceId: resource.id ?? null,
        resourceChapterId: resource.chapter_id ?? null,
      },
    })
    throw new Forbidden()
  }

  // Record the allow decision so the repository-write backstop lets mutations
  // through on this request (07-test-plan.md "Runtime backstop").
  recordDecision({
    capability,
    actorAccountId: ctx.account.id,
    resourceId: resource.id ?? null,
  })

  // No read and no obligations: nothing to run transactionally.
  if (deps.read === undefined && decision.obligations.length === 0) {
    return undefined
  }

  // Run the guarded read and its obligations atomically. Any failure — a failing
  // obligation audit write above all — aborts the transaction, so the read is
  // rolled back and nothing is returned (must-not #25).
  const read = deps.read
  return deps.sql.begin(async (tx) => {
    const result = read !== undefined ? await read(tx) : undefined
    for (const ob of decision.obligations) {
      if (ob.type === 'minor_record.read') {
        await runAudit(tx, {
          action: 'minor_record.read',
          subjectType: 'account',
          subjectId: (ob.detail?.subject as string | undefined) ?? null,
          actorAccountId: ctx.account.id,
          realActorAccountId: ctx.session.impersonation?.real_actor_account_id ?? null,
          chapterId: resource.chapter_id ?? null,
          detail: { obligation: ob.type, ref: ob.detail ?? {} },
        })
      }
    }
    return result
  }) as Promise<T | undefined>
}
