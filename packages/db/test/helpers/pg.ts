// -------------------------------------------------------------------------
// Test harness: a real Postgres via embedded-postgres (no Docker), with the
// ordered SQL migrations applied.
//
// The embedded server is booted ONCE per package by the vitest globalSetup
// (helpers/global-pg.ts), which also applies the migrations into a template
// database. Each test file gets its OWN clean-slate database, cloned cheaply
// from that template with `CREATE DATABASE … TEMPLATE`, and drops it on
// teardown — so the current per-file isolation is preserved without booting a
// whole new Postgres per file (which is what made the full run slow and made
// running files/packages together collide on a fixed port).
//
// The database guarantees under test are triggers, partial indexes, generated
// columns, PL/pgSQL, and per-role GRANTs, none of which an in-memory fake can
// honour, so these tests run against an actual Postgres binary.
// -------------------------------------------------------------------------

import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'
import { inject } from 'vitest'

// Re-export the shared type/constant so callers keep importing them from here.
export { TEMPLATE_DB, type PgHandle } from './pg-types.js'

export interface Harness {
  /** Superuser (table owner) connection to this file's own database. */
  sql: Sql
  /** Open a new connection to this file's database authenticating as a role. */
  connectAs: (role: string, password: string) => Sql
  end: () => Promise<void>
}

export interface StartOptions {
  /**
   * Apply migrations only up to and including the file whose name starts with
   * this prefix (e.g. '0000'). Used to demonstrate the red state before a
   * guarantee migration exists. Omit to apply every migration.
   *
   * The migration level is baked into the shared template by globalSetup from
   * the SAME `CURIOLAB_MIGRATE_UPTO` env the callers pass through, so a request
   * that disagrees with the template is a mismatch we reject loudly rather than
   * silently clone the wrong schema.
   */
  uptoInclusive?: string
}

export async function startHarness(opts: StartOptions = {}): Promise<Harness> {
  const handle = inject('curiolabPg')
  const requested = opts.uptoInclusive ?? null
  if (requested !== handle.upto) {
    throw new Error(
      `harness migration level mismatch: this file asked for uptoInclusive=${
        requested ?? '(all)'
      } but the shared template was built at ${
        handle.upto ?? '(all)'
      }. Set CURIOLAB_MIGRATE_UPTO to match, or run this file alone.`,
    )
  }

  const { port, template } = handle
  const dbName = `test_${randomUUID().replace(/-/g, '')}`

  // Clone this file's clean-slate database from the migrated template. The admin
  // connection targets the `postgres` maintenance database so it can create and
  // later drop `dbName` (you cannot drop a database you are connected to).
  const admin = postgres(`postgres://postgres:postgres@localhost:${port}/postgres`, {
    onnotice: () => {},
    max: 1,
  })
  await admin.unsafe(`CREATE DATABASE ${dbName} TEMPLATE ${template}`)

  const url = `postgres://postgres:postgres@localhost:${port}/${dbName}`
  const sql = postgres(url, { onnotice: () => {}, max: 4 })

  const extra: Sql[] = []
  const connectAs = (role: string, password: string): Sql => {
    const c = postgres(`postgres://${role}:${password}@localhost:${port}/${dbName}`, {
      onnotice: () => {},
      max: 2,
    })
    extra.push(c)
    return c
  }

  const end = async (): Promise<void> => {
    await Promise.all(extra.map((c) => c.end({ timeout: 5 })))
    await sql.end({ timeout: 5 })
    // FORCE terminates any lingering backend so the drop cannot hang.
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
    await admin.end({ timeout: 5 })
  }

  return { sql, connectAs, end }
}
