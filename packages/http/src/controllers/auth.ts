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

import type { Resource, Role } from '@curiolab/core'
import { requiresTwoFactor } from '@curiolab/core'
import {
  authorize,
  createImpersonationSession,
  createSession,
  fingerprintDevice,
  generateSessionToken,
  hasAnyPriorSession,
  hasSeenDevice,
  revokeSession,
  validateSession,
  verifyPassword,
  writeAccessLedger,
  type DeviceFingerprint,
} from '@curiolab/runtime'
import { CredentialTokenService, TwoFactorService } from '@curiolab/app'
import { resolveAuthContext } from '../context.js'
import { runAuthed, runPublic } from '../run.js'
import { reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult, PublicInputBase } from '../types.js'

// -------------------------------------------------------------------------
// Session lifetime. Two values, because the two populations carry wildly
// different consequences if a session is stolen or a laptop is left open.
//
// A PRIVILEGED account (chapter_director, platform_admin, and every other staff
// or teaching role — the same set that already mandates TOTP, PRIVILEGED_ROLES in
// @curiolab/core) can read minors' applications, guardian contact details and the
// audit log. A month-long cookie on that account is a month-long window for a
// stolen laptop or an exfiltrated cookie, and there is no cost to shortening it:
// re-authenticating means a password plus a 6-digit code, and 12 hours covers a
// whole working day without a mid-afternoon interruption.
//
// An UNPRIVILEGED account (student, guardian, alumni) sees only its own family's
// data, and the people holding these accounts are children and busy parents for
// whom a frequent forced re-login is a real barrier to participating at all. They
// keep the long window.
//
// Impersonation is a third case and is NOT governed here: it is pinned to 30
// minutes by IMPERSONATION_TTL_MS, with a database trigger as the floor.
// -------------------------------------------------------------------------

/** Session lifetime for an unprivileged account (student / guardian / alumni). */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/** Session lifetime for a privileged account (director / admin / staff / mentor). */
const PRIVILEGED_SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

/**
 * When a session minted at `now` expires. `privileged` is not re-derived from
 * roles here on purpose: each call site already KNOWS which it is by construction
 * (the TOTP paths are reachable only for a privileged account, the password-only
 * path only for an unprivileged one), and re-deriving it would add a query whose
 * answer could disagree with the branch that got here.
 */
function sessionExpiresAt(now: Date, privileged: boolean): Date {
  return new Date(now.getTime() + (privileged ? PRIVILEGED_SESSION_TTL_MS : SESSION_TTL_MS))
}

// ---- new-device sign-in notification -------------------------------------

/** What the mailer seam is told when a session is minted from an unfamiliar device. */
export interface NewSignInNotice {
  accountId: string
  /** Coarse device descriptor ("Chrome on Windows"), or null if unrecognised. */
  deviceLabel: string | null
  /** The coarse client network (IPv4 /24, IPv6 /48), or null. */
  ipHint: string | null
  at: Date
  /**
   * The raw one-time token behind the "this wasn't me" link. Only its hash is
   * stored on the session row; this value exists for exactly as long as it takes
   * the caller to put it in a message, and is never logged.
   */
  revokeToken: string
}

/** The device-aware part of a sign-in request, threaded from the HTTP adapter. */
interface DeviceInput {
  clientIp?: string | null
  /** The raw User-Agent header. Fingerprinted and labelled, never stored raw. */
  userAgent?: string | null
  /** Called ONLY when the sign-in is from a device this account has not used. */
  notifyNewSignIn?: (n: NewSignInNotice) => void | Promise<void>
}

/**
 * Fingerprint the device and decide whether this sign-in deserves a notice.
 *
 * An account's very FIRST session is never "a new device": at that point every
 * device is new, and a "new sign-in" email arriving seconds after someone chose
 * their own password is noise that teaches people to ignore the real one.
 */
async function prepareDevice(
  input: { sql: PublicInputBase['sql'] } & DeviceInput,
  accountId: string,
): Promise<{ device: DeviceFingerprint; revokeToken: string | null }> {
  const device = fingerprintDevice(accountId, input.userAgent ?? null, input.clientIp ?? null)
  if (input.notifyNewSignIn === undefined) return { device, revokeToken: null }
  const [seenBefore, hadPrior] = await Promise.all([
    hasSeenDevice(input.sql, accountId, device.hash),
    hasAnyPriorSession(input.sql, accountId),
  ])
  if (seenBefore || !hadPrior) return { device, revokeToken: null }
  return { device, revokeToken: generateSessionToken() }
}

/**
 * Fire the new-sign-in seam, if one was armed. Best-effort by construction: a
 * mail failure must never turn a successful, legitimate sign-in into an error,
 * and the session is already minted by the time this runs.
 */
async function announceNewSignIn(
  input: DeviceInput,
  notice: NewSignInNotice | null,
): Promise<void> {
  if (notice === null || input.notifyNewSignIn === undefined) return
  try {
    await input.notifyNewSignIn(notice)
  } catch (err) {
    console.error('[auth] new-sign-in notification failed:', err)
  }
}

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

export interface LoginInput extends PublicInputBase, DeviceInput {
  body: { identifier?: unknown; password?: unknown }
}

/**
 * The login result is a discriminated union (§10 two-step login; migration
 * 0040 forced password change):
 *   - `{ accountId }`             — a full session was minted (session cookie set).
 *   - `{ passwordChangeRequired, pendingToken }`
 *       — the account's must_change_password flag is set (today: only the
 *         bootstrap platform_admin): the password was correct but it is a
 *         temporary/operator-set credential. Checked BEFORE the 2FA branch —
 *         no totpRequired, no session, until POST /api/auth/password/
 *         change-required replaces it. The operator then logs in again.
 *   - `{ totpRequired, pendingToken }`
 *       — a privileged account WITH active TOTP: the password was correct but no
 *         session exists yet. Submit the TOTP/backup code + pendingToken to
 *         POST /api/auth/totp to finish.
 *   - `{ totpEnrollmentRequired, pendingToken }`
 *       — a privileged account WITHOUT TOTP yet: enrollment is forced before any
 *         session. Call POST /api/auth/totp/enroll then /confirm with the token.
 * Both pendingToken kinds are SHORT-LIVED pending states, NOT a session — they
 * confer no authority; only totp/confirm or password/change-required's *next*
 * login mints the session cookie.
 */
export type LoginResult =
  | { accountId: string }
  | { passwordChangeRequired: true; pendingToken: string }
  | { totpRequired: true; pendingToken: string }
  | { totpEnrollmentRequired: true; pendingToken: string }

/** POST /api/auth/login — verify credentials; mint a session OR a pending state; else opaque 401. */
export function login(input: LoginInput): Promise<ControllerResult<LoginResult>> {
  return runPublic(async () => {
    const identifier = reqStr(input.body?.identifier, 'identifier')
    const password = reqStr(input.body?.password, 'password')
    const now = input.now ?? new Date()

    // Resolve the account by email OR username (both citext, case-insensitive).
    const [acct] = await input.sql`
      select id, password_hash, status, must_change_password from account
      where (email = ${identifier} or username = ${identifier})
      limit 1
    `
    // Uniform failure: unknown account, no password set, closed/suspended, or a
    // bad password all yield the same opaque 401 (no enumeration signal).
    if (acct === undefined || acct.password_hash == null) return unauthorized<LoginResult>()
    if (acct.status === 'closed' || acct.status === 'suspended') return unauthorized<LoginResult>()
    const ok = await verifyPassword(acct.password_hash as string, password)
    if (!ok) return unauthorized<LoginResult>()

    const accountId = acct.id as string

    // Migration 0040, checked BEFORE the 2FA branch: a temporary/operator-set
    // credential must be replaced before anything else, including proving a
    // second factor. The password just proven IS the authentication for this
    // step; no session, no totpRequired, until the change-required token is
    // consumed and the operator logs in again.
    if (acct.must_change_password === true) {
      const { token: pendingToken } = await new CredentialTokenService({
        sql: input.sql,
      }).issuePasswordChangeRequired(accountId, { now })
      return { status: 200, body: { passwordChangeRequired: true, pendingToken } }
    }

    // §10 gating: a privileged account (any membership role but student/alumni)
    // needs a second factor. Password alone yields a pending-2FA state, NOT a
    // session — no session cookie is set here.
    const roleRows = await input.sql`
      select distinct role from membership where account_id = ${accountId}
    `
    const roles = roleRows.map((r) => r.role as Role)
    if (requiresTwoFactor(roles)) {
      const twoFactor = new TwoFactorService({ sql: input.sql })
      const activated = await twoFactor.isActivated(accountId)
      const { token: pendingToken } = await twoFactor.issuePendingLogin(accountId, { now })
      return activated
        ? { status: 200, body: { totpRequired: true, pendingToken } }
        : { status: 200, body: { totpEnrollmentRequired: true, pendingToken } }
    }

    // Non-privileged (student / guardian / alumni): password-only, unchanged, and
    // the LONG session lifetime (see the SESSION_TTL_MS note above).
    const expiresAt = sessionExpiresAt(now, false)
    const { device, revokeToken } = await prepareDevice(input, accountId)
    const { token } = await createSession(input.sql, { accountId, expiresAt, device, revokeToken })
    await announceNewSignIn(
      input,
      revokeToken === null
        ? null
        : { accountId, deviceLabel: device.label, ipHint: device.ipHint, at: now, revokeToken },
    )
    return {
      status: 200,
      body: { accountId },
      session: { token, expiresAt },
    }
  })
}

// ---- §10 two-factor: submit the second factor + enrollment (token-gated) -----

export interface SubmitTotpInput extends PublicInputBase, DeviceInput {
  body: { pendingToken?: unknown; code?: unknown }
}

/**
 * POST /api/auth/totp — finish a `totpRequired` login. Resolve the pending-2FA
 * token, verify the TOTP (or a backup) code, consume the pending token, and mint
 * the full session (the adapter sets the cookie). A bad/unknown pending token or
 * a bad code is an opaque failure (401); the rate limit surfaces as 429. Writes
 * the `login.two_factor` access-ledger row.
 */
export function submitTotp(input: SubmitTotpInput): Promise<ControllerResult<{ accountId: string }>> {
  return runPublic(async () => {
    const pendingToken = reqStr(input.body?.pendingToken, 'pendingToken')
    const code = reqStr(input.body?.code, 'code')
    const now = input.now ?? new Date()
    const clientIp = input.clientIp ?? null

    const twoFactor = new TwoFactorService({ sql: input.sql })
    const accountId = await twoFactor.resolvePendingLogin(pendingToken, { now })
    const { method } = await twoFactor.verifySecondFactor(accountId, code, { now, clientIp })
    await twoFactor.consumePendingLogin(pendingToken, { now })

    // Only a PRIVILEGED account ever reaches a TOTP step, so this session takes
    // the short lifetime by construction.
    const expiresAt = sessionExpiresAt(now, true)
    const { device, revokeToken } = await prepareDevice(input, accountId)
    const { token } = await createSession(input.sql, { accountId, expiresAt, device, revokeToken })
    await writeAccessLedger(input.sql, {
      event: 'login.two_factor',
      actorAccountId: accountId,
      subjectAccountId: accountId,
      clientIp,
      detail: { method },
    })
    await announceNewSignIn(
      input,
      revokeToken === null
        ? null
        : { accountId, deviceLabel: device.label, ipHint: device.ipHint, at: now, revokeToken },
    )
    return { status: 200, body: { accountId }, session: { token, expiresAt } }
  })
}

export interface BeginTotpEnrollmentInput extends PublicInputBase {
  body: { pendingToken?: unknown }
}

/**
 * POST /api/auth/totp/enroll — begin forced enrollment for a
 * `totpEnrollmentRequired` login. Resolve the pending-2FA token and return the
 * secret + otpauth:// provisioning URI (NO QR image — the frontend renders it).
 * No session is minted here; the account is not yet active on TOTP.
 */
export function beginTotpEnrollment(
  input: BeginTotpEnrollmentInput,
): Promise<ControllerResult<{ secret: string; otpauthUri: string }>> {
  return runPublic(async () => {
    const pendingToken = reqStr(input.body?.pendingToken, 'pendingToken')
    const now = input.now ?? new Date()
    const twoFactor = new TwoFactorService({ sql: input.sql })
    const accountId = await twoFactor.resolvePendingLogin(pendingToken, { now })
    const { secret, otpauthUri } = await twoFactor.beginEnrollment(accountId, { now })
    return { status: 200, body: { secret, otpauthUri } }
  })
}

export interface ConfirmTotpEnrollmentInput extends PublicInputBase, DeviceInput {
  body: { pendingToken?: unknown; code?: unknown }
}

/**
 * POST /api/auth/totp/confirm — confirm forced enrollment: verify the code
 * against the pending secret, activate TOTP, return the one-time backup codes
 * ONCE, consume the pending token, and mint the full session (cookie set). A bad
 * code is an opaque 401.
 */
export function confirmTotpEnrollment(
  input: ConfirmTotpEnrollmentInput,
): Promise<ControllerResult<{ accountId: string; backupCodes: string[] }>> {
  return runPublic(async () => {
    const pendingToken = reqStr(input.body?.pendingToken, 'pendingToken')
    const code = reqStr(input.body?.code, 'code')
    const now = input.now ?? new Date()
    const clientIp = input.clientIp ?? null

    const twoFactor = new TwoFactorService({ sql: input.sql })
    const accountId = await twoFactor.resolvePendingLogin(pendingToken, { now })
    const { backupCodes } = await twoFactor.confirmEnrollment(accountId, code, { now, clientIp })
    await twoFactor.consumePendingLogin(pendingToken, { now })

    // Forced enrollment only happens for a PRIVILEGED account: short lifetime.
    // No new-sign-in notice fires here even though the device is by definition
    // unfamiliar — this IS the account's first session (prepareDevice's
    // first-session rule), and the person is sitting in front of the enrollment
    // screen that produced it.
    const expiresAt = sessionExpiresAt(now, true)
    const { device } = await prepareDevice(input, accountId)
    const { token } = await createSession(input.sql, { accountId, expiresAt, device })
    return { status: 200, body: { accountId, backupCodes }, session: { token, expiresAt } }
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
  /**
   * The raw reset token, returned to the delivery seam exactly ONCE. Only its
   * SHA-256 hash is persisted (CredentialTokenService), so this value exists only
   * for as long as it takes the mailer to build the link — it must never be
   * logged, stored, or echoed into a response body.
   */
  token: string
  /** When the token stops working, so the message can say so honestly. */
  expiresAt: Date
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
 * POST /api/auth/password/reset-request — uniform, no account-existence oracle.
 * The response is byte-identical whether or not the identifier resolves. When it
 * does, `CredentialTokenService.issuePasswordReset` PERSISTS a token (a regenerate
 * revokes the prior) and returns the computed delivery route (an adult -> their
 * own email; a minor -> their verified guardians, or the Chapter Director for a
 * `self_private` account), which is handed to the delivery seam. When it does not,
 * nothing is persisted and the seam never fires — but the response is identical,
 * so the persisted-token side effect is not an existence oracle. The actual SEND
 * is the deferred mailer seam (the returned token + route).
 *
 * SEAM: rate limiting (05-api-surface) is edge/middleware, not wired here.
 */
export function requestPasswordReset(
  input: RequestPasswordResetInput,
): Promise<ControllerResult<{ requested: true }>> {
  return runPublic(async () => {
    const identifier = reqStr(input.body?.identifier, 'identifier')
    const now = input.now ?? new Date()
    const issued = await new CredentialTokenService({ sql: input.sql }).issuePasswordReset(identifier, {
      now,
    })
    if (issued !== null) {
      const deliver = input.deliver
      if (deliver !== undefined) {
        // Best-effort: a mail failure must not change the response, because a
        // different response for "the send failed" would be an existence oracle
        // (it only ever fires for an identifier that resolved).
        try {
          await deliver({
            accountId: issued.accountId,
            route: issued.route,
            token: issued.token,
            expiresAt: issued.expiresAt,
          })
        } catch (err) {
          console.error('[auth/password/reset-request] delivery failed:', err)
        }
      }
    }
    // Uniform response in every branch — the entire security property.
    return { status: 202, body: { requested: true } }
  })
}

// ---- password reset token pre-flight (the reset FORM's server-side check) ----

export interface CheckPasswordResetTokenInput extends PublicInputBase {
  body: { token?: unknown }
}

/**
 * Is a reset token still usable? A READ used by the page behind a reset link, so
 * it can show "this link has expired or has already been used" BEFORE asking
 * someone to compose a password they are about to lose.
 *
 * Deliberately NOT an app/api route: it is called directly by the server
 * component that renders /reset-password/[token], which keeps the token out of an
 * extra HTTP request (and therefore out of an extra access log). It reveals
 * nothing an unguessable token's holder does not already know, and the three
 * not-usable causes collapse to one answer.
 */
export function checkPasswordResetToken(
  input: CheckPasswordResetTokenInput,
): Promise<ControllerResult<{ usable: boolean }>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const usable = await new CredentialTokenService({ sql: input.sql }).checkPasswordReset(token, {
      now: input.now,
    })
    return { status: 200, body: { usable } }
  })
}

// ---- password reset consume (POST /api/auth/password/reset) -----------------

export interface ResetPasswordInput extends PublicInputBase {
  body: { token?: unknown; newPassword?: unknown }
  /**
   * The "your password was changed" seam, called ONLY after a successful reset.
   * This notice is the one thing that makes an unauthorized reset VISIBLE to the
   * real owner: whoever reset the password holds the mailbox at that moment, but
   * the owner still gets a message they did not ask for and can act on.
   */
  notifyChanged?: (n: { accountId: string; at: Date }) => void | Promise<void>
}

/**
 * POST /api/auth/password/reset — token-gated, unauthenticated (an enumerated
 * actor-less endpoint, 05-api-surface.md). Consumes the reset token: sets the
 * account's argon2id password, marks the token consumed, and revokes the account's
 * prior sessions. An expired, consumed, or unknown token is one opaque 401
 * (InvalidCredentialTokenError -> invalid_token), revealing nothing. A password
 * below the shared policy is a 400 that DOES name the unmet rules — the caller
 * already holds the token, so there is no oracle to protect.
 */
export function resetPassword(input: ResetPasswordInput): Promise<ControllerResult<{ reset: true }>> {
  return runPublic(async () => {
    const token = reqStr(input.body?.token, 'token')
    const newPassword = reqStr(input.body?.newPassword, 'newPassword')
    const now = input.now ?? new Date()
    const { accountId } = await new CredentialTokenService({ sql: input.sql }).consumePasswordReset(
      token,
      newPassword,
      { now },
    )
    if (input.notifyChanged !== undefined) {
      // Best-effort: the password is already changed and the old sessions are
      // already revoked, so a mail failure must not report the reset as failed.
      try {
        await input.notifyChanged({ accountId, at: now })
      } catch (err) {
        console.error('[auth/password/reset] change notification failed:', err)
      }
    }
    return { status: 200, body: { reset: true } }
  })
}

// ---- forced password change consume (POST /api/auth/password/change-required) ----

export interface CompleteRequiredPasswordChangeInput extends PublicInputBase {
  body: { pendingToken?: unknown; newPassword?: unknown }
}

/**
 * POST /api/auth/password/change-required — pending-token-gated (migration
 * 0040), unauthenticated, no actor (runPublic), like /auth/totp. Consumes the
 * password-change-required token minted by login(): sets the account's
 * argon2id password, clears must_change_password, marks the token consumed,
 * and revokes any existing sessions. Mints NO session — the operator must
 * call POST /api/auth/login again with the new password. An expired,
 * consumed, or unknown token is one opaque 401 (InvalidCredentialTokenError ->
 * invalid_token via mapError, same as /auth/password/reset).
 */
export function completeRequiredPasswordChange(
  input: CompleteRequiredPasswordChangeInput,
): Promise<ControllerResult<{ passwordChanged: true }>> {
  return runPublic(async () => {
    const pendingToken = reqStr(input.body?.pendingToken, 'pendingToken')
    const newPassword = reqStr(input.body?.newPassword, 'newPassword')
    await new CredentialTokenService({ sql: input.sql }).consumePasswordChangeRequired(
      pendingToken,
      newPassword,
      { now: input.now },
    )
    return { status: 200, body: { passwordChanged: true } }
  })
}

// ---- impersonation (POST | DELETE /api/auth/impersonate) --------------------

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
 * target is a minor; both actor fields set). The platform-admin gate now routes
 * through `authorize(ctx, 'impersonation.start', …)` (a first-class registry
 * capability: scope 'platform', writes:true — a `platform_admin` satisfies it via
 * the platform override, a `platform_staff` does NOT), restoring the
 * single-code-path invariant: a deny writes one reasoned permission.denied row and
 * throws Forbidden, surfacing as an opaque 403. The read-only-for-a-minor rule and
 * the 30-minute expiry are enforced by `createImpersonationSession` and the
 * database trigger floor. The adapter sets the returned token as the session cookie.
 */
export function startImpersonation(
  input: StartImpersonationInput,
): Promise<ControllerResult<StartImpersonationResult>> {
  return runAuthed<StartImpersonationResult>(input, async (ctx, sql) => {
    const targetAccountId = reqStr(input.body?.targetAccountId, 'targetAccountId')
    // Gate through `authorize` BEFORE any lookup or session mint. A non-admin
    // (including a platform_staff) denies here — Forbidden -> opaque 403.
    const resource: Resource = { id: targetAccountId, subjectAccountId: targetAccountId }
    await authorize(ctx, 'impersonation.start', resource, { sql })

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
