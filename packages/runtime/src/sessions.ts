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
import type { DeviceFingerprint } from './device.js'
import { generateSessionToken, hashToken } from './tokens.js'

/** The impersonation window from 02-data-model.md: 30 minutes. */
export const IMPERSONATION_TTL_MS = 30 * 60_000

export interface CreateSessionArgs {
  accountId: string
  mode?: SessionMode
  expiresAt: Date
  impersonatedAccountId?: string | null
  realActorAccountId?: string | null
  /**
   * The device this session was minted from (migration 0045). Optional: a caller
   * with no user agent (a script, a test) simply records nulls, and a null
   * device_hash never matches a previous sign-in.
   */
  device?: DeviceFingerprint | null
  /**
   * The raw one-time token behind the "this wasn't me" link in the new-sign-in
   * email. Only its hash is stored; the caller keeps the raw token exactly long
   * enough to put it in the message.
   */
  revokeToken?: string | null
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
  const device = args.device ?? null
  const revokeTokenHash = args.revokeToken == null ? null : hashToken(args.revokeToken)
  const [row] = await sql`
    insert into session (
      token_hash, account_id, mode, impersonated_account_id,
      real_actor_account_id, expires_at, revoked_at,
      device_hash, device_label, ip_hint, last_seen_at, revoke_token_hash
    ) values (
      ${tokenHash}, ${args.accountId}, ${mode},
      ${args.impersonatedAccountId ?? null}, ${args.realActorAccountId ?? null},
      ${args.expiresAt}, null,
      ${device?.hash ?? null}, ${device?.label ?? null}, ${device?.ipHint ?? null},
      now(), ${revokeTokenHash}
    ) returning id, expires_at
  `
  return { id: row!.id as string, token, mode, expiresAt: row!.expires_at as Date }
}

/**
 * Has this account ever held a session from this device hash? The question the
 * new-sign-in notice turns on. A null hash (nothing to fingerprint) answers
 * false, so an unknowable device is treated as unfamiliar rather than familiar —
 * the fail-safe direction, since the cost of a false "new sign-in" notice is one
 * extra email and the cost of a false "familiar" is a silent takeover.
 */
export async function hasSeenDevice(
  sql: Sql,
  accountId: string,
  deviceHash: string | null,
): Promise<boolean> {
  if (deviceHash === null) return false
  const rows = await sql`
    select 1 from session
    where account_id = ${accountId} and device_hash = ${deviceHash}
    limit 1
  `
  return rows.length > 0
}

/** Whether the account has ever held ANY session (its very first sign-in is not "a new device"). */
export async function hasAnyPriorSession(sql: Sql, accountId: string): Promise<boolean> {
  const rows = await sql`select 1 from session where account_id = ${accountId} limit 1`
  return rows.length > 0
}

/** One row of the "your active sessions" list in portal settings. */
export interface AccountSessionRow {
  id: string
  deviceLabel: string | null
  ipHint: string | null
  createdAt: Date
  lastSeenAt: Date | null
  expiresAt: Date
  /** True for the session whose token made this request. */
  current: boolean
}

/**
 * The account's LIVE sessions (unrevoked and unexpired at `now`), newest first,
 * with the caller's own session marked. Never returns the token hash: the list
 * is a display surface, and a session is revoked by its id, not its token.
 */
export async function listLiveSessions(
  sql: Sql,
  accountId: string,
  currentToken: string | null,
  now: Date = new Date(),
): Promise<AccountSessionRow[]> {
  const currentHash = currentToken === null ? null : hashToken(currentToken)
  const rows = await sql`
    select id, device_label, ip_hint, created_at, last_seen_at, expires_at,
           (token_hash = ${currentHash}) as is_current
    from session
    where account_id = ${accountId} and revoked_at is null and expires_at > ${now}
    order by created_at desc
  `
  return rows.map((r) => ({
    id: r.id as string,
    deviceLabel: (r.device_label as string | null) ?? null,
    ipHint: (r.ip_hint as string | null) ?? null,
    createdAt: r.created_at as Date,
    lastSeenAt: (r.last_seen_at as Date | null) ?? null,
    expiresAt: r.expires_at as Date,
    current: r.is_current === true,
  }))
}

/**
 * Refresh `last_seen_at`, but only when it is already older than `staleMs`. An
 * unconditional write would put an UPDATE on the hot path of every authenticated
 * request for a field nobody reads more precisely than "this afternoon".
 */
export async function touchSession(
  sql: Sql,
  sessionId: string,
  now: Date = new Date(),
  staleMs = 5 * 60_000,
): Promise<void> {
  const staleBefore = new Date(now.getTime() - staleMs)
  await sql`
    update session set last_seen_at = ${now}
    where id = ${sessionId} and (last_seen_at is null or last_seen_at < ${staleBefore})
  `
}

/**
 * Revoke the one session a "this wasn't me" token names, at decision time. The
 * token is single-use in effect: revoking also clears `revoke_token_hash`, so a
 * replayed link finds nothing. Returns false for an unknown, already-used, or
 * already-revoked token — one indistinguishable outcome, like every other token
 * surface here.
 */
export async function revokeSessionByRevokeToken(
  sql: Sql,
  revokeToken: string,
  at: Date = new Date(),
): Promise<boolean> {
  const revoked = await sql`
    update session
       set revoked_at = ${at}, revoke_token_hash = null
     where revoke_token_hash = ${hashToken(revokeToken)} and revoked_at is null
    returning id
  `
  return revoked.length > 0
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
