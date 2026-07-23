import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each test file spins up an embedded Postgres per file in beforeAll; the
    // startup + migration cost dwarfs the tests themselves.
    testTimeout: 60_000,
    hookTimeout: 240_000,
    // A single embedded Postgres per file means tests must not race.
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
})
