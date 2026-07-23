// -------------------------------------------------------------------------
// Opaque server-side sessions in Postgres (01-stack.md, 02-data-model.md).
//
// No JWTs: instant revocation is required by offboarding, suspension, and
// impersonation expiry (must-not #30). The `session.id` is a plain identity
// safe to log; `session.token_hash` is the only secret at rest. Expiry and
// revocation are evaluated at DECISION TIME against a caller-supplied `now`, so
// a session goes invalid the instant it should, not when a sweeper next runs
// (must-not #29, #30). Rows are deleted only by revocation policy elsewhere;
// revocation here is a `revoked_at` stamp so the ledger of who-had-a-session
// survives.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { SessionMode } from '@curiolab/core'
import type { Db } from './db.js'
import { generateSessionToken, hashToken } from './tokens.js'

/** The impersonation window from 02-data-model.md: 30 minutes. */
export const IMPERSONATION_TTL_MS = 30 * 60_000

export interface CreateSessionArgs {
  accountId: string
  mode?: SessionMode
  expiresAt: Date
  impersonatedAccountId?: string | null
  realActorAccountId?: string | null
}

export interface CreatedSession {
  /** The plain session identity, safe to log. */
  id: string
  /** The opaque token, returned to the caller exactly once. Never stored. */
  token: string
  mode: SessionMode
  expiresAt: Date
}

export interface ValidatedSession {
  id: string
  accountId: string
  mode: SessionMode
  impersonatedAccountId: string | null
  realActorAccountId: string | null
  expiresAt: Date
  revokedAt: Date | null
}

/**
 * Create a session, returning the opaque token once. Only the token hash is
 * persisted. The minor-impersonation-read-only database trigger is the floor:
 * a `full` session naming a minor `impersonatedAccountId` is rejected here.
 */
export async function createSession(sql: Sql, args: CreateSessionArgs): Promise<CreatedSession> {
  const token = generateSessionToken()
  const tokenHash = hashToken(token)
  const mode: SessionMode = args.mode ?? 'full'
  const [row] = await sql`
    insert into session (
      token_hash, account_id, mode, impersonated_account_id,
      real_actor_account_id, expires_at, revoked_at
    ) values (
      ${tokenHash}, ${args.accountId}, ${mode},
      ${args.impersonatedAccountId ?? null}, ${args.realActorAccountId ?? null},
      ${args.expiresAt}, null
    ) returning id, expires_at
  `
  return { id: row!.id as string, token, mode, expiresAt: row!.expires_at as Date }
}

/**
 * Create a 30-minute impersonation session. When the target is a minor the mode
 * is forced to `read_only` (02-data-model.md); the database trigger enforces the
 * same rule as the floor. The real actor holds the session; the impersonated
 * account is the effective identity.
 */
export async function createImpersonationSession(
  sql: Sql,
  args: {
    realActorAccountId: string
    impersonatedAccountId: string
    targetIsMinor: boolean
    mode?: SessionMode
    now?: Date
  },
): Promise<CreatedSession> {
  const now = args.now ?? new Date()
  const mode: SessionMode = args.targetIsMinor ? 'read_only' : (args.mode ?? 'full')
  return createSession(sql, {
    accountId: args.realActorAccountId,
    mode,
    impersonatedAccountId: args.impersonatedAccountId,
    realActorAccountId: args.realActorAccountId,
    expiresAt: new Date(now.getTime() + IMPERSONATION_TTL_MS),
  })
}

/**
 * Resolve a token to a live session, or null. Rejects at decision time when
 * `now >= expires_at` or `revoked_at <= now`. Returns null for an unknown token
 * without distinguishing it from an expired one.
 */
export async function validateSession(
  sql: Sql,
  token: string,
  now: Date = new Date(),
): Promise<ValidatedSession | null> {
  const [row] = await sql`
    select id, account_id, mode, impersonated_account_id,
           real_actor_account_id, expires_at, revoked_at
    from session where token_hash = ${hashToken(token)}
  `
  if (!row) return null

  const expiresAt = row.expires_at as Date
  const revokedAt = (row.revoked_at as Date | null) ?? null
  if (now.getTime() >= expiresAt.getTime()) return null
  if (revokedAt !== null && revokedAt.getTime() <= now.getTime()) return null

  return {
    id: row.id as string,
    accountId: row.account_id as string,
    mode: row.mode as SessionMode,
    impersonatedAccountId: (row.impersonated_account_id as string | null) ?? null,
    realActorAccountId: (row.real_actor_account_id as string | null) ?? null,
    expiresAt,
    revokedAt,
  }
}

/** Revoke one session by stamping `revoked_at` (idempotent: earliest wins). */
export async function revokeSession(
  sql: Sql,
  sessionId: string,
  at: Date = new Date(),
): Promise<void> {
  await sql`
    update session set revoked_at = ${at}
    where id = ${sessionId} and revoked_at is null
  `
}

/**
 * Revoke every live session for an account: both sessions the account holds and
 * any impersonation session targeting it. Used at offboarding and suspension so
 * access dies immediately, not at next expiry (must-not #30). Accepts a `Db`
 * (pool OR an open transaction), so a caller can revoke atomically inside its own
 * transaction — e.g. a password reset / account recovery consume that must set the
 * new credential and drop old sessions in one commit.
 */
export async function revokeAllSessionsForAccount(
  sql: Db,
  accountId: string,
  at: Date = new Date(),
): Promise<void> {
  await sql`
    update session set revoked_at = ${at}
    where revoked_at is null
      and (account_id = ${accountId} or impersonated_account_id = ${accountId})
  `
}
