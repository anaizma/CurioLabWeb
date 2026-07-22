import { defineConfig } from 'drizzle-kit'

// The base-table DDL can be regenerated from the schema with `npm run
// db:generate`. The compliance guarantees are authored by hand as ordered SQL
// migrations under ./migrations (custom migrations); see migrations/README.md.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/curiolab',
  },
})
