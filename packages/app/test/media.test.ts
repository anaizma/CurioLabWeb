// -------------------------------------------------------------------------
// MediaService tests (Milestone 3.4) — the project-media / photo-review policy
// service and the C1 consent-revoke coupling. Embedded Postgres, synthetic data
// only.
//
// Under test (02-data-model project_media / media_depiction and the media
// policy; 03-authorization media.review; 04-state-machines coupling C1
// photo_media revoke -> depicting media re-review):
//
//   - attach (a student, their own project): review_status defaults
//     'pending_review'; student-source depictions are unconfirmed hints
//     (source='student', confirmed_at null) that do NOT clear an image;
//   - confirmDepiction (mentor/staff, media.review): stamps source/confirmed_at;
//     an image is clearable for photo_media-gated use only when EVERY depicted
//     account has an active photo_media consent AND every depiction is
//     mentor/staff-confirmed;
//   - clear moves pending_review -> ok only when clearable; remove -> removed;
//   - coupling C1: revoking a student's photo_media flips every media depicting
//     them to pending_review in the SAME transaction as the revoke (a failure
//     injected rolls back BOTH); a media not depicting them is untouched; the
//     C2 external_publication cascade still works through the composed dispatcher;
//   - authorization: a non-reviewer is denied media.review; a student cannot
//     attach to someone else's project.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext, Membership, Role } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeTerm, makePod, makeMembership } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import {
  MediaService,
  ProjectService,
  ConsentService,
  projectExternalPublicationRevokeCascade,
  mediaPhotoMediaRevokeCascade,
  composeRevokeCascades,
  MediaNotClearableError,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// A pod/chapter-aware membership (the app ctx `mem` helper is chapter-wide only).
function membership(role: Role, chapterId: string, podId: string | null = null): Membership {
  return {
    chapter_id: chapterId,
    role,
    status: 'active',
    pod_id: podId,
    tier: null,
    active_from: null,
    active_until: null,
  }
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

// A student (minor) owning a draft project in a pod, with an accepted
// application + linked enrollment so the consent anchor resolves, plus a
// guardian, a pod mentor (lead_instructor), and a chapter director.
async function setup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const pod = await makePod(h.sql, chapter, term)
  const director = await makeAdult(h.sql)
  const mentor = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  const guardian = await makeAdult(h.sql)
  const studentMembership = await makeMembership(h.sql, student, chapter, {
    role: 'student',
    podId: pod,
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
  const [proj] = await h.sql`
    insert into project (chapter_id, owner_membership_id, title, status)
    values (${chapter}, ${studentMembership}, 'My Robot', 'draft')
    returning id
  `
  return {
    chapter,
    term,
    pod,
    director,
    mentor,
    student,
    guardian,
    studentMembership,
    project: proj!.id as string,
  }
}

function studentCtxOf(f: Setup): AuthContext {
  return ctxFor(f.student, [membership('student', f.chapter, f.pod)])
}

function mentorCtxOf(f: Setup): AuthContext {
  return ctxFor(f.mentor, [membership('lead_instructor', f.chapter, f.pod)])
}

async function grantPhotoMedia(student: string, guardian: string): Promise<void> {
  const svc = new ConsentService({ sql: h.sql, authorize })
  await withRequest(() => svc.grantConsent(student, 'photo_media', guardianCtx(guardian, [student])))
}

async function mediaStatus(id: string): Promise<string | undefined> {
  const [r] = await h.sql`select review_status from project_media where id = ${id}`
  return r?.review_status as string | undefined
}

async function depiction(mediaId: string, accountId: string): Promise<Record<string, unknown> | undefined> {
  const [r] = await h.sql`
    select source, confirmed_at from media_depiction where media_id = ${mediaId} and account_id = ${accountId}
  `
  return r as Record<string, unknown> | undefined
}

// ===========================================================================
describe('attach: a student attaches media to their own project', () => {
  test('defaults review_status = pending_review; a student-source depiction does not clear the image', async () => {
    const f = await setup()
    const svc = new MediaService({ sql: h.sql, authorize })
    // Even with the depicted student consented, an unconfirmed student hint must
    // not clear the image — only a mentor/staff confirmation does.
    await grantPhotoMedia(f.student, f.guardian)

    const res = await withRequest(() =>
      svc.attach(
        { projectId: f.project, storageRef: randomUUID(), depictions: [{ accountId: f.student }] },
        studentCtxOf(f),
      ),
    )

    expect(res.reviewStatus).toBe('pending_review')
    expect(await mediaStatus(res.mediaId)).toBe('pending_review')

    const d = await depiction(res.mediaId, f.student)
    expect(d!.source).toBe('student')
    expect(d!.confirmed_at).toBeNull()

    expect(await svc.isClearedForPublicUse(res.mediaId)).toBe(false)
  })
})

// ===========================================================================
describe('confirmDepiction + clear: the photo-review policy', () => {
  test('a mentor confirmation sets source/confirmed_at; with all depicted consented + confirmed, clear -> ok', async () => {
    const f = await setup()
    const svc = new MediaService({ sql: h.sql, authorize })
    await grantPhotoMedia(f.student, f.guardian)

    const { mediaId } = await withRequest(() =>
      svc.attach(
        { projectId: f.project, storageRef: randomUUID(), depictions: [{ accountId: f.student }] },
        studentCtxOf(f),
      ),
    )

    await withRequest(() => svc.confirmDepiction(mediaId, f.student, mentorCtxOf(f)))
    const d = await depiction(mediaId, f.student)
    expect(['mentor', 'staff']).toContain(d!.source)
    expect(d!.confirmed_at).not.toBeNull()

    expect(await svc.isClearedForPublicUse(mediaId)).toBe(true)

    const cleared = await withRequest(() => svc.clear(mediaId, mentorCtxOf(f)))
    expect(cleared.reviewStatus).toBe('ok')
    expect(await mediaStatus(mediaId)).toBe('ok')
  })

  test('a depicted account without photo_media keeps the image un-clearable', async () => {
    const f = await setup()
    const svc = new MediaService({ sql: h.sql, authorize })
    const other = await makeMinor(h.sql)
    // Only the owner is consented; `other` has no photo_media.
    await grantPhotoMedia(f.student, f.guardian)

    const { mediaId } = await withRequest(() =>
      svc.attach(
        {
          projectId: f.project,
          storageRef: randomUUID(),
          depictions: [{ accountId: f.student }, { accountId: other }],
        },
        studentCtxOf(f),
      ),
    )

    // Both depictions confirmed by the mentor, but `other` lacks photo_media.
    await withRequest(() => svc.confirmDepiction(mediaId, f.student, mentorCtxOf(f)))
    await withRequest(() => svc.confirmDepiction(mediaId, other, mentorCtxOf(f)))

    expect(await svc.isClearedForPublicUse(mediaId)).toBe(false)

    await expect(withRequest(() => svc.clear(mediaId, mentorCtxOf(f)))).rejects.toBeInstanceOf(
      MediaNotClearableError,
    )
    expect(await mediaStatus(mediaId)).toBe('pending_review')
  })

  test('remove sets review_status = removed', async () => {
    const f = await setup()
    const svc = new MediaService({ sql: h.sql, authorize })
    const { mediaId } = await withRequest(() =>
      svc.attach({ projectId: f.project, storageRef: randomUUID() }, studentCtxOf(f)),
    )
    await withRequest(() => svc.remove(mediaId, mentorCtxOf(f)))
    expect(await mediaStatus(mediaId)).toBe('removed')
  })
})

// ===========================================================================
describe('coupling C1: photo_media revoke flips depicting media to pending_review', () => {
  // Attach a media depicting the student, confirm + clear it to 'ok'.
  async function clearedMediaDepicting(f: Setup, student: string): Promise<string> {
    const svc = new MediaService({ sql: h.sql, authorize })
    const { mediaId } = await withRequest(() =>
      svc.attach(
        { projectId: f.project, storageRef: randomUUID(), depictions: [{ accountId: student }] },
        studentCtxOf(f),
      ),
    )
    await withRequest(() => svc.confirmDepiction(mediaId, student, mentorCtxOf(f)))
    await withRequest(() => svc.clear(mediaId, mentorCtxOf(f)))
    return mediaId
  }

  test('the revoke re-reviews depicting media and flips consent_current, together; non-depicting untouched', async () => {
    const f = await setup()
    await grantPhotoMedia(f.student, f.guardian)
    const mediaA = await clearedMediaDepicting(f, f.student)
    expect(await mediaStatus(mediaA)).toBe('ok')

    // A media depicting a DIFFERENT account, marked ok — must be untouched.
    const other = await makeMinor(h.sql)
    const svc = new MediaService({ sql: h.sql, authorize })
    const { mediaId: mediaB } = await withRequest(() =>
      svc.attach(
        { projectId: f.project, storageRef: randomUUID(), depictions: [{ accountId: other }] },
        studentCtxOf(f),
      ),
    )
    await h.sql`update project_media set review_status = 'ok' where id = ${mediaB}`

    const consentSvc = new ConsentService({
      sql: h.sql,
      authorize,
      onRevoke: composeRevokeCascades(projectExternalPublicationRevokeCascade, mediaPhotoMediaRevokeCascade),
    })
    await withRequest(() => consentSvc.revokeConsent(f.student, 'photo_media', guardianCtx(f.guardian, [f.student])))

    expect(await mediaStatus(mediaA)).toBe('pending_review')
    expect(await mediaStatus(mediaB)).toBe('ok')
    const [cur] = await h.sql`
      select active from consent_current where student_account_id = ${f.student} and type = 'photo_media'
    `
    expect(cur!.active).toBe(false)
  })

  test('a failure injected after the flip rolls BOTH back (nothing persisted)', async () => {
    const f = await setup()
    await grantPhotoMedia(f.student, f.guardian)
    const mediaA = await clearedMediaDepicting(f, f.student)

    const failingCascade = async (
      tx: Parameters<typeof mediaPhotoMediaRevokeCascade>[0],
      args: Parameters<typeof mediaPhotoMediaRevokeCascade>[1],
    ): Promise<void> => {
      await mediaPhotoMediaRevokeCascade(tx, args)
      throw new Error('injected failure after re-review')
    }
    const consentSvc = new ConsentService({ sql: h.sql, authorize, onRevoke: failingCascade })

    await expect(
      withRequest(() => consentSvc.revokeConsent(f.student, 'photo_media', guardianCtx(f.guardian, [f.student]))),
    ).rejects.toThrow(/injected failure/)

    // Neither the re-review nor the revoke persisted.
    expect(await mediaStatus(mediaA)).toBe('ok')
    const [cur] = await h.sql`
      select active from consent_current where student_account_id = ${f.student} and type = 'photo_media'
    `
    expect(cur!.active).toBe(true)
  })

  test('the C2 external_publication cascade still works through the same composed dispatcher (no regression)', async () => {
    const f = await setup()
    // Bring the project to public_listed with a scoped external_publication.
    const projectSvc = new ProjectService({ sql: h.sql, authorize })
    await h.sql`update project set status = 'verified', verified_by = ${f.director}, verified_at = now() where id = ${f.project}`
    const consentGrant = new ConsentService({ sql: h.sql, authorize })
    await withRequest(() =>
      consentGrant.grantConsent(f.student, 'external_publication', guardianCtx(f.guardian, [f.student]), {
        scopeRef: f.project,
      }),
    )
    await withRequest(() =>
      projectSvc.publishPublic(f.project, ctxFor(f.director, [membership('chapter_director', f.chapter, null)])),
    )
    const [pl] = await h.sql`select status from project where id = ${f.project}`
    expect(pl!.status).toBe('public_listed')

    const consentSvc = new ConsentService({
      sql: h.sql,
      authorize,
      onRevoke: composeRevokeCascades(projectExternalPublicationRevokeCascade, mediaPhotoMediaRevokeCascade),
    })
    await withRequest(() =>
      consentSvc.revokeConsent(f.student, 'external_publication', guardianCtx(f.guardian, [f.student])),
    )
    const [after] = await h.sql`select status from project where id = ${f.project}`
    expect(after!.status).toBe('verified')
  })
})

// ===========================================================================
describe('authorization', () => {
  test('a non-reviewer (a student) is denied media.review on confirmDepiction', async () => {
    const f = await setup()
    const svc = new MediaService({ sql: h.sql, authorize })
    const { mediaId } = await withRequest(() =>
      svc.attach(
        { projectId: f.project, storageRef: randomUUID(), depictions: [{ accountId: f.student }] },
        studentCtxOf(f),
      ),
    )

    await expect(
      withRequest(() => svc.confirmDepiction(mediaId, f.student, studentCtxOf(f))),
    ).rejects.toBeInstanceOf(Forbidden)

    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${f.student}
    `
    expect(denied.some((r) => (r.detail as Record<string, unknown>).capability === 'media.review')).toBe(true)
    // The depiction was not confirmed.
    expect((await depiction(mediaId, f.student))!.confirmed_at).toBeNull()
  })

  test("a student cannot attach to someone else's project", async () => {
    const f = await setup()
    const svc = new MediaService({ sql: h.sql, authorize })
    // A different student, with a student membership in the chapter, but not the
    // project owner.
    const intruder = await makeMinor(h.sql)
    const intruderCtx = ctxFor(intruder, [membership('student', f.chapter, f.pod)])

    await expect(
      withRequest(() =>
        svc.attach({ projectId: f.project, storageRef: randomUUID() }, intruderCtx),
      ),
    ).rejects.toBeInstanceOf(Forbidden)

    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${intruder}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ reason: 'out_of_scope' })
    // Nothing attached.
    const [n] = await h.sql`select count(*)::int as n from project_media where project_id = ${f.project}`
    expect(n!.n).toBe(0)
  })
})
