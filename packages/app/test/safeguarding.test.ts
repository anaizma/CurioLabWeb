// -------------------------------------------------------------------------
// ConsentService.revokeSafeguarding tests — the ONE sanctioned STAFF write to
// consent (03-authorization `consent.revoke_safeguarding`; 04-state-machines
// consent "safeguarding suspend | chapter_director, admin"). Embedded Postgres,
// synthetic data only.
//
// Under test:
//   - a director inserts append-only `reason = safeguarding` revoke rows for BOTH
//     `public_profile` and `photo_media` in ONE transaction; consent_current shows
//     both inactive;
//   - the C1 cascade fires: the student's depicting media flip to pending_review;
//   - it does NOT ride guardian/self scope — a guardian cannot call it, and a
//     non-director/non-admin is denied (opaque Forbidden + a permission.denied row).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext, Membership, Role } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeTerm, makePod, makeMembership } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import {
  ConsentService,
  MediaService,
  composeRevokeCascades,
  mediaPhotoMediaRevokeCascade,
  projectExternalPublicationRevokeCascade,
} from '../src/index.js'

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
function ctxFor(accountId: string, memberships: Membership[]): AuthContext {
  return baseCtx(accountId, new Date(), memberships)
}
function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

interface Setup {
  chapter: string
  term: string
  pod: string
  director: string
  mentor: string
  student: string
  guardian: string
  studentMembership: string
  project: string
}

async function setup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const pod = await makePod(h.sql, chapter, term)
  const director = await makeAdult(h.sql)
  const mentor = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  const guardian = await makeAdult(h.sql)
  const studentMembership = await makeMembership(h.sql, student, chapter, { role: 'student', podId: pod })
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
      ${app!.id}, ${student}, ${chapter}, ${term}, ${randomUUID()}, 'Parent Testperson', ${director}
    )
  `
  const [proj] = await h.sql`
    insert into project (chapter_id, owner_membership_id, title, status)
    values (${chapter}, ${studentMembership}, 'My Robot', 'draft') returning id
  `
  return { chapter, term, pod, director, mentor, student, guardian, studentMembership, project: proj!.id as string }
}

const safeguardingConsentSvc = () =>
  new ConsentService({
    sql: h.sql,
    authorize,
    onRevoke: composeRevokeCascades(projectExternalPublicationRevokeCascade, mediaPhotoMediaRevokeCascade),
  })

async function grant(student: string, guardian: string, type: 'public_profile' | 'photo_media'): Promise<void> {
  await withRequest(() => new ConsentService({ sql: h.sql, authorize }).grantConsent(student, type, guardianCtx(guardian, [student])))
}
async function currentActive(student: string, type: string): Promise<boolean | undefined> {
  const [row] = await h.sql`select active from consent_current where student_account_id = ${student} and type = ${type}`
  return row?.active as boolean | undefined
}
async function consentRows(student: string, type: string) {
  return h.sql`
    select action, source, reason, granted_by from consent
    where student_account_id = ${student} and type = ${type} order by seq asc
  `
}
async function mediaStatus(id: string): Promise<string | undefined> {
  const [r] = await h.sql`select review_status from project_media where id = ${id}`
  return r?.review_status as string | undefined
}

// A media depicting the student, confirmed by the mentor and cleared to 'ok'.
async function clearedMediaDepicting(f: Setup): Promise<string> {
  const svc = new MediaService({ sql: h.sql, authorize })
  const studentCtx = ctxFor(f.student, [membership('student', f.chapter, f.pod)])
  const mentorCtx = ctxFor(f.mentor, [membership('lead_instructor', f.chapter, f.pod)])
  const { mediaId } = await withRequest(() =>
    svc.attach({ projectId: f.project, storageRef: randomUUID(), depictions: [{ accountId: f.student }] }, studentCtx),
  )
  await withRequest(() => svc.confirmDepiction(mediaId, f.student, mentorCtx))
  await withRequest(() => svc.clear(mediaId, mentorCtx))
  return mediaId
}

describe('a director safeguarding-suspends a student', () => {
  test('inserts reason=safeguarding revokes for public_profile AND photo_media; both consent_current inactive; C1 flips depicting media', async () => {
    const f = await setup()
    await grant(f.student, f.guardian, 'public_profile')
    await grant(f.student, f.guardian, 'photo_media')
    const media = await clearedMediaDepicting(f)
    expect(await mediaStatus(media)).toBe('ok')

    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter)])
    let result!: Awaited<ReturnType<ConsentService['revokeSafeguarding']>>
    await withRequest(async () => {
      result = await safeguardingConsentSvc().revokeSafeguarding(f.student, directorCtx)
    })

    // Both types suspended, append-only, staff-attributed, reason=safeguarding.
    expect(result.map((r) => r.type).sort()).toEqual(['photo_media', 'public_profile'])
    for (const type of ['public_profile', 'photo_media'] as const) {
      const rows = await consentRows(f.student, type)
      expect(rows.map((r) => r.action)).toEqual(['grant', 'revoke'])
      expect(rows[1]!.reason).toBe('safeguarding')
      expect(rows[1]!.granted_by).toBe(f.director)
      expect(await currentActive(f.student, type)).toBe(false)
    }

    // C1: the student's depicting media is back in pending_review.
    expect(await mediaStatus(media)).toBe('pending_review')
  })
})

describe('the safeguarding suspend is a STAFF write, not a guardian/self one', () => {
  test('a guardian cannot call it (opaque Forbidden, one permission.denied row, nothing persists)', async () => {
    const f = await setup()
    await grant(f.student, f.guardian, 'photo_media')

    let caught: unknown
    await withRequest(async () => {
      try {
        await safeguardingConsentSvc().revokeSafeguarding(f.student, guardianCtx(f.guardian, [f.student]))
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${f.guardian}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'consent.revoke_safeguarding', reason: 'out_of_scope' })
    // photo_media is still active — nothing was suspended.
    expect(await currentActive(f.student, 'photo_media')).toBe(true)
  })

  test('a non-director chapter member is denied role_not_permitted', async () => {
    const f = await setup()
    await grant(f.student, f.guardian, 'photo_media')
    const mentorCtx = ctxFor(f.mentor, [membership('lead_instructor', f.chapter, f.pod)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await safeguardingConsentSvc().revokeSafeguarding(f.student, mentorCtx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${f.mentor}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'consent.revoke_safeguarding', reason: 'role_not_permitted' })
    expect(await currentActive(f.student, 'photo_media')).toBe(true)
  })
})
