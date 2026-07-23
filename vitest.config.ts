import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 240_000,
    // startHarness() (packages/http/test/helpers/pg.ts) reads its connection
    // info via vitest inject('curiolabPg'), which only a globalSetup can
    // provide — the same one packages/http's own vitest.config.ts uses, so the
    // embedded Postgres + migrated template is shared with that package's
    // convention rather than reinvented here.
    globalSetup: ['./packages/db/test/helpers/global-pg.ts'],
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
})
