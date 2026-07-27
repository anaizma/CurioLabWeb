// -------------------------------------------------------------------------
// Session self-management: see where you are signed in, and end it.
//
// Everything here is scoped to the CALLER'S OWN account and carries no registry
// capability, for the same reason POST /api/auth/logout does not: the authority
// is self-ownership of the session, not a role. That makes the scoping rule the
// whole security property, so no id the client sends is ever trusted on its own:
// "revoke all" scopes by `account_id` in the UPDATE itself, and "revoke one"
// resolves the id against the caller's own live list first and refuses to act on
// anything that is not in it.
//
// The one exception is revokeSessionByLink, which is token-gated and has no
// actor at all: it backs the "this wasn't me" link in the new-sign-in email,
// which by definition reaches someone who is NOT signed in (that is the whole
// point — they may be locked out of an account someone else just took).
// -------------------------------------------------------------------------

import {
  listLiveSessions,
  revokeAllSessionsForAccount,
  revokeSession,
  revokeSessionByRevokeToken,
  type AccountSessionRow,
} from '@curiolab/runtime'
import { resolveAuthContext } from '../context.js'
import { runPublic } from '../run.js'
import { reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult, PublicInputBase } from '../types.js'

/** One session as the settings list renders it. Never carries a token or a hash. */
export interface SessionListItem {
  id: string
  /** Coarse device descriptor ("Chrome on Windows"), or null when unrecognised. */
  deviceLabel: string | null
  /** The coarse client network (IPv4 /24, IPv6 /48), or null. */
  ipHint: string | null
  createdAt: string
  lastSeenAt: string | null
  expiresAt: string
  /** True for the session making this very request. */
  current: boolean
}

export interface SessionListResult {
  sessions: SessionListItem[]
}

function toItem(r: AccountSessionRow): SessionListItem {
  return {
    id: r.id,
    deviceLabel: r.deviceLabel,
    ipHint: r.ipHint,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt === null ? null : r.lastSeenAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    current: r.current,
  }
}

/** The uniform opaque 403 a missing/expired session gets, matching runAuthed. */
function forbidden<B>(): ControllerResult<B> {
  return { status: 403, body: { error: 'forbidden' } as unknown as B }
}

/**
 * GET /api/auth/sessions — the caller's own live sessions, newest first, with the
 * current one marked. Resolves the context directly rather than through
 * `runAuthed` because the ACCOUNT that owns the session is what matters here, and
 * under impersonation `runAuthed`'s effective identity is the impersonated
 * account — listing (and worse, revoking) that person's sessions from an
 * impersonated context is not something this surface should ever do.
 */
export function listSessions(input: AuthedInputBase): Promise<ControllerResult<SessionListResult>> {
  return runPublic(async () => {
    const now = input.now ?? new Date()
    const token = input.sessionToken ?? null
    const ctx = await resolveAuthContext(input.sql, token, now)
    if (ctx === null) return forbidden<SessionListResult>()
    // Under impersonation the real actor holds the session; ctx.account is the
    // impersonated identity, so take the owner from the impersonation record.
    const ownerId = ctx.session.impersonation?.real_actor_account_id ?? ctx.account.id
    const rows = await listLiveSessions(input.sql, ownerId, token, now)
    return { status: 200, body: { sessions: rows.map(toItem) } }
  })
}

export interface RevokeSessionsInput extends AuthedInputBase {
  body: {
    /** Revoke exactly this session. Must belong to the caller. */
    sessionId?: unknown
    /** Revoke every session for the account, including the caller's own. */
    all?: unknown
  }
}

export interface RevokeSessionsResult {
  revoked: true
  /** True when the caller just ended their OWN session (the adapter clears the cookie). */
  endedCurrent: boolean
}

/**
 * POST /api/auth/sessions/revoke — end one of the caller's sessions, or all of
 * them ("sign out everywhere").
 *
 * `all` deliberately includes the caller's own session. A "sign out everywhere"
 * that quietly spares the device you are holding is the wrong shape for the
 * situation it exists for: someone who suspects a compromise wants one button
 * that ends everything, and re-authenticating on the device in their hand is the
 * cheapest part of that.
 *
 * A `sessionId` that is not the caller's is not an error and not a 404 — it is a
 * no-op that reports success, because distinguishing "not yours" from "already
 * gone" would confirm the existence of another account's session id.
 */
export function revokeSessions(
  input: RevokeSessionsInput,
): Promise<ControllerResult<RevokeSessionsResult>> {
  return runPublic(async () => {
    const now = input.now ?? new Date()
    const token = input.sessionToken ?? null
    const ctx = await resolveAuthContext(input.sql, token, now)
    if (ctx === null) return forbidden<RevokeSessionsResult>()
    const ownerId = ctx.session.impersonation?.real_actor_account_id ?? ctx.account.id

    if (input.body?.all === true) {
      await revokeAllSessionsForAccount(input.sql, ownerId, now)
      return { status: 200, body: { revoked: true, endedCurrent: true }, session: { token: null } }
    }

    const sessionId = reqStr(input.body?.sessionId, 'sessionId')
    // Ownership is established by resolving the id against the caller's OWN live
    // list, which is itself scoped by account_id. An id from another account is
    // simply absent from that list, so it can never reach the revoke below.
    const live = await listLiveSessions(input.sql, ownerId, token, now)
    const target = live.find((s) => s.id === sessionId)
    if (target === undefined) {
      // Not the caller's, or already gone. Same answer either way.
      return { status: 200, body: { revoked: true, endedCurrent: false } }
    }
    await revokeSession(input.sql, sessionId, now)
    return target.current
      ? { status: 200, body: { revoked: true, endedCurrent: true }, session: { token: null } }
      : { status: 200, body: { revoked: true, endedCurrent: false } }
  })
}

export interface RevokeSessionByLinkInput extends PublicInputBase {
  body: { token?: unknown }
}

/**
 * POST /api/auth/sessions/revoke-link — the "this wasn't me" action behind the
 * new-sign-in email. Token-gated and actor-less: the person clicking it may not
 * be able to sign in at all, which is exactly the case it serves.
 *
 * The token names ONE session and nothing else, so a leaked link cannot be turned
 * into a denial-of-service against the account's other devices. Revoking clears
 * the stored hash, so the link is effectively single-use, and an unknown, used,
 * or already-revoked token returns the same 200 as a successful revoke: the
 * outcome the person cares about ("that session is not live") is identical, and
 * distinguishing them would let someone probe tokens.
 */
export function revokeSessionByLink(
  input: RevokeSessionByLinkInput,
): Promise<ControllerResult<{ revoked: true }>> {
  return runPublic(async () => {
    const revokeToken = reqStr(input.body?.token, 'token')
    await revokeSessionByRevokeToken(input.sql, revokeToken, input.now ?? new Date())
    return { status: 200, body: { revoked: true } }
  })
}
