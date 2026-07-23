// -------------------------------------------------------------------------
// Session-to-AuthContext resolution. The one place the HTTP layer turns an
// opaque session token into the by-value AuthContext that `can`/`authorize`
// consume (03-authorization.md: "Built once per request from indexed reads").
//
// Resolution:
//   1. validateSession — decision-time expiry/revocation against `now`. Null
//      (unknown/expired/revoked token) resolves to a null context: the caller
//      denies with an opaque 403 and writes NO audit (there is no actor).
//   2. The EFFECTIVE identity is the impersonated account when present, else the
//      session account. Its standing, age (from DOB), maturation, and credential
//      owner form ctx.account.
//   3. memberships, verified guardianship edges (guardianOf), and the consent
//      snapshots for the actor + their children (consentsByChild) are read once.
// Nothing downstream re-queries roles or consent.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type {
  AccountStatus,
  AuthContext,
  ConsentSet,
  ConsentType,
  CredentialOwner,
  MaturationState,
  Membership,
  MembershipStatus,
  Role,
  SessionContext,
} from '@curiolab/core'
import { validateSession } from '@curiolab/runtime'

/** Whole years from `dob` to `at` (birthday-aware, UTC). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

/** An ISO `YYYY-MM-DD` date column to epoch ms (UTC midnight), or null. */
function dateMs(v: string | null): number | null {
  return v == null ? null : Date.parse(`${v}T00:00:00Z`)
}

/**
 * Resolve `token` to a full AuthContext, or `null` when there is no live
 * session. `null` is the signal an authed controller turns into an opaque 403.
 */
export async function resolveAuthContext(
  sql: Sql,
  token: string | null,
  now: Date,
): Promise<AuthContext | null> {
  if (!token) return null
  const s = await validateSession(sql, token, now)
  if (s === null) return null

  // The effective identity is the impersonated account when one is named.
  const effectiveAccountId = s.impersonatedAccountId ?? s.accountId

  const [acct] = await sql`
    select id, status, date_of_birth::text as dob, maturation_state, credential_owner
    from account where id = ${effectiveAccountId}
  `
  if (acct === undefined) return null

  const age = ageInYears(new Date(acct.dob as string), now)

  const memRows = await sql`
    select chapter_id, role, status, pod_id, current_tier,
           active_from::text as active_from, active_until::text as active_until
    from membership where account_id = ${effectiveAccountId}
  `
  const memberships: Membership[] = memRows.map((r) => ({
    chapter_id: r.chapter_id as string,
    role: r.role as Role,
    status: r.status as MembershipStatus,
    pod_id: (r.pod_id as string | null) ?? null,
    tier: (r.current_tier as Membership['tier']) ?? null,
    active_from: dateMs(r.active_from as string | null),
    active_until: dateMs(r.active_until as string | null),
  }))

  // Verified edges only; a lapsed/revoked/pending edge confers no authority and
  // is absent from guardianOf (03-authorization.md).
  const gRows = await sql`
    select student_account_id from guardianship
    where guardian_account_id = ${effectiveAccountId} and status = 'verified'
  `
  const guardianOf = gRows.map((r) => r.student_account_id as string)

  // Consent snapshots for the actor (own consents) and each verified child.
  const subjectIds = [effectiveAccountId, ...guardianOf]
  const consentsByChild = new Map<string, ConsentSet>()
  const cRows = await sql`
    select student_account_id, type, active, scope_ref
    from consent_current where student_account_id in ${sql(subjectIds)}
  `
  for (const r of cRows) {
    const key = r.student_account_id as string
    let set = consentsByChild.get(key)
    if (set === undefined) {
      set = {}
      consentsByChild.set(key, set)
    }
    set[r.type as ConsentType] = {
      active: r.active as boolean,
      scopeRef: (r.scope_ref as string | null) ?? null,
    }
  }

  const session: SessionContext = {
    mode: s.mode,
    expires_at: s.expiresAt.getTime(),
    revoked_at: s.revokedAt ? s.revokedAt.getTime() : null,
    ...(s.impersonatedAccountId
      ? {
          impersonation: {
            real_actor_account_id: s.realActorAccountId ?? s.accountId,
            impersonated_account_id: s.impersonatedAccountId,
          },
        }
      : {}),
  }

  return {
    now: now.getTime(),
    account: {
      id: acct.id as string,
      status: acct.status as AccountStatus,
      age,
      maturation_state: acct.maturation_state as MaturationState,
      credential_owner: acct.credential_owner as CredentialOwner,
    },
    session,
    memberships,
    guardianOf,
    consentsByChild,
  }
}
