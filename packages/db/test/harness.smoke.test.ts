import { afterAll, beforeAll, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
})

afterAll(async () => {
  await h?.end()
})

test('embedded postgres boots and the base schema applies', async () => {
  const rows = await h.sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name
  `
  const names = rows.map((r) => r.table_name as string)
  expect(names).toContain('account')
  expect(names).toContain('consent')
  expect(names).toContain('consent_current')
  expect(names).toContain('audit_entry')
})
