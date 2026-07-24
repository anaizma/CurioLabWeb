// -------------------------------------------------------------------------
// §2 — the guarded first-platform-admin bootstrap.
//
// The ONE legitimate account with no inviter (everything else originates from an
// invite tied to a roster entry). This is the framework-agnostic, idempotent
// core; a thin runnable wrapper (scripts/bootstrap-admin.ts, npm `seed:admin`)
// reads the password from the environment and calls it.
//
// GUARD: it refuses to create a second platform_admin — if ANY platform_admin
// membership already exists, it is a no-op that reports the existing admin and
// creates nothing. Safe to re-run.
//
// SECURITY: the password arrives as an argument the operator sourced from the
// environment; it is argon2id-hashed and NEVER logged. TOTP is enrolled and
// activated in the same transaction; the secret + provisioning URI + one-time
// backup codes are RETURNED (for the runnable wrapper to print to the operator
// once), never persisted in plaintext.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { hashPassword } from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { TwoFactorService } from './two-factor.js'

export interface BootstrapAdminInput {
  legalName: string
  email: string
  /** The plaintext password — sourced from the operator's env, argon2id-hashed, never logged. */
  password: string
  /** The admin's DOB (an adult). Defaults to a fixed adult placeholder. */
  dateOfBirth?: string
  /** The display name shown in the UI; defaults to the legal name. */
  displayName?: string
}

export interface BootstrapAdminResult {
  created: boolean
  adminAccountId: string | null
  /** The home chapter the platform_admin membership is attached to. */
  chapterId?: string
  /** Emitted ONCE on creation for the operator to record; absent on the no-op path. */
  secret?: string
  otpauthUri?: string
  backupCodes?: string[]
}

/** The canonical platform home chapter the first admin's membership attaches to. */
const PLATFORM_CHAPTER_SLUG = 'platform'

export async function bootstrapPlatformAdmin(
  sql: Sql,
  input: BootstrapAdminInput,
  opts: { now?: Date; config?: Partial<AppConfig> } = {},
): Promise<BootstrapAdminResult> {
  const now = opts.now ?? new Date()
  const config = { ...defaultConfig, ...opts.config }

  // GUARD: refuse if any platform_admin already exists. Idempotent no-op.
  const [existing] = await sql`
    select account_id from membership where role = 'platform_admin' limit 1
  `
  if (existing !== undefined) {
    return { created: false, adminAccountId: existing.account_id as string }
  }

  const passwordHash = await hashPassword(input.password)
  const dob = input.dateOfBirth ?? '1970-01-01'
  const displayName = input.displayName ?? input.legalName

  const adminAccountId = await sql.begin(async (tx) => {
    // Find or create the platform home chapter (membership.chapter_id is NOT NULL,
    // and a platform_admin is represented as a membership row like any other role).
    const [chap] = await tx`select id from chapter where slug = ${PLATFORM_CHAPTER_SLUG} limit 1`
    const chapterId =
      (chap?.id as string | undefined) ??
      ((
        await tx`
          insert into chapter (name, slug, tier, status, timezone)
          values ('Platform', ${PLATFORM_CHAPTER_SLUG}, 'seed', 'active', 'America/New_York')
          returning id
        `
      )[0]!.id as string)

    const [acct] = await tx`
      insert into account (
        email, legal_name, display_name, date_of_birth, dob_provenance,
        credential_owner, status, maturation_state, password_hash
      ) values (
        ${input.email}, ${input.legalName}, ${displayName}, ${dob}, 'staff_entered',
        'self_private', 'active', 'self_managed', ${passwordHash}
      ) returning id
    `
    const accountId = acct!.id as string
    await tx`
      insert into membership (account_id, chapter_id, role, status)
      values (${accountId}, ${chapterId}, 'platform_admin', 'active')
    `
    return { accountId, chapterId }
  })

  // Enroll + activate TOTP (its own transaction inside the service).
  const twoFactor = new TwoFactorService({ sql, config })
  const enrolled = await twoFactor.enrollAndActivate(adminAccountId.accountId, { now })

  return {
    created: true,
    adminAccountId: adminAccountId.accountId,
    chapterId: adminAccountId.chapterId,
    secret: enrolled.secret,
    otpauthUri: enrolled.otpauthUri,
    backupCodes: enrolled.backupCodes,
  }
}
