// -------------------------------------------------------------------------
// Auth controllers (05-api-surface.md "Auth"). No capability gate — these
// establish or read the session itself.
//
//   login      POST /api/auth/login   — username-or-email + password; on success
//              mints an opaque server-side session (sessions.ts) and asks the
//              adapter to set the cookie. Wrong/unknown credentials are a uniform
//              opaque 401 (no enumeration signal).
//   logout     POST /api/auth/logout  — revokes the session row and clears the cookie.
//   getSession GET  /api/auth/session — the AuthContext summary + membership switcher.
//
// The session cookie is opaque: only the token hash is stored (sessions.ts).
// -------------------------------------------------------------------------

import {
  createSession,
  revokeSession,
  validateSession,
  verifyPassword,
} from '@curiolab/runtime'
import { resolveAuthContext } from '../context.js'
import { runPublic } from '../run.js'
import { reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult, PublicInputBase } from '../types.js'

/** How long a fresh login session lasts. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/** A membership row as the switcher presents it. */
export interface MembershipSummary {
  chapterId: string
  role: string
  status: string
  podId: string | null
  tier: string | null
}

/** The AuthContext summary returned by getSession and login. */
export interface SessionSummary {
  accountId: string
  status: string
  age: number
  maturationState: string
  memberships: MembershipSummary[]
  guardianOf: string[]
  impersonating: boolean
}

/** The uniform opaque 401, typed to whatever success body the caller declares. */
function unauthorized<B>(): ControllerResult<B> {
  return { status: 401, body: { error: 'unauthorized' } as unknown as B }
}

export interface LoginInput extends PublicInputBase {
  body: { identifier?: unknown; password?: unknown }
}

/** POST /api/auth/login — mint a session for valid credentials, else opaque 401. */
export function login(input: LoginInput): Promise<ControllerResult<{ accountId: string }>> {
  return runPublic(async () => {
    const identifier = reqStr(input.body?.identifier, 'identifier')
    const password = reqStr(input.body?.password, 'password')

    // Resolve the account by email OR username (both citext, case-insensitive).
    const [acct] = await input.sql`
      select id, password_hash, status from account
      where (email = ${identifier} or username = ${identifier})
      limit 1
    `
    // Uniform failure: unknown account, no password set, closed/suspended, or a
    // bad password all yield the same opaque 401 (no enumeration signal).
    if (acct === undefined || acct.password_hash == null) return unauthorized()
    if (acct.status === 'closed' || acct.status === 'suspended') return unauthorized()
    const ok = await verifyPassword(acct.password_hash as string, password)
    if (!ok) return unauthorized()

    const expiresAt = new Date((input.now ?? new Date()).getTime() + SESSION_TTL_MS)
    const { token } = await createSession(input.sql, {
      accountId: acct.id as string,
      expiresAt,
    })
    return {
      status: 200,
      body: { accountId: acct.id as string },
      session: { token, expiresAt },
    }
  })
}

/** POST /api/auth/logout — revoke the current session and clear the cookie. */
export function logout(input: AuthedInputBase): Promise<ControllerResult<{ loggedOut: true }>> {
  return runPublic(async () => {
    const now = input.now ?? new Date()
    const token = input.sessionToken ?? null
    if (token) {
      const s = await validateSession(input.sql, token, now)
      if (s !== null) await revokeSession(input.sql, s.id, now)
    }
    // Idempotent: clearing the cookie is safe even if there was no live session.
    return { status: 200, body: { loggedOut: true }, session: { token: null } }
  })
}

/** GET /api/auth/session — the AuthContext summary + membership switcher, or 401. */
export function getSession(input: AuthedInputBase): Promise<ControllerResult<SessionSummary>> {
  return runPublic(async () => {
    const now = input.now ?? new Date()
    const ctx = await resolveAuthContext(input.sql, input.sessionToken ?? null, now)
    if (ctx === null) return unauthorized<SessionSummary>()
    const summary: SessionSummary = {
      accountId: ctx.account.id,
      status: ctx.account.status,
      age: ctx.account.age,
      maturationState: ctx.account.maturation_state,
      memberships: ctx.memberships.map((m) => ({
        chapterId: m.chapter_id,
        role: m.role,
        status: m.status,
        podId: m.pod_id,
        tier: m.tier,
      })),
      guardianOf: ctx.guardianOf,
      impersonating: ctx.session.impersonation !== undefined,
    }
    return { status: 200, body: summary }
  })
}
