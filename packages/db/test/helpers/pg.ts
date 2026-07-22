// -------------------------------------------------------------------------
// Test harness: a real Postgres via embedded-postgres (no Docker), with the
// ordered SQL migrations applied. One instance per test file (beforeAll).
//
// The database guarantees under test are triggers, partial indexes, generated
// columns, PL/pgSQL, and per-role GRANTs, none of which an in-memory fake can
// honour, so these tests run against an actual Postgres binary.
// -------------------------------------------------------------------------

import EmbeddedPostgres from 'embedded-postgres'
import postgres, { type Sql } from 'postgres'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

let portCounter = 55_432

export interface Harness {
  /** Superuser (table owner) connection. */
  sql: Sql
  /** Open a new connection authenticating as a specific Postgres role. */
  connectAs: (role: string, password: string) => Sql
  end: () => Promise<void>
}

export interface StartOptions {
  /**
   * Apply migrations only up to and including the file whose name starts with
   * this prefix (e.g. '0000'). Used to demonstrate the red state before a
   * guarantee migration exists. Omit to apply every migration.
   */
  uptoInclusive?: string
}

function migrationFiles(uptoInclusive?: string): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  if (!uptoInclusive) return files
  return files.filter((f) => f <= `${uptoInclusive}_zzzz.sql`)
}

export async function startHarness(opts: StartOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'curiolab-db-'))
  const port = portCounter++
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  await pg.initialise()
  await pg.start()

  const url = `postgres://postgres:postgres@localhost:${port}/postgres`
  const sql = postgres(url, { onnotice: () => {}, max: 4 })

  for (const file of migrationFiles(opts.uptoInclusive)) {
    const ddl = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    // Simple-query protocol: runs the whole file (multiple statements,
    // dollar-quoted function bodies) exactly as psql would.
    await sql.unsafe(ddl)
  }

  const extra: Sql[] = []
  const connectAs = (role: string, password: string): Sql => {
    const c = postgres(`postgres://${role}:${password}@localhost:${port}/postgres`, {
      onnotice: () => {},
      max: 2,
    })
    extra.push(c)
    return c
  }

  const end = async (): Promise<void> => {
    await Promise.all(extra.map((c) => c.end({ timeout: 5 })))
    await sql.end({ timeout: 5 })
    await pg.stop()
    rmSync(dir, { recursive: true, force: true })
  }

  return { sql, connectAs, end }
}
