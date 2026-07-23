// -------------------------------------------------------------------------
// withRlsContext — the per-request seam for Mechanism B (Milestone 4.1).
//
// The RLS policies in packages/db migration 0018_rls.sql filter the highest-risk
// tables by two transaction-local settings:
//
//   app.current_account_id  (uuid)       — the acting account
//   app.actor_is_platform   ('on'/'off') — a platform actor sees every row
//
// This helper opens ONE transaction, sets those GUCs with SET LOCAL semantics
// (set_config(name, value, is_local => true), which scopes them to the
// transaction so nothing leaks to the pooled connection), and runs the caller's
// reads/writes inside it. It is the exact seam production will use ONCE the app
// connects as the restricted `curiolab_rls` role.
//
// SCOPE NOTE (M4.1): converting the existing services to call this — connecting
// the app as curiolab_rls and threading this context through every service read
// — is deferred go-live wiring, not done here. Today the helper is exercised
// only against curiolab_rls in test/rls-context.test.ts, proving the same
// filtering the raw-SQL db test proves, but through the runtime seam.
//
// Fail-closed: when accountId is absent and isPlatform is false, no identifying
// GUC is set, so every policy predicate is false and the transaction sees zero
// rows across the protected tables. That is intentional — a caller that forgets
// to supply a context reads nothing rather than everything.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'

export interface RlsContext {
  /** The acting account id. Omitted/null => no identity is set (fail-closed). */
  accountId?: string | null
  /** A platform actor sees all rows. Defaults to false. */
  isPlatform?: boolean
}

/**
 * Run `fn` inside a transaction whose RLS GUCs are set from `ctx`. The GUCs are
 * transaction-local (SET LOCAL), so they never leak onto the pooled connection.
 * Returns whatever `fn` returns.
 */
export async function withRlsContext<T>(
  sql: Sql,
  ctx: RlsContext,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    if (ctx.accountId != null) {
      await tx`select set_config('app.current_account_id', ${ctx.accountId}, true)`
    }
    // Always pin the platform flag so a stale value can never carry over; a
    // fresh transaction has no prior GUC, but being explicit keeps the seam
    // self-documenting and correct even if the connection is reused.
    await tx`select set_config('app.actor_is_platform', ${ctx.isPlatform ? 'on' : 'off'}, true)`
    return fn(tx)
  }) as Promise<T>
}
