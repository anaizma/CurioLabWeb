// -------------------------------------------------------------------------
// Route adapter smoke test. Proves a representative Next 16 route.ts adapter
// imports, wires to its controller through the shared db seam, and returns a
// real Web Response for a constructed Request. The embedded-Postgres `sql` is
// injected via setSqlForTesting so the adapter runs without a DATABASE_URL.
//
// Stage 1 (/api/apply) is frontend-owned (design §7.3), so the representative
// backend adapter is the token-gated Stage 2 start: it consumes the lead's
// Stage-2 token and creates the draft.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, test } from 'vitest'
import { generateSessionToken, hashToken } from '@curiolab/runtime'
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

test('POST /api/public/stage2/start adapter returns a 201 Response and creates a draft', async () => {
  const chapter = await makeChapter(h.sql)
  const token = generateSessionToken()
  const [lead] = await h.sql`
    insert into application_lead (email, chapter, chapter_id, source, filler_role, status, token_hash)
    values (${`parent-${randomUUID().slice(0, 8)}@example.test`}, 'a-chapter-code', ${chapter},
            'friend', 'parent', 'new', ${hashToken(token)})
    returning id
  `
  const leadId = lead!.id as string

  // Import the real Next route module and call its exported POST directly.
  const { POST } = await import('../../../app/api/public/stage2/start/route.js')

  const req = new Request('http://localhost/api/public/stage2/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  const res = await POST(req)

  expect(res).toBeInstanceOf(Response)
  expect(res.status).toBe(201)
  const body = (await res.json()) as { draftId: string; leadId: string }
  expect(body.draftId).toBeTruthy()
  expect(body.leadId).toBe(leadId)

  const [d] = await h.sql`select phase, status from application_draft where id = ${body.draftId}`
  expect(d!.phase).toBe('2a')
  expect(d!.status).toBe('in_progress')
})
