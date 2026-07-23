// -------------------------------------------------------------------------
// Route adapter smoke test. Proves a representative Next 16 route.ts adapter
// imports, wires to its controller through the shared db seam, and returns a
// real Web Response for a constructed Request. The embedded-Postgres `sql` is
// injected via setSqlForTesting so the adapter runs without a DATABASE_URL.
// -------------------------------------------------------------------------

import { beforeAll, afterAll, expect, test } from 'vitest'
import { setSqlForTesting } from '../src/index.js'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
  setSqlForTesting(h.sql)
}, 240_000)

afterAll(async () => {
  setSqlForTesting(null)
  await h?.end()
})

test('POST /api/public/apply adapter returns a 201 Response and creates a lead', async () => {
  const chapter = await makeChapter(h.sql)
  // Import the real Next route module and call its exported POST directly.
  const { POST } = await import('../../../app/api/public/apply/route.js')

  const req = new Request('http://localhost/api/public/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'smoke@example.test', chapterId: chapter, referralSource: 'friend' }),
  })
  const res = await POST(req)

  expect(res).toBeInstanceOf(Response)
  expect(res.status).toBe(201)
  const body = (await res.json()) as { leadId: string; suppressed: boolean }
  expect(body.leadId).toBeTruthy()
  expect(body.suppressed).toBe(false)

  const [lead] = await h.sql`select status from application_lead where id = ${body.leadId}`
  expect(lead!.status).toBe('new')
})
