import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Deterministic, in-order execution so the coverage recorder in the
    // authorization suite sees every allow/deny before the completeness check.
    sequence: {
      concurrent: false,
    },
  },
})
