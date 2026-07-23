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

import type { AuthContext, Role } from '@curiolab/core'
import {
  createImpersonationSession,
  createSession,
  revokeSession,
  validateSession,
  verifyPassword,
} from '@curiolab/runtime'
import { passwordResetRoute } from '@curiolab/app'
import { resolveAuthContext } from '../context.js'
import { runAuthed, runPublic } from '../run.js'
import { FORBIDDEN_BODY, reqStr } from '../respond.js'
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

// ---- password reset request (POST /api/auth/password/reset-request) ---------

/** Whole years from an ISO `YYYY-MM-DD` DOB to `at` (birthday-aware, UTC). */
function ageFromDob(dob: string, at: Date): number {
  const d = new Date(`${dob}T00:00:00Z`)
  let age = at.getUTCFullYear() - d.getUTCFullYear()
  const m = at.getUTCMonth() - d.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < d.getUTCDate())) age -= 1
  return age
}

/** Where a reset for one account is delivered (the seam a future mailer consumes). */
export type PasswordResetRoute = 'self_email' | 'guardian' | 'chapter_director'

export interface PasswordResetDelivery {
  accountId: string
  route: PasswordResetRoute
}

export interface RequestPasswordResetInput extends PublicInputBase {
  body: { identifier?: unknown }
  /**
   * The delivery seam. Called ONLY when the identifier resolves to an account,
   * with the computed route. The caller's response is uniform regardless, so the
   * seam firing (or not) never becomes an existence oracle. Defaults to a no-op:
   * token minting / persistence and the actual send are deferred (BUILD-STATUS).
   */
  deliver?: (d: PasswordResetDelivery) => void | Promise<void>
}

/**
 * POST /api/auth/password/reset-request — inert, uniform, no account-existence
 * oracle. The response is byte-identical whether or not the identifier resolves.
 * When it does, the route is computed (an adult -> their own email; a minor ->
 * their verified guardians, or the Chapter Director for a `self_private`
 * account) and handed to the delivery seam. NO token is persisted here — that,
 * and the send, are deferred mailer seams.
 *
 * SEAM: rate limiting (05-api-surface) is edge/middleware, not wired here.
 */
export function requestPasswordReset(
  input: RequestPasswordResetInput,
): Promise<ControllerResult<{ requested: true }>> {
  return runPublic(async () => {
    const identifier = reqStr(input.body?.identifier, 'identifier')
    const now = input.now ?? new Date()
    const [acct] = await input.sql`
      select id, date_of_birth::text as dob, credential_owner
      from account where (email = ${identifier} or username = ${identifier})
      limit 1
    `
    if (acct !== undefined) {
      const age = ageFromDob(acct.dob as string, now)
      const route: PasswordResetRoute =
        age >= 18 ? 'self_email' : passwordResetRoute(acct.credential_owner as 'guardian_provisioned' | 'self_private')
      const deliver = input.deliver
      if (deliver !== undefined) await deliver({ accountId: acct.id as string, route })
    }
    // Uniform response in every branch — the entire security property.
    return { status: 202, body: { requested: true } }
  })
}

// ---- impersonation (POST | DELETE /api/auth/impersonate) --------------------

/** True when the actor holds an in-force membership with `role` (mirrors core hasRole). */
function holdsActiveRole(ctx: AuthContext, role: Role): boolean {
  return ctx.memberships.some((m) => {
    if (m.role !== role || m.status !== 'active') return false
    if (m.active_from !== null && m.active_from > ctx.now) return false
    if (m.active_until !== null && ctx.now >= m.active_until) return false
    return true
  })
}

export interface StartImpersonationInput extends AuthedInputBase {
  body: { targetAccountId?: unknown }
}

export interface StartImpersonationResult {
  impersonatedAccountId: string
  mode: string
  expiresAt: Date
}

/**
 * POST /api/auth/impersonate — mint a 30-minute impersonation session
 * (05-api-surface `impersonation.start`, platform_admin only; read-only when the
 * target is a minor; both actor fields set). `impersonation.start` is NOT a
 * registry capability, so the platform-admin gate is a direct in-force role
 * check rather than an `authorize` call (the one documented exception to the
 * single-code-path invariant for this surface). The read-only-for-a-minor rule
 * and the 30-minute expiry are enforced by `createImpersonationSession` and the
 * database trigger floor. The adapter sets the returned token as the session
 * cookie.
 */
export function startImpersonation(
  input: StartImpersonationInput,
): Promise<ControllerResult<StartImpersonationResult>> {
  return runAuthed<StartImpersonationResult>(input, async (ctx, sql) => {
    if (!holdsActiveRole(ctx, 'platform_admin')) {
      return { status: 403, body: FORBIDDEN_BODY as unknown as StartImpersonationResult }
    }
    const targetAccountId = reqStr(input.body?.targetAccountId, 'targetAccountId')
    const now = input.now ?? new Date()
    const [target] = await sql`select date_of_birth::text as dob from account where id = ${targetAccountId}`
    if (target === undefined) {
      return { status: 404, body: { error: 'not_found' } as unknown as StartImpersonationResult }
    }
    const targetIsMinor = ageFromDob(target.dob as string, now) < 18
    const created = await createImpersonationSession(sql, {
      realActorAccountId: ctx.account.id,
      impersonatedAccountId: targetAccountId,
      targetIsMinor,
      now,
    })
    return {
      status: 200,
      body: { impersonatedAccountId: targetAccountId, mode: created.mode, expiresAt: created.expiresAt },
      session: { token: created.token, expiresAt: created.expiresAt },
    }
  })
}

/**
 * DELETE /api/auth/impersonate — end the current impersonation session by
 * revoking its row and clearing the cookie. Idempotent: a non-impersonation or
 * absent session still returns 200 and clears the cookie.
 */
export function endImpersonation(
  input: AuthedInputBase,
): Promise<ControllerResult<{ ended: true }>> {
  return runPublic(async () => {
    const now = input.now ?? new Date()
    const token = input.sessionToken ?? null
    if (token) {
      const s = await validateSession(input.sql, token, now)
      if (s !== null && s.impersonatedAccountId !== null) {
        await revokeSession(input.sql, s.id, now)
      }
    }
    return { status: 200, body: { ended: true }, session: { token: null } }
  })
}
