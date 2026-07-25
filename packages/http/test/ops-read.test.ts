// -------------------------------------------------------------------------
// Director-portal READ endpoints (Phase P1). Embedded Postgres, synthetic data.
//
// The acceptance matrix, per surface:
//   - a director sees ONLY their own chapter's rows;
//   - a different-chapter director sees NONE of chapter A's rows, and a 403 on a
//     cross-chapter ?chapterId;
//   - a platform_admin sees all (and may filter with ?chapterId);
//   - a non-director / no-session is 403 (opaque, no reason leaked);
//   - the ?status / ?role filters work where specified;
//   - the applications DETAIL returns the 2A/2B answers + status history;
//   - the invites list NEVER contains a raw token;
//   - a minor's raw last name / school does NOT leak into any list (the display
//     name is the first + last-initial form), EXCEPT the guardianship name-match.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession, authorize, withRequest } from '@curiolab/runtime'
import { InviteService } from '@curiolab/app'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult } from './helpers/fixtures.js'
import { seedDirector, onboardStudent, directorCtx, type DirectorSeed } from './helpers/seed.js'
import {
  listApplications,
  getApplication,
  listInvites,
  listMemberships,
  listGuardianships,
  listMediaReviewQueue,
  listDeletionRequests,
  listExportRequests,
  listEnrollments,
  listPods,
  listTerms,
  opsDashboard,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function sessionFor(accountId: string): Promise<string> {
  const { token } = await createSession(h.sql, {
    accountId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return token
}

/** A platform_admin account + membership + session token. */
async function seedPlatformAdmin(): Promise<{ account: string; token: string }> {
  const account = await makeAdult(h.sql)
  // platform_admin membership needs a chapter row to reference; any chapter works.
  const [c] = await h.sql`
    insert into chapter (name, slug, tier, status, timezone)
    values ('Platform', ${'platform-' + randomUUID()}, 'active', 'active', 'America/New_York') returning id
  `
  await h.sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${account}, ${c!.id}, 'platform_admin', 'active')
  `
  return { account, token: await sessionFor(account) }
}

/**
 * A submitted student application in `chapter`, returning its id. `createdAt`
 * defaults to inside the seedDirector Fall Term 2099 window so the default
 * most-recent-term filter includes it.
 */
async function submittedApplication(
  chapter: string,
  applicantName = 'Minor Testchild',
  createdAt = '2099-10-01T00:00:00Z',
): Promise<string> {
  const [app] = await h.sql`
    insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_name, guardian_email, created_at)
    values ('student', ${chapter}, 'submitted', ${applicantName}, 'student@example.test', 'Parent Testperson', 'parent@example.test', ${createdAt})
    returning id
  `
  return app!.id as string
}

/** Attach a converted funnel draft (2A parentAnswers + 2B studentAnswers) to an application. */
async function attachDraft(
  chapter: string,
  applicationId: string,
  parentAnswers: Record<string, string>,
  studentAnswers: Record<string, string> = {},
): Promise<void> {
  const [lead] = await h.sql`
    insert into application_lead (email, chapter, chapter_id, filler_role, status, expires_at, converted_application_id)
    values ('parent@example.test', 'code', ${chapter}, 'parent', 'converted', now() + interval '30 days', ${applicationId})
    returning id
  `
  await h.sql`
    insert into application_draft (lead_id, parent_token_hash, phase, status, parent_answers, student_answers, converted_application_id)
    values (${lead!.id}, 'hash', 'submitted', 'submitted',
            ${h.sql.json(parentAnswers)}, ${h.sql.json(studentAnswers)}, ${applicationId})
  `
}

// ===========================================================================
describe('listApplications — the representative read matrix', () => {
  test('a director sees only their own chapter; another chapter director sees none', async () => {
    const a = await seedDirector(h.sql)
    const b = await seedDirector(h.sql)
    const appA = await submittedApplication(a.chapter)

    const seenByA = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { termId: 'all' } })
    expect(seenByA.status).toBe(200)
    expect(seenByA.body.items.map((i) => i.applicationId)).toContain(appA)
    // A's list is confined to A's chapter.
    expect(seenByA.body.items.every((i) => i.chapterId === a.chapter)).toBe(true)

    const seenByB = await listApplications({ sql: h.sql, sessionToken: b.directorToken, query: { termId: 'all' } })
    expect(seenByB.status).toBe(200)
    expect(seenByB.body.items.map((i) => i.applicationId)).not.toContain(appA)
  })

  test('a cross-chapter ?chapterId is an opaque 403', async () => {
    const a = await seedDirector(h.sql)
    const b = await seedDirector(h.sql)
    await submittedApplication(a.chapter)
    const res = await listApplications({
      sql: h.sql,
      sessionToken: b.directorToken,
      query: { chapterId: a.chapter },
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/role_not_permitted|out_of_scope|reason/)
  })

  test('a platform_admin sees all chapters, and may filter with ?chapterId', async () => {
    const a = await seedDirector(h.sql)
    const b = await seedDirector(h.sql)
    const appA = await submittedApplication(a.chapter)
    const appB = await submittedApplication(b.chapter)
    const admin = await seedPlatformAdmin()

    const all = await listApplications({ sql: h.sql, sessionToken: admin.token, query: { termId: 'all' } })
    expect(all.status).toBe(200)
    const ids = all.body.items.map((i) => i.applicationId)
    expect(ids).toContain(appA)
    expect(ids).toContain(appB)

    const filtered = await listApplications({
      sql: h.sql,
      sessionToken: admin.token,
      query: { chapterId: a.chapter, termId: 'all' },
    })
    expect(filtered.body.items.map((i) => i.applicationId)).toContain(appA)
    expect(filtered.body.items.map((i) => i.applicationId)).not.toContain(appB)
  })

  test('no session -> opaque 403', async () => {
    const res = await listApplications({ sql: h.sql, query: {} })
    expect(res.status).toBe(403)
  })

  test('a non-director (wrong role) -> opaque 403', async () => {
    const a = await seedDirector(h.sql)
    const wrong = await makeAdult(h.sql)
    await h.sql`insert into membership (account_id, chapter_id, role, status) values (${wrong}, ${a.chapter}, 'comms_associate', 'active')`
    const res = await listApplications({
      sql: h.sql,
      sessionToken: await sessionFor(wrong),
      query: { chapterId: a.chapter },
    })
    expect(res.status).toBe(403)
  })

  test('?status filters (repeatable + CSV) narrow the list', async () => {
    const a = await seedDirector(h.sql)
    const submitted = await submittedApplication(a.chapter)
    const [screening] = await h.sql`
      insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email)
      values ('student', ${a.chapter}, 'screening', 'Minor Testchild', 'student@example.test') returning id
    `
    // CSV form
    const csv = await listApplications({
      sql: h.sql,
      sessionToken: a.directorToken,
      query: { status: 'submitted', termId: 'all' },
    })
    const csvIds = csv.body.items.map((i) => i.applicationId)
    expect(csvIds).toContain(submitted)
    expect(csvIds).not.toContain(screening!.id)

    // repeatable (array) form
    const both = await listApplications({
      sql: h.sql,
      sessionToken: a.directorToken,
      query: { status: ['submitted', 'screening'], termId: 'all' },
    })
    const bothIds = both.body.items.map((i) => i.applicationId)
    expect(bothIds).toContain(submitted)
    expect(bothIds).toContain(screening!.id)
  })
})

// ===========================================================================
describe('listApplications — full applicant info (authorized PII for the director)', () => {
  test('default returns FULL student name + grade + term; view=full adds guardian/school/contact', async () => {
    const a = await seedDirector(h.sql)
    const appId = await submittedApplication(a.chapter, 'Minor Secretlastname')
    await attachDraft(a.chapter, appId, {
      gradeEntering: '8',
      schoolName: 'Lincoln Middle School',
      guardianName: 'Parent Fullname',
    })

    const def = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { termId: 'all' } })
    const row = def.body.items.find((i) => i.applicationId === appId)!
    expect(row).toBeTruthy()
    // Full applicant name is now returned to the director (authorized PII change).
    expect(row.studentName).toBe('Minor Secretlastname')
    expect(row.gradeLevel).toBe('8')
    expect(row.submittedAt).toBeTruthy()
    // Term is derived by date-containment (2099-10-01 is inside Fall Term 2099).
    expect(row.termName).toBe('Fall Term 2099')
    expect(row.termId).toBeTruthy()
    // Default view is data-minimized: the extra full-PII fields are absent.
    expect(row.guardianName).toBeUndefined()
    expect(row.school).toBeUndefined()
    expect(row.contactEmail).toBeUndefined()

    const full = await listApplications({
      sql: h.sql,
      sessionToken: a.directorToken,
      query: { termId: 'all', view: 'full' },
    })
    const frow = full.body.items.find((i) => i.applicationId === appId)!
    expect(frow.guardianName).toBe('Parent Testperson') // application.guardian_name (full parent name)
    expect(frow.school).toBe('Lincoln Middle School')
    expect(frow.contactEmail).toBe('parent@example.test') // guardian_email ?? applicant_contact_email
  })

  test('gradeLevel is null when the draft has no grade (or no draft at all)', async () => {
    const a = await seedDirector(h.sql)
    const noDraft = await submittedApplication(a.chapter, 'Nodraft Kid')
    const noGrade = await submittedApplication(a.chapter, 'Nograde Kid')
    await attachDraft(a.chapter, noGrade, { schoolName: 'Some School' }) // no gradeEntering key
    const res = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { termId: 'all' } })
    expect(res.body.items.find((i) => i.applicationId === noDraft)!.gradeLevel).toBeNull()
    expect(res.body.items.find((i) => i.applicationId === noGrade)!.gradeLevel).toBeNull()
  })
})

// ===========================================================================
describe('listApplications — term filter + most-recent default', () => {
  test('?termId filters by window; ?termId=all returns all; no termId defaults to most recent', async () => {
    const a = await seedDirector(h.sql) // creates Fall Term 2099 (2099-09-01 .. 2099-12-15)
    const [fall] = await h.sql`select id from term where chapter_id = ${a.chapter} and name = 'Fall Term 2099'`
    const [spring] = await h.sql`
      insert into term (chapter_id, name, starts_on, ends_on)
      values (${a.chapter}, 'Spring 2100', '2100-01-01', '2100-05-01') returning id
    `
    const appFall = await submittedApplication(a.chapter, 'Fall Applicant', '2099-10-01T00:00:00Z')
    const appSpring = await submittedApplication(a.chapter, 'Spring Applicant', '2100-02-01T00:00:00Z')

    // ?termId=all — both appear, each carrying its own derived term.
    const all = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { termId: 'all' } })
    const allIds = all.body.items.map((i) => i.applicationId)
    expect(allIds).toEqual(expect.arrayContaining([appFall, appSpring]))
    const fallItem = all.body.items.find((i) => i.applicationId === appFall)!
    expect(fallItem.termId).toBe(fall!.id)
    expect(fallItem.termName).toBe('Fall Term 2099')

    // ?termId=<fall> — only the Fall applicant.
    const onlyFall = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: { termId: fall!.id as string } })
    const onlyFallIds = onlyFall.body.items.map((i) => i.applicationId)
    expect(onlyFallIds).toContain(appFall)
    expect(onlyFallIds).not.toContain(appSpring)
    expect(onlyFall.body.activeTermId).toBe(fall!.id)
    expect(onlyFall.body.activeTermName).toBe('Fall Term 2099')

    // No termId — defaults to the most recent term (Spring 2100), filters to it.
    const def = await listApplications({ sql: h.sql, sessionToken: a.directorToken, query: {} })
    const defIds = def.body.items.map((i) => i.applicationId)
    expect(defIds).toContain(appSpring)
    expect(defIds).not.toContain(appFall)
    expect(def.body.activeTermId).toBe(spring!.id)
    expect(def.body.activeTermName).toBe('Spring 2100')
  })
})

// ===========================================================================
describe('getApplication — full record + complete 2A/2B answers + history', () => {
  test('returns full name/grade/school/contact/parent + the raw answer blobs and history', async () => {
    const a = await seedDirector(h.sql)
    const appId = await submittedApplication(a.chapter, 'Minor Secretlastname')
    await attachDraft(
      a.chapter,
      appId,
      { childName: 'Minor Secretlastname', gradeEntering: '9', schoolName: 'Central High', guardianName: 'Parent Testperson' },
      { interests: 'robots', motivation: 'to build things' },
    )
    await h.sql`
      insert into application_event (application_id, from_status, to_status, note)
      values (${appId}, null, 'submitted', 'created'), (${appId}, 'submitted', 'screening', 'looks good')
    `

    const res = await getApplication({ sql: h.sql, sessionToken: a.directorToken, params: { id: appId } })
    expect(res.status).toBe(200)
    expect(res.body.applicationId).toBe(appId)
    // Full applicant PII returned to the director for their own chapter.
    expect(res.body.student.fullName).toBe('Minor Secretlastname')
    expect(res.body.student.gradeLevel).toBe('9')
    expect(res.body.student.school).toBe('Central High')
    expect(res.body.student.contactEmail).toBe('parent@example.test')
    expect(res.body.guardian.fullName).toBe('Parent Testperson')
    expect(res.body.guardian.email).toBe('parent@example.test')
    // Term derived by containment.
    expect(res.body.termName).toBe('Fall Term 2099')
    expect(res.body.termId).toBeTruthy()
    // The complete raw answer blobs, unmodified.
    expect(res.body.answers.stage2a).toMatchObject({ childName: 'Minor Secretlastname', gradeEntering: '9', schoolName: 'Central High' })
    expect(res.body.answers.stage2b).toMatchObject({ interests: 'robots', motivation: 'to build things' })
    expect(res.body.answers.stage2c).toBeNull()
    expect(res.body.history.map((e) => e.to)).toEqual(['submitted', 'screening'])
    expect(res.body.history[1]!.from).toBe('submitted')
  })

  test('a cross-chapter director gets an opaque 403 on the detail', async () => {
    const a = await seedDirector(h.sql)
    const b = await seedDirector(h.sql)
    const appId = await submittedApplication(a.chapter)
    const res = await getApplication({ sql: h.sql, sessionToken: b.directorToken, params: { id: appId } })
    expect(res.status).toBe(403)
  })

  test('an unknown application is a 404', async () => {
    const a = await seedDirector(h.sql)
    const res = await getApplication({ sql: h.sql, sessionToken: a.directorToken, params: { id: randomUUID() } })
    expect(res.status).toBe(404)
  })
})

// ===========================================================================
describe('applications PII change is scoped — other surfaces still masked', () => {
  test('memberships roster still returns a masked display name, never a raw last name', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const res = await listMemberships({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    const student = res.body.items.find((i) => i.accountId === s.accountId)!
    expect(student.displayName).toBe('Minor T.') // first name + last initial, unchanged
    expect(JSON.stringify(res.body)).not.toMatch(/Testchild/) // raw last name never leaks here
  })
})

// ===========================================================================
describe('listInvites — never leaks the raw token', () => {
  async function issueInviteFor(seed: DirectorSeed, kind: 'mentor' | 'staff' = 'mentor'): Promise<string> {
    const ctx = directorCtx(seed.director, seed.chapter)
    let token!: string
    let inviteId!: string
    await withRequest(async () => {
      const r = await new InviteService({ sql: h.sql, authorize }).issueInvite(
        { kind, chapterId: seed.chapter, targetEmail: `t-${randomUUID().slice(0, 6)}@example.test` },
        ctx,
      )
      token = r.token
      inviteId = r.inviteId
    })
    // stash the raw token on the closure for the leak assertion
    ;(issueInviteFor as unknown as { lastToken: string }).lastToken = token
    return inviteId
  }

  test('a director sees their chapter invites; the raw token is absent; another chapter sees none', async () => {
    const a = await seedDirector(h.sql)
    const b = await seedDirector(h.sql)
    const inviteA = await issueInviteFor(a)
    const rawToken = (issueInviteFor as unknown as { lastToken: string }).lastToken

    const seenByA = await listInvites({ sql: h.sql, sessionToken: a.directorToken, query: {} })
    expect(seenByA.status).toBe(200)
    const ids = seenByA.body.items.map((i) => i.inviteId)
    expect(ids).toContain(inviteA)
    // The raw token (and any token_hash) must never appear.
    expect(JSON.stringify(seenByA.body)).not.toContain(rawToken)
    expect(JSON.stringify(seenByA.body)).not.toMatch(/token/i)
    const row = seenByA.body.items.find((i) => i.inviteId === inviteA)!
    expect(row.status).toBe('pending')
    expect(row.kind).toBe('mentor')

    const seenByB = await listInvites({ sql: h.sql, sessionToken: b.directorToken, query: {} })
    expect(seenByB.body.items.map((i) => i.inviteId)).not.toContain(inviteA)
  })
})

// ===========================================================================
describe('listMemberships — roster with display names and filters', () => {
  test('a director sees their roster; ?status and ?role filter; no legal_name leaks', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const res = await listMemberships({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(res.status).toBe(200)
    const student = res.body.items.find((i) => i.accountId === s.accountId)
    expect(student).toBeTruthy()
    expect(student!.displayName).toBe('Minor T.')
    expect(student!.role).toBe('student')
    expect(student!.status).toBe('active')
    expect(JSON.stringify(res.body)).not.toMatch(/Testchild/) // legal_name never rendered

    const filteredRole = await listMemberships({
      sql: h.sql,
      sessionToken: s.directorToken,
      query: { role: 'chapter_director' },
    })
    expect(filteredRole.body.items.every((i) => i.role === 'chapter_director')).toBe(true)

    const filteredStatus = await listMemberships({
      sql: h.sql,
      sessionToken: s.directorToken,
      query: { status: 'active' },
    })
    expect(filteredStatus.body.items.every((i) => i.status === 'active')).toBe(true)
  })
})

// ===========================================================================
describe('listGuardianships — the name-match surface (needs both names)', () => {
  test('returns guardianDisplayName, guardianNameOnAccount, studentDisplayName, and nameOnForm', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const [g] = await h.sql`
      insert into account (email, legal_name, display_name, date_of_birth, dob_provenance, credential_owner, status, maturation_state)
      values (${s.guardianEmail}, 'Parent Onform', 'Parent O.', '1985-01-01', 'staff_entered', 'self_private', 'active', 'self_managed')
      returning id
    `
    await h.sql`
      insert into guardianship (guardian_account_id, student_account_id, relationship, status, verification_method)
      values (${g!.id}, ${s.accountId}, 'guardian', 'pending', 'signed_form_match')
    `
    const res = await listGuardianships({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(res.status).toBe(200)
    const row = res.body.items.find((i) => i.studentDisplayName === 'Minor T.')
    expect(row).toBeTruthy()
    expect(row!.guardianDisplayName).toBe('Parent O.')
    expect(row!.guardianNameOnAccount).toBe('Parent Onform') // legal name — legitimate here
    expect(row!.nameOnForm).toBe('Parent Testperson') // the enrollment form name
    expect(row!.status).toBe('pending')
  })

  test('another chapter director sees none of chapter A guardianships', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const [g] = await h.sql`
      insert into account (email, legal_name, display_name, date_of_birth, dob_provenance, credential_owner, status, maturation_state)
      values (${s.guardianEmail}, 'Parent Onform', 'Parent O.', '1985-01-01', 'staff_entered', 'self_private', 'active', 'self_managed')
      returning id
    `
    await h.sql`
      insert into guardianship (guardian_account_id, student_account_id, relationship, status, verification_method)
      values (${g!.id}, ${s.accountId}, 'guardian', 'pending', 'signed_form_match')
    `
    const other = await seedDirector(h.sql)
    const res = await listGuardianships({ sql: h.sql, sessionToken: other.directorToken, query: {} })
    expect(res.body.items.every((i) => i.studentDisplayName !== 'Minor T.' || i.guardianDisplayName !== 'Parent O.')).toBe(true)
  })
})

// ===========================================================================
describe('listMediaReviewQueue — gated on media.review', () => {
  test('a director sees pending media with depiction display names + confirmed flags', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const [proj] = await h.sql`
      insert into project (chapter_id, owner_membership_id, title, status)
      values (${s.chapter}, ${s.membershipId}, 'Robot Arm', 'submitted') returning id
    `
    const [media] = await h.sql`
      insert into project_media (project_id, storage_ref, review_status)
      values (${proj!.id}, ${randomUUID()}, 'pending_review') returning id
    `
    await h.sql`
      insert into media_depiction (media_id, account_id, added_by, source, confirmed_at)
      values (${media!.id}, ${s.accountId}, ${s.director}, 'student', null)
    `
    const res = await listMediaReviewQueue({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(res.status).toBe(200)
    const row = res.body.items.find((i) => i.mediaId === media!.id)
    expect(row).toBeTruthy()
    expect(row!.projectTitle).toBe('Robot Arm')
    expect(row!.depictions[0]!.displayName).toBe('Minor T.')
    expect(row!.depictions[0]!.confirmed).toBe(false)
    expect(JSON.stringify(res.body)).not.toMatch(/Testchild/)
  })
})

// ===========================================================================
describe('listDeletionRequests / listExportRequests', () => {
  test('a director sees their chapter deletion + export requests', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    await h.sql`
      insert into deletion_request (subject_account_id, requested_by, scope_requested, status)
      values (${s.accountId}, ${s.director}, 'full', 'requested')
    `
    await h.sql`
      insert into export_request (subject_account_id, requested_by, status)
      values (${s.accountId}, ${s.director}, 'requested')
    `
    const del = await listDeletionRequests({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(del.status).toBe(200)
    const dr = del.body.items.find((i) => i.subjectAccountId === s.accountId)
    expect(dr).toBeTruthy()
    expect(dr!.subjectDisplayName).toBe('Minor T.')

    const exp = await listExportRequests({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(exp.status).toBe(200)
    expect(exp.body.items.some((i) => i.subjectAccountId === s.accountId)).toBe(true)

    const other = await seedDirector(h.sql)
    const otherDel = await listDeletionRequests({ sql: h.sql, sessionToken: other.directorToken, query: {} })
    expect(otherDel.body.items.some((i) => i.subjectAccountId === s.accountId)).toBe(false)
  })
})

// ===========================================================================
describe('listEnrollments', () => {
  test('a director sees their enrollments with hasAccount + term name', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const res = await listEnrollments({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(res.status).toBe(200)
    const row = res.body.items.find((i) => i.enrollmentRecordId === s.enrollmentRecordId)
    expect(row).toBeTruthy()
    expect(row!.hasAccount).toBe(true) // accept-student linked the account
    expect(row!.termId).toBe(s.term)
    expect(row!.termName).toBe('Fall Term 2099')
    expect(row!.guardianNameOnForm).toBe('Parent Testperson')
  })
})

// ===========================================================================
describe('listPods / listTerms', () => {
  test('a director sees pods (with mentor display name + member count) and terms', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    // a mentor membership to name as the pod mentor
    const mentorAcct = await makeAdult(h.sql)
    const [mentorMem] = await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${mentorAcct}, ${s.chapter}, 'senior_instructor', 'active') returning id
    `
    const [pod] = await h.sql`
      insert into pod (chapter_id, term_id, name, mentor_membership_id)
      values (${s.chapter}, ${s.term}, 'Pod Beta', ${mentorMem!.id}) returning id
    `
    await h.sql`
      insert into pod_assignment (membership_id, pod_id, term_id)
      values (${s.membershipId}, ${pod!.id}, ${s.term})
    `
    const pods = await listPods({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(pods.status).toBe(200)
    const row = pods.body.items.find((i) => i.podId === pod!.id)
    expect(row).toBeTruthy()
    expect(row!.name).toBe('Pod Beta')
    expect(row!.mentorDisplayName).toBe('Adult T.')
    expect(row!.memberCount).toBe(1)

    const terms = await listTerms({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(terms.status).toBe(200)
    expect(terms.body.items.some((i) => i.termId === s.term && i.name === 'Fall Term 2099')).toBe(true)
  })
})

// ===========================================================================
describe('opsDashboard — the count-card summary', () => {
  test('returns the chapter counts for a director', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    await submittedApplication(s.chapter)
    const res = await opsDashboard({ sql: h.sql, sessionToken: s.directorToken, query: {} })
    expect(res.status).toBe(200)
    expect(res.body.newApplications).toBeGreaterThanOrEqual(1)
    expect(res.body.activeMembers).toBeGreaterThanOrEqual(1) // the director + the active student
    expect(typeof res.body.pendingInvites).toBe('number')
    expect(typeof res.body.guardianshipsToVerify).toBe('number')
    expect(typeof res.body.mediaToReview).toBe('number')
    expect(typeof res.body.openRequests).toBe('number')
  })

  test('no session -> opaque 403', async () => {
    const res = await opsDashboard({ sql: h.sql, query: {} })
    expect(res.status).toBe(403)
  })
})
