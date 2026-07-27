// Print a currently-valid 2FA code for a LOCAL DEV account.
//
//   npm run dev:totp                    # the single director/admin account
//   npm run dev:totp -- someone@x.org   # a specific account
//
// Why this exists: the dev database's operator account has TOTP activated, and
// the enrolling authenticator app is not necessarily to hand when you are
// testing a flow locally. Rather than tearing down 2FA (which changes what you
// are testing) or pasting the shared secret around, this reads the secret from
// the local database and derives the current code the same way the login
// endpoint verifies it.
//
// DEVELOPMENT ONLY. It reads DATABASE_URL from the repo .env, so it can only
// ever talk to whatever database you have configured locally. Never point it at
// production, and never commit a secret it prints (it prints codes, not the
// secret, precisely so there is nothing lasting to leak).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { totp, TOTP_STEP_SECONDS } from '../packages/runtime/src/totp.ts'

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
    ? await sql`select email, totp_secret, totp_activated_at from account where email = ${wanted}`
    : await sql`select email, totp_secret, totp_activated_at from account where totp_secret is not null order by created_at limit 2`

  if (rows.length === 0) {
    console.error(wanted ? `No account found for ${wanted}.` : 'No account has TOTP set up.')
    process.exit(1)
  }
  if (rows.length > 1) {
    console.error('More than one account has TOTP. Pass the email you want:')
    for (const r of rows) console.error(`  npm run dev:totp -- ${r.email}`)
    process.exit(1)
  }

  const acct = rows[0]
  if (!acct.totp_secret) {
    console.log(`${acct.email} has no TOTP secret — password alone signs in.`)
    process.exit(0)
  }

  const now = Date.now()
  const secondsLeft = TOTP_STEP_SECONDS - (Math.floor(now / 1000) % TOTP_STEP_SECONDS)
  console.log(`account   ${acct.email}`)
  console.log(`code      ${totp(acct.totp_secret, now)}`)
  console.log(`expires   in ${secondsLeft}s`)
  console.log(`next      ${totp(acct.totp_secret, now + TOTP_STEP_SECONDS * 1000)}`)
  console.log('')
  console.log('The login step accepts the previous and next code too, so either works.')
} finally {
  await sql.end()
}
