// -------------------------------------------------------------------------
// Route adapter smoke test (M3.7). Proves a representative Next 16 route.ts
// adapter imports, wires to its controller through the shared db seam, and
// returns a real Web Response. The public projects directory is the simplest
// public path (no session cookie), mirroring route-smoke.test.ts.
// -------------------------------------------------------------------------

import { beforeAll, afterAll, expect, test } from 'vitest'
import { setSqlForTesting } from '../src/index.js'
import { startHarness, type Harness } from './helpers/pg.js'
import { seedM3, seedProject } from './helpers/seed-m3.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
  setSqlForTesting(h.sql)
}, 240_000)

afterAll(async () => {
  setSqlForTesting(null)
  await h?.end()
})

test('GET /api/public/projects adapter returns a 200 Response listing public_listed projects', async () => {
  const s = await seedM3(h.sql)
  const listed = await seedProject(h.sql, s, 'public_listed', 'Showcased Bot')

  const { GET } = await import('../../../app/api/public/projects/route.js')
  const res = await GET(new Request('http://localhost/api/public/projects'))

  expect(res).toBeInstanceOf(Response)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { projects: Array<{ projectId: string; title: string }> }
  expect(body.projects.some((p) => p.projectId === listed)).toBe(true)
})
