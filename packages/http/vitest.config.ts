import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The route-smoke tests import the real Next.js route modules from app/, and
// those routes import shared frontend helpers via the repo's `@/*` alias
// (tsconfig paths). Vitest does not read tsconfig paths, so the alias is
// declared here too — otherwise importing a route that uses `@/lib/...` fails to
// resolve and the smoke test errors before it can assert anything.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${repoRoot}/` }],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // ONE embedded Postgres is booted per package by globalSetup on an ephemeral
    // port; each test file clones its own clean-slate database from a migrated
    // template (helpers/pg.ts), so no per-file boot and no fixed-port collision.
    globalSetup: ['../db/test/helpers/global-pg.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    // A single shared Postgres instance means tests must not race.
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
})
