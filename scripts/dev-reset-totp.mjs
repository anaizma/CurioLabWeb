// Clear a LOCAL DEV account's 2FA enrollment so it re-enrolls at next login.
//
//   npm run dev:reset-totp                    # the single director/admin account
//   npm run dev:reset-totp -- someone@x.org   # a specific account
//
// Why this exists: TOTP enrollment is one-way. beginEnrollment and
// enrollAndActivate both throw TotpAlreadyActivatedError once a secret is
// active, and there is no regenerate-backup-codes path, so an account that is
// already enrolled can never reach the enrollment screen again. That is correct
// for production (re-enrolling on demand would be a way around the second
// factor) but it makes the screen impossible to test, and it strands anyone
// whose secret only ever lived in the database.
//
// Clearing the three columns puts the account back in the state a brand new
// privileged account is in. It cannot lock anyone out: a privileged account
// still REQUIRES a second factor, so the next login is forced into enrollment
// rather than being let through without one.
//
// DEVELOPMENT ONLY. It reads DATABASE_URL from the repo .env and refuses to run
// against anything that is not local. The production answer to "the director
// lost their phone and their backup codes" is a reviewed operator flow with an
// audit trail, not this file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(repoRoot, '.env')

if (!fs.existsSync(envPath)) {
  console.error('No .env found at the repo root; cannot resolve DATABASE_URL.')
  process.exit(1)
}
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)

const dbUrl = process.env.DATABASE_URL ?? env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
// Guard against an accidental production pointer.
if (!/localhost|127\.0\.0\.1/.test(dbUrl)) {
  console.error('Refusing to run: DATABASE_URL does not look local. This is a dev-only helper.')
  process.exit(1)
}

const sql = postgres(dbUrl)
try {
  const wanted = process.argv[2]
  const rows = wanted
    ? await sql`select id, email, totp_activated_at from account where email = ${wanted}`
    : await sql`select id, email, totp_activated_at from account where totp_secret is not null order by created_at limit 2`

  if (rows.length === 0) {
    console.error(wanted ? `No account found for ${wanted}.` : 'No account has TOTP set up; nothing to clear.')
    process.exit(1)
  }
  if (rows.length > 1) {
    console.error('More than one account has TOTP. Pass the email you want:')
    for (const r of rows) console.error(`  npm run dev:reset-totp -- ${r.email}`)
    process.exit(1)
  }

  const acct = rows[0]
  await sql`
    update account
       set totp_secret = null, totp_activated_at = null, totp_last_step = null
     where id = ${acct.id}
  `

  console.log(`account   ${acct.email}`)
  console.log(`was       ${acct.totp_activated_at ? `enrolled ${acct.totp_activated_at.toISOString()}` : 'not enrolled'}`)
  console.log('now       cleared')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Sign out if you are signed in, then open /login.')
  console.log('  2. Enter the email and password. You will be sent to the enrollment screen.')
  console.log('  3. Scan the QR with your authenticator app, or type the setup key by hand.')
  console.log('  4. SAVE THE BACKUP CODES. That screen is the only time they are readable.')
} finally {
  await sql.end()
}
