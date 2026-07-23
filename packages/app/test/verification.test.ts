// -------------------------------------------------------------------------
// VerificationService tests (Milestone 3.3) — the revocable, unguessable
// verification URL behind the public GET /verify/:token, and its regenerate
// path. Embedded Postgres, synthetic data only.
//
// Under test (02-data-model verification_token; 03-authorization
// verification.regenerate scope own|guardian; 04-state-machines the verification
// URL rules — unguessable token, regenerate revokes the old one, and a neutral
// "not currently shared" response so not-shared and not-existent are
// indistinguishable):
//
//   - regenerate inserts a fresh CSPRNG token (returned once, only its hash
//     stored) and revokes the prior live one — at most one live per subject;
//   - view(token) returns the MINIMAL verified record ONLY when the subject's
//     public_profile consent is currently active;
//   - an unknown token, a revoked token, and an inactive-consent subject ALL
//     return the SAME neutral not-shared response (byte-identical; no existence
//     leak), marked noindex;
//   - authorization: a guardian may regenerate for their OWN child but not
//     another's; a stranger is denied.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext, Membership, Role } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeTerm, makePod, makeMembership } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import { VerificationService, ConsentService } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function membership(role: Role, chapterId: string, podId: string | null = null): Membership {
  return { chapter_id: chapterId, role, status: 'active', pod_id: podId, tier: null, active_from: null, active_until: null }
}

function ctxAged(accountId: string, age: number, memberships: Membership[]): AuthContext {
  const base = baseCtx(accountId, new Date(), memberships)
  return { ...base, account: { ...base.account, age } }
}

function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

interface Setup {
  chapter: string
  term: string
  pod: string
  director: string
  student: string
  studentMembership: string
  guardian: string
}

async function setup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const pod = await makePod(h.sql, chapter, term)
  const director = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  const guardian = await makeAdult(h.sql)
  const studentMembership = await makeMembership(h.sql, student, chapter, {
    role: 'student',
    podId: pod,
    currentTier: 'builder',
  })
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild', 'parent@example.test',
      'Parent Testperson', 'parent@example.test', '2026-06-01T00:00:00Z'
    ) returning id
  `
  await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${student}, ${chapter}, ${term},
      ${randomUUID()}, 'Parent Testperson', ${director}
    )
  `
  return { chapter, term, pod, director, student, studentMembership, guardian }
}

async function grantPublicProfile(f: Setup): Promise<void> {
  const svc = new ConsentService({ sql: h.sql, authorize })
  const gctx = guardianCtx(f.guardian, [f.student])
  await withRequest(() => svc.grantConsent(f.student, 'public_profile', gctx))
}

async function liveTokenCount(subject: string): Promise<number> {
  const [row] = await h.sql`
    select count(*)::int as n from verification_token
    where subject_account_id = ${subject} and revoked_at is null
  `
  return row!.n as number
}

// ===========================================================================
describe('regenerate: fresh CSPRNG token, prior live one revoked', () => {
  test('a student regenerates their own token; the plaintext is returned once', async () => {
    const f = await setup()
    const svc = new VerificationService({ sql: h.sql, authorize })
    const selfCtx = ctxAged(f.student, 15, [membership('student', f.chapter, f.pod)])

    const res = await withRequest(() => svc.regenerate(f.student, selfCtx))
    expect(typeof res.token).toBe('string')
    expect(res.token.length).toBeGreaterThan(20)
    expect(await liveTokenCount(f.student)).toBe(1)

    // Only the HASH is stored, never the plaintext.
    const [row] = await h.sql`select token_hash from verification_token where subject_account_id = ${f.student}`
    expect(row!.token_hash).not.toBe(res.token)
  })

  test('regenerating revokes the prior live token — at most one live per subject', async () => {
    const f = await setup()
    const svc = new VerificationService({ sql: h.sql, authorize })
    const selfCtx = ctxAged(f.student, 15, [membership('student', f.chapter, f.pod)])

    const first = await withRequest(() => svc.regenerate(f.student, selfCtx))
    const second = await withRequest(() => svc.regenerate(f.student, selfCtx))

    expect(second.token).not.toBe(first.token)
    expect(await liveTokenCount(f.student)).toBe(1)
    const revoked = await h.sql`
      select count(*)::int as n from verification_token
      where subject_account_id = ${f.student} and revoked_at is not null
    `
    expect(revoked[0]!.n).toBe(1)

    // The old link no longer resolves; the new one does (with consent).
    await grantPublicProfile(f)
    const oldView = await svc.view(first.token)
    expect(oldView.shared).toBe(false)
    const newView = await svc.view(second.token)
    expect(newView.shared).toBe(true)
  })
})

// ===========================================================================
describe('view(token): the minimal verified record, gated on public_profile', () => {
  test('returns the record when public_profile is active', async () => {
    const f = await setup()
    const svc = new VerificationService({ sql: h.sql, authorize })
    const selfCtx = ctxAged(f.student, 15, [membership('student', f.chapter, f.pod)])
    // A verified project appears; a draft one does not.
    await h.sql`
      insert into project (chapter_id, owner_membership_id, title, status, verified_by, verified_at)
      values (${f.chapter}, ${f.studentMembership}, 'Verified Bot', 'verified', ${f.director}, now())
    `
    await h.sql`
      insert into project (chapter_id, owner_membership_id, title, status)
      values (${f.chapter}, ${f.studentMembership}, 'Secret Draft', 'draft')
    `
    const res = await withRequest(() => svc.regenerate(f.student, selfCtx))
    await grantPublicProfile(f)

    const view = await svc.view(res.token)
    expect(view.shared).toBe(true)
    expect(view.noindex).toBe(true)
    if (view.shared) {
      expect(view.record.displayName).toBe('Minor T.')
      expect(view.record.tierReached).toBe('builder')
      expect(view.record.projects.map((p) => p.title)).toEqual(['Verified Bot'])
      expect(view.record.mentorHours).toBe(0)
    }
  })

  test('an inactive-consent subject, a revoked token, and an unknown token all return the SAME neutral response', async () => {
    const f = await setup()
    const svc = new VerificationService({ sql: h.sql, authorize })
    const selfCtx = ctxAged(f.student, 15, [membership('student', f.chapter, f.pod)])

    // (a) a live token, but public_profile is NOT active.
    const live = await withRequest(() => svc.regenerate(f.student, selfCtx))
    const inactiveConsent = await svc.view(live.token)

    // (b) a REVOKED token (regenerate again to revoke the first).
    await withRequest(() => svc.regenerate(f.student, selfCtx))
    const revoked = await svc.view(live.token)

    // (c) an entirely UNKNOWN token.
    const unknown = await svc.view('totally-made-up-token-value')

    // Byte-identical shape across all three — no existence leak.
    expect(inactiveConsent.shared).toBe(false)
    expect(inactiveConsent).toEqual(revoked)
    expect(revoked).toEqual(unknown)
    expect(JSON.stringify(inactiveConsent)).toBe(JSON.stringify(unknown))
    expect(unknown.noindex).toBe(true)
  })
})

// ===========================================================================
describe('authorization on regenerate (own or guardian; stranger denied)', () => {
  test("a guardian may regenerate for their OWN child but not another's", async () => {
    const f = await setup()
    const svc = new VerificationService({ sql: h.sql, authorize })

    // Own child: allowed.
    const ownGuardian = guardianCtx(f.guardian, [f.student])
    await withRequest(() => svc.regenerate(f.student, ownGuardian))
    expect(await liveTokenCount(f.student)).toBe(1)

    // Another child (not in guardianOf): denied.
    const other = await setup()
    await expect(
      withRequest(() => svc.regenerate(other.student, ownGuardian)),
    ).rejects.toBeInstanceOf(Forbidden)
    expect(await liveTokenCount(other.student)).toBe(0)
  })

  test('a stranger is denied with a permission.denied row', async () => {
    const f = await setup()
    const svc = new VerificationService({ sql: h.sql, authorize })
    const stranger = await makeAdult(h.sql)
    const strangerCtx = ctxAged(stranger, 40, [])

    await expect(withRequest(() => svc.regenerate(f.student, strangerCtx))).rejects.toBeInstanceOf(Forbidden)
    expect(await liveTokenCount(f.student)).toBe(0)
    const denied = await h.sql`
      select count(*)::int as n from audit_entry
      where action = 'permission.denied' and actor_account_id = ${stranger}
    `
    expect(denied[0]!.n).toBe(1)
  })
})
