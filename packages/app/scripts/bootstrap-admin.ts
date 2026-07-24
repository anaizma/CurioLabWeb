// -------------------------------------------------------------------------
// Runnable wrapper for the §2 first-platform-admin bootstrap.
//
//   npm run seed:admin --workspace @curiolab/app
//
// Reads the connection + inputs from the environment (NEVER a hardcoded secret,
// NEVER the root .env), calls the idempotent bootstrapPlatformAdmin core, and
// prints the TOTP secret / provisioning URI / one-time backup codes to the
// operator ONCE. The password is taken from CURIOLAB_BOOTSTRAP_PASSWORD and is
// never echoed. See docs/platform/deploy/bootstrap-admin.md for the runbook.
//
// Required env:
//   DATABASE_URL                  postgres connection string
//   CURIOLAB_BOOTSTRAP_EMAIL      the admin login email
//   CURIOLAB_BOOTSTRAP_NAME       the admin legal name
//   CURIOLAB_BOOTSTRAP_PASSWORD   the admin password (never logged)
// Optional:
//   CURIOLAB_BOOTSTRAP_DOB        YYYY-MM-DD (defaults to an adult placeholder)
// -------------------------------------------------------------------------

import postgres from 'postgres'
import { bootstrapPlatformAdmin } from '../src/bootstrap-admin.js'

function requireEnv(name: string): string {
  const v = process.env[name]
  if (v === undefined || v.trim() === '') {
    console.error(`missing required env var: ${name}`)
    process.exit(2)
  }
  return v
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL')
  const email = requireEnv('CURIOLAB_BOOTSTRAP_EMAIL')
  const legalName = requireEnv('CURIOLAB_BOOTSTRAP_NAME')
  const password = requireEnv('CURIOLAB_BOOTSTRAP_PASSWORD')
  const dateOfBirth = process.env.CURIOLAB_BOOTSTRAP_DOB

  const sql = postgres(databaseUrl, { onnotice: () => {} })
  try {
    const res = await bootstrapPlatformAdmin(sql, { legalName, email, password, dateOfBirth })
    if (!res.created) {
      console.error(
        `A platform_admin already exists (account ${res.adminAccountId}). ` +
          `Bootstrap is a no-op — refusing to create a second admin.`,
      )
      process.exitCode = 1
      return
    }
    // Emitted ONCE — the operator must record these now. Not the password.
    console.log('Platform admin created.')
    console.log(`  account id:   ${res.adminAccountId}`)
    console.log(`  home chapter: ${res.chapterId}`)
    console.log(`  login email:  ${email}`)
    console.log('')
    console.log('  TOTP secret (add to your authenticator app now):')
    console.log(`    ${res.secret}`)
    console.log('  otpauth:// provisioning URI (render as a QR if you prefer):')
    console.log(`    ${res.otpauthUri}`)
    console.log('')
    console.log('  One-time backup codes (store securely; each works once):')
    for (const code of res.backupCodes ?? []) console.log(`    ${code}`)
    console.log('')
    console.log('At first login: enter your password, then the current TOTP code.')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err: unknown) => {
  console.error('bootstrap failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
