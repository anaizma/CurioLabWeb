// -------------------------------------------------------------------------
// Route adapter smoke test (M1 auth/onboarding). Proves a representative Next 16
// route.ts adapter imports, wires to its controller through the shared db seam,
// and returns a real Web Response. POST /api/auth/password/reset-request is the
// simplest public, actor-less path (no session cookie, no route params) — it
// always returns the uniform 202 response, so no seeding is needed.
//
// (The param routes under app/api/**/[id]|[token] reference the next-typegen
// `RouteContext` global, which is only in scope under the root tsconfig; this
// package's tsc typechecks the dynamically-imported module, so the no-param
// adapter is the representative one to smoke here — matching the existing
// route-smoke tests, which likewise import a no-param route.)
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, expect, test } from 'vitest'
import { setSqlForTesting } from '../src/index.js'
import { startHarness, type Harness } from './helpers/pg.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
  setSqlForTesting(h.sql)
}, 240_000)

afterAll(async () => {
  setSqlForTesting(null)
  await h?.end()
})

test('POST /api/auth/password/reset-request adapter returns a uniform 202 Response', async () => {
  const { POST } = await import('../../../app/api/auth/password/reset-request/route.js')
  const req = new Request('http://localhost/api/auth/password/reset-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: `nobody-${randomUUID().slice(0, 8)}@example.test` }),
  })
  const res = await POST(req)

  expect(res).toBeInstanceOf(Response)
  expect(res.status).toBe(202)
  const body = (await res.json()) as { requested: boolean }
  expect(body).toEqual({ requested: true })
})

test('POST /api/auth/password/reset adapter returns an opaque 401 for an unknown token', async () => {
  const { POST } = await import('../../../app/api/auth/password/reset/route.js')
  const req = new Request('http://localhost/api/auth/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: `forged-${randomUUID()}`, newPassword: 'SmokePass!12' }),
  })
  const res = await POST(req)

  expect(res).toBeInstanceOf(Response)
  expect(res.status).toBe(401)
})

test('POST /api/auth/account-recovery adapter returns an opaque 401 for an unknown token', async () => {
  const { POST } = await import('../../../app/api/auth/account-recovery/route.js')
  const req = new Request('http://localhost/api/auth/account-recovery', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: `forged-${randomUUID()}`,
      email: `x-${randomUUID().slice(0, 8)}@example.test`,
      newPassword: 'SmokePass!34',
    }),
  })
  const res = await POST(req)

  expect(res).toBeInstanceOf(Response)
  expect(res.status).toBe(401)
})
