import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // One embedded Postgres instance is spun up per file in beforeAll; the
    // startup + migration cost dwarfs the tests, so give the suite room.
    testTimeout: 60_000,
    hookTimeout: 240_000,
    // A single shared Postgres instance means tests must not race each other.
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
})
