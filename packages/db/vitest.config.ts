import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // ONE embedded Postgres is booted per package by globalSetup on an ephemeral
    // port; each test file clones its own clean-slate database from a migrated
    // template (helpers/pg.ts), so no per-file boot and no fixed-port collision.
    globalSetup: ['./test/helpers/global-pg.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    // A single shared Postgres instance means tests must not race each other.
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
})
