// -------------------------------------------------------------------------
// §2 — the guarded first-platform-admin bootstrap.
//
// The ONE legitimate account with no inviter (everything else originates from an
// invite tied to a roster entry). This is the framework-agnostic, idempotent
// core; a thin runnable wrapper (scripts/bootstrap-admin.ts, npm `seed:admin`)
// reads the password from the environment and calls it.
//
// GUARD 1: it refuses to create a second platform_admin — if ANY platform_admin
// membership already exists, it is a no-op that reports the existing admin and
// creates nothing. Safe to re-run — this is the expected, documented shape of
// a second invocation (docs/platform/deploy/bootstrap-admin.md).
//
// GUARD 2: it refuses (throws) if the database has ANY existing account but no
// platform_admin. Unlike GUARD 1 this is NOT the expected precondition — this
// seed is meant to run exactly once, against a freshly migrated, empty
// database — so a non-empty, admin-less database most likely means the wrong
// DATABASE_URL was supplied (e.g. pointed at a database already carrying
// synthetic test data, or a real database mid-migration). A hard failure here
// is deliberately louder than GUARD 1's graceful no-op.
//
// SECURITY: the password arrives as an argument the operator sourced from the
// environment; it is argon2id-hashed and NEVER logged. The account is created
// with must_change_password = true (migration 0040): the operator-supplied
// seed password is a temporary/out-of-band credential, and login() withholds a
// session until it is replaced via POST /api/auth/password/change-required.
// TOTP is enrolled and activated in the same transaction; the secret +
// provisioning URI + one-time backup codes are RETURNED (for the runnable
// wrapper to print to the operator once), never persisted in plaintext.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { hashPassword } from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { TwoFactorService } from './two-factor.js'

/**
 * Thrown by GUARD 2: the database already has account rows but no
 * platform_admin yet. Not the expected precondition for this seed.
 */
export class BootstrapDatabaseNotEmptyError extends Error {
  constructor() {
    super(
      'Refusing to bootstrap the first platform admin: the database already has ' +
        'account rows and no platform_admin exists yet. This seed is meant to run ' +
        'exactly once, against a freshly migrated, empty database — a non-empty, ' +
        'admin-less database usually means the wrong DATABASE_URL was supplied.',
    )
    this.name = 'BootstrapDatabaseNotEmptyError'
  }
}

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

  // GUARD 1: refuse if any platform_admin already exists. Idempotent no-op —
  // safe to re-run.
  const [existing] = await sql`
    select account_id from membership where role = 'platform_admin' limit 1
  `
  if (existing !== undefined) {
    return { created: false, adminAccountId: existing.account_id as string }
  }

  // GUARD 2: refuse (hard fail) if the database already has ANY account. A
  // non-empty, admin-less database is not this seed's expected precondition.
  const [existingAccount] = await sql`select id from account limit 1`
  if (existingAccount !== undefined) {
    throw new BootstrapDatabaseNotEmptyError()
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
        credential_owner, status, maturation_state, password_hash,
        must_change_password
      ) values (
        ${input.email}, ${input.legalName}, ${displayName}, ${dob}, 'staff_entered',
        'self_private', 'active', 'self_managed', ${passwordHash},
        true
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
