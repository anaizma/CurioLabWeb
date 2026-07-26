// -------------------------------------------------------------------------
// Migration runner: apply the ordered SQL migrations in ./migrations to the
// database at DATABASE_URL, tracking applied files in a `schema_migrations`
// table so re-runs are idempotent and future migrations apply cleanly.
//
// The test harness (test/helpers/global-pg.ts) applies migrations to a fresh
// TEMPLATE database on every run; that never touched a long-lived dev/prod DB,
// so a dev database drifted behind the code. This is the missing companion:
// the way to bring a REAL database current.
//
//   node migrate.mjs                     apply every not-yet-recorded migration
//   node migrate.mjs --baseline 0021     first, RECORD (without running) every
//                                        migration numbered <= 0021 as already
//                                        applied — use once to adopt a database
//                                        that was migrated by hand up to 0021,
//                                        so only 0022+ actually run.
//
// DATABASE_URL is read from the environment, or from the repo-root .env.
// Each file is applied with sql.unsafe (multi-statement DDL), mirroring the
// harness; a failure stops the run and is NOT recorded, so it is safe to fix
// and re-run (earlier, recorded migrations are skipped).
// -------------------------------------------------------------------------

import postgres from 'postgres'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(here, 'migrations')
const ROOT = join(here, '..', '..')

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(join(ROOT, '.env'))
  } catch {
    // no .env — rely on the ambient environment
  }
}
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (checked the environment and the repo-root .env)')
  process.exit(1)
}

const args = process.argv.slice(2)
const baselineIdx = args.indexOf('--baseline')
const baseline = baselineIdx >= 0 ? args[baselineIdx + 1] : null
const migNumber = (f) => f.slice(0, 4)

const sql = postgres(url, { onnotice: () => {}, max: 1 })
try {
  await sql`
    create table if not exists schema_migrations (
      filename   text primary key,
      applied_at timestamptz not null default now()
    )`
  const applied = new Set((await sql`select filename from schema_migrations`).map((r) => r.filename))
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()

  if (baseline) {
    let recorded = 0
    for (const f of files) {
      if (migNumber(f) <= baseline && !applied.has(f)) {
        await sql`insert into schema_migrations (filename) values (${f}) on conflict do nothing`
        applied.add(f)
        recorded += 1
      }
    }
    console.log(`baseline ${baseline}: recorded ${recorded} prior migration(s) as applied (not executed)`)
  }

  const pending = files.filter((f) => !applied.has(f))
  if (pending.length === 0) {
    console.log('database is up to date — no pending migrations')
  }
  for (const f of pending) {
    process.stdout.write(`applying ${f} ... `)
    await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    await sql`insert into schema_migrations (filename) values (${f})`
    console.log('ok')
  }
  if (pending.length > 0) console.log(`\napplied ${pending.length} migration(s); database is now current`)
} catch (e) {
  console.error(`\nMIGRATION FAILED: ${e.message}`)
  console.error('(the failing migration was not recorded; fix and re-run — recorded migrations are skipped)')
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
