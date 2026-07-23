// -------------------------------------------------------------------------
// Student profile + verification-URL controllers (M3.7). Embedded Postgres,
// synthetic data only. Tests the CONTROLLERS (session-token -> AuthContext),
// not the thin route adapters.
//
//   - GET /api/profile/:id           viewProfile (self / authorized view)
//   - PATCH /api/profile/narrative   editNarrative (a minor's edit -> pending)
//   - POST /api/profile/narrative/:id/review  reviewNarrative (-> published)
//   - POST /api/profile/verification-token    regenerateVerificationToken
//   - GET /api/verify/:token         viewVerification (PUBLIC; neutral not-shared)
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { seedM3, grantConsent } from './helpers/seed-m3.js'
import {
  viewProfile,
  editNarrative,
  reviewNarrative,
  regenerateVerificationToken,
  viewVerification,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// ===========================================================================
describe('viewProfile', () => {
  test('a self view returns the composed profile (200)', async () => {
    const s = await seedM3(h.sql)
    const res = await viewProfile({
      sql: h.sql,
      sessionToken: s.studentToken,
      params: { id: s.student },
    })
    expect(res.status).toBe(200)
    expect(res.body.subjectAccountId).toBe(s.student)
    expect(res.body.tier).toBe('explorer')
    // Honest zero-state sections are present, not omitted.
    expect(res.body.projects).toEqual([])
    expect(res.body.narrative).toBeNull()
  })

  test('no session -> opaque 403', async () => {
    const s = await seedM3(h.sql)
    const res = await viewProfile({ sql: h.sql, params: { id: s.student } })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/reason|out_of_scope/)
  })
})

// ===========================================================================
describe('editNarrative + reviewNarrative', () => {
  test("a minor's edit returns pending_review (not published)", async () => {
    const s = await seedM3(h.sql)
    const res = await editNarrative({
      sql: h.sql,
      sessionToken: s.studentToken,
      body: { body: 'My WIP bio' },
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('pending_review')

    // The view does not surface a not-yet-published narrative.
    const view = await viewProfile({ sql: h.sql, sessionToken: s.studentToken, params: { id: s.student } })
    expect(view.body.narrative).toBeNull()
  })

  test('review clears a pending narrative to published', async () => {
    const s = await seedM3(h.sql)
    const edited = await editNarrative({ sql: h.sql, sessionToken: s.studentToken, body: { body: 'My bio' } })
    const reviewed = await reviewNarrative({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: edited.body.narrativeId },
    })
    expect(reviewed.status).toBe(200)
    expect(reviewed.body.status).toBe('published')

    const view = await viewProfile({ sql: h.sql, sessionToken: s.studentToken, params: { id: s.student } })
    expect(view.body.narrative).not.toBeNull()
    expect(view.body.narrative!.body).toBe('My bio')
  })
})

// ===========================================================================
describe('regenerateVerificationToken', () => {
  test('a self regenerate returns a token', async () => {
    const s = await seedM3(h.sql)
    const res = await regenerateVerificationToken({ sql: h.sql, sessionToken: s.studentToken, body: {} })
    expect(res.status).toBe(201)
    expect(typeof res.body.token).toBe('string')
    expect(res.body.token.length).toBeGreaterThan(20)
    const [row] = await h.sql`
      select count(*)::int as n from verification_token
      where subject_account_id = ${s.student} and revoked_at is null
    `
    expect(row!.n).toBe(1)
  })
})

// ===========================================================================
describe('viewVerification — the public verify URL', () => {
  test('a shared subject returns the record (noindex)', async () => {
    const s = await seedM3(h.sql)
    const regen = await regenerateVerificationToken({ sql: h.sql, sessionToken: s.studentToken, body: {} })
    await grantConsent(h.sql, s.student, s.guardian, 'public_profile')

    const res = await viewVerification({ sql: h.sql, params: { token: regen.body.token } })
    expect(res.status).toBe(200)
    expect(res.body.shared).toBe(true)
    expect(res.body.noindex).toBe(true)
    if (res.body.shared) {
      expect(res.body.record.displayName).toBe('Minor T.')
    }
  })

  test('an unshared, an unknown, and a revoked token all return the byte-identical neutral response', async () => {
    const s = await seedM3(h.sql)
    // (a) live token, but public_profile NOT active.
    const live = await regenerateVerificationToken({ sql: h.sql, sessionToken: s.studentToken, body: {} })
    const unshared = await viewVerification({ sql: h.sql, params: { token: live.body.token } })

    // (b) revoke by regenerating again.
    await regenerateVerificationToken({ sql: h.sql, sessionToken: s.studentToken, body: {} })
    const revoked = await viewVerification({ sql: h.sql, params: { token: live.body.token } })

    // (c) an entirely unknown token.
    const unknown = await viewVerification({ sql: h.sql, params: { token: 'totally-made-up-token-value' } })

    expect(unshared.body.shared).toBe(false)
    expect(unshared.body.noindex).toBe(true)
    expect(JSON.stringify(unshared.body)).toBe(JSON.stringify(revoked.body))
    expect(JSON.stringify(revoked.body)).toBe(JSON.stringify(unknown.body))
    // All neutral responses answer 200 (no existence signal via status either).
    expect(unshared.status).toBe(200)
    expect(unknown.status).toBe(200)
  })
})
