// -------------------------------------------------------------------------
// The privileged-role set that mandates two-factor auth (admin/director backend
// §10). The login gate requires a second factor for any account whose
// memberships include one of these roles.
//
// "Privileged" is every staff / teaching / platform role — the whole role set
// EXCEPT the two youth-side roles (student, alumni). This is deliberately BROADER
// than the work order's illustrative "admin/platform_admin, director,
// mentor/instructor": a `platform_staff` holds a cross-chapter read override and
// a `comms_associate` drafts newsletters, so both must carry 2FA too, and
// excluding-by-youth-role is the safer, single-line invariant than an
// allowlist that could silently drop a new staff role. Guardians hold no
// membership role, so they are password-only like students. This is the single
// source of truth the http login gate reads.
// -------------------------------------------------------------------------

import { ALL_ROLES, type Role } from './types.js'

/** Roles that are NOT privileged — the youth-side, password-only roles. */
const NON_PRIVILEGED_ROLES: readonly Role[] = ['student', 'alumni']

/** Every role that mandates a second factor at login (all but student/alumni). */
export const PRIVILEGED_ROLES: readonly Role[] = ALL_ROLES.filter(
  (r) => !NON_PRIVILEGED_ROLES.includes(r),
)

/** True when any of the account's membership roles is privileged (2FA required). */
export function requiresTwoFactor(roles: readonly Role[]): boolean {
  return roles.some((r) => PRIVILEGED_ROLES.includes(r))
}
