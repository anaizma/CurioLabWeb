// -------------------------------------------------------------------------
// The shared db client singleton the Next route adapters hand to the
// controllers in production, built lazily from DATABASE_URL. Tests inject the
// embedded-Postgres `sql` via `setSqlForTesting` so a controller/route runs
// against the harness without a real DATABASE_URL.
// -------------------------------------------------------------------------

import postgres, { type Sql } from 'postgres'

let override: Sql | null = null
let singleton: Sql | null = null

/** Inject a db handle (embedded-Postgres) for tests; pass `null` to clear. */
export function setSqlForTesting(sql: Sql | null): void {
  override = sql
}

/** The process-wide db client. Prefers a test override, else DATABASE_URL. */
export function getSql(): Sql {
  if (override !== null) return override
  if (singleton === null) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    singleton = postgres(url)
  }
  return singleton
}
