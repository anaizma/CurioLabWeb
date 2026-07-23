// -------------------------------------------------------------------------
// Vitest globalSetup: ONE embedded Postgres per package (per vitest process).
//
// The old harness booted a fresh embedded Postgres — initdb + start + every
// migration — in each test file's beforeAll, on a FIXED port. That made the
// full run slow (a boot dwarfs the tests) and made running files/packages
// together collide on the port.
//
// Instead we boot a single instance here, once, on an EPHEMERAL free port, and
// apply the ordered migrations into a TEMPLATE database. Each test file then
// gets its own clean-slate database in milliseconds via `CREATE DATABASE …
// TEMPLATE <tmpl>` (see helpers/pg.ts) instead of a whole new server. The
// clone preserves the current per-file isolation exactly; the roles the
// migrations create are cluster-global, so they are created once here.
//
// Connection info is handed to the test workers via vitest `provide`/`inject`
// (env mutation does not reliably cross the worker boundary).
// -------------------------------------------------------------------------

import EmbeddedPostgres from 'embedded-postgres'
import postgres from 'postgres'
import { createServer } from 'node:net'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GlobalSetupContext } from 'vitest/node'
import { TEMPLATE_DB } from './pg-types.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')

function migrationFiles(uptoInclusive: string | null): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  if (!uptoInclusive) return files
  return files.filter((f) => f <= `${uptoInclusive}_zzzz.sql`)
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const upto = process.env.CURIOLAB_MIGRATE_UPTO ?? null
  const dir = mkdtempSync(join(tmpdir(), 'curiolab-pg-'))
  const port = await freePort()

  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  await pg.initialise()
  await pg.start()

  // Build the template once: create it, apply the ordered migrations into it,
  // then release the connection (CREATE DATABASE … TEMPLATE needs no sessions on
  // the template). The migrations' CREATE ROLE statements are cluster-global and
  // therefore run exactly once here.
  const admin = postgres(`postgres://postgres:postgres@localhost:${port}/postgres`, {
    onnotice: () => {},
    max: 1,
  })
  await admin.unsafe(`CREATE DATABASE ${TEMPLATE_DB}`)
  await admin.end({ timeout: 5 })

  const tmpl = postgres(`postgres://postgres:postgres@localhost:${port}/${TEMPLATE_DB}`, {
    onnotice: () => {},
    max: 1,
  })
  for (const file of migrationFiles(upto)) {
    const ddl = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    await tmpl.unsafe(ddl)
  }
  await tmpl.end({ timeout: 5 })

  provide('curiolabPg', { port, template: TEMPLATE_DB, upto })

  return async (): Promise<void> => {
    await pg.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
