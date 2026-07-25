// -------------------------------------------------------------------------
// ACCOUNT SELF-SERVICE ("My Information") — GET assembly + PATCH rules.
// Embedded Postgres, synthetic data only, deterministic clocks.
//
// AccountService.getAccount assembles the caller's OWN info per role (self-only,
// never another member's row); updateAccount edits the few editable fields
// (email — role-aware; school — students only), server-enforced.
//
// RECONCILIATION 1 (email is ROLE-AWARE): an adult's primaryEmail is account.email
// (editable); a student's email runs through the PRIMARY/SECONDARY notification
// model — under-13 / flag-off → frozen to the guardian (not editable), 13+ with the
// flag on + an active grant → their own primary is editable, guardian is secondary.
// A student email PATCH DELEGATES to the same gated notification write (it sets
// notification_email, never account.email).
// RECONCILIATION 2 (school first-class): GET returns account.school when set, else
// falls back to the funnel's parent_answers.schoolName; PATCH (students only) writes
// account.school.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeMinor, makeChapter, makeTerm, makeMembership } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import type { AuthContext } from '@curiolab/core'
import {
  AccountService,
  ConsentGrantService,
  AccountFieldNotEditableError,
  InvalidAccountEmailError,
  StudentNotificationEmailNotAuthorizedError,
  defaultConfig,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const NOW = new Date('2026-07-25T12:00:00Z')
const flagOn = { ...defaultConfig, studentNotificationEmailEnabled: true }
const flagOff = { ...defaultConfig, studentNotificationEmailEnabled: false }

const DOB_15 = '2011-01-01' // 15 at NOW
const DOB_UNDER_13 = '2020-06-01' // ~6 at NOW
const CHAP = 'chapter-synthetic'
const uniqEmail = (p: string) => `${p}-${randomUUID().slice(0, 8)}@example.test`

function acctSvc(config = flagOn) {
  return new AccountService({ sql: h.sql, authorize, config })
}

/** A student acting on their OWN account: an in-force student membership + age. */
function studentCtx(studentId: string, age = 15): AuthContext {
  const c = baseCtx(studentId, NOW, [mem('student', CHAP)])
  return { ...c, account: { ...c.account, age, maturation_state: age < 18 ? 'minor' : 'self_managed' } }
}

function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, NOW), guardianOf: children }
}

/** Insert a VERIFIED guardianship edge (guardian -> student). */
async function verifiedGuardian(studentId: string, email: string): Promise<string> {
  const guardian = await makeAdult(h.sql, { email })
  await h.sql`
    insert into guardianship (
      guardian_account_id, student_account_id, relationship, status,
      verification_method, verified_by, source_ref, verified_at
    ) values (
      ${guardian}, ${studentId}, 'guardian', 'verified',
      'signed_form_match', ${guardian}, ${randomUUID()}, now()
    )
  `
  return guardian
}

/** Capture an active student_notification_email grant for a 13+ student. */
async function captureGrant(studentId: string, guardianId: string) {
  const svc = new ConsentGrantService({ sql: h.sql, authorize })
  await withRequest(async () => {
    await svc.captureGrant(studentId, 'student_notification_email', guardianCtx(guardianId, [studentId]), {
      method: 'signed_form',
      evidenceArtifactRef: 'artifact://synthetic-signed-form',
      now: NOW,
    })
  })
}

/**
 * Seed the funnel chain so parent_answers is reachable from a student account:
 * application_lead -> application -> application_draft (converted, parent_answers)
 * and an enrollment_record linking the student to the application.
 */
async function seedFunnel(
  studentId: string,
  _chapterLabel: string,
  answers: Record<string, string>,
): Promise<void> {
  const staff = await makeAdult(h.sql)
  // A REAL chapter/term for the enrollment FKs (the service reads the funnel by
  // student_account_id, so the ctx membership's synthetic chapter id is irrelevant).
  const chapterId = await makeChapter(h.sql)
  const termId = await makeTerm(h.sql, chapterId)
  const [lead] = await h.sql`
    insert into application_lead (email, chapter, filler_role, status, expires_at)
    values (${uniqEmail('lead')}, 'CODE', 'parent', 'new', ${new Date(NOW.getTime() + 1e9)})
    returning id
  `
  const [app] = await h.sql`
    insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email)
    values ('student', ${chapterId}, 'submitted', 'Minor Testchild', ${uniqEmail('app')})
    returning id
  `
  await h.sql`
    insert into application_draft (lead_id, parent_token_hash, phase, status, parent_answers, converted_application_id)
    values (${lead!.id}, ${randomUUID()}, 'submitted', 'submitted', ${h.sql.json(answers)}, ${app!.id})
  `
  await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id, signed_form_ref,
      guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${studentId}, ${chapterId}, ${termId}, ${randomUUID()},
      'Parent Testperson', ${staff}
    )
  `
}

async function acctEmail(id: string): Promise<string | null> {
  const [row] = await h.sql`select email from account where id = ${id}`
  return (row!.email as string | null) ?? null
}
async function notifEmail(id: string): Promise<string | null> {
  const [row] = await h.sql`select notification_email from account where id = ${id}`
  return (row!.notification_email as string | null) ?? null
}
async function acctSchool(id: string): Promise<string | null> {
  const [row] = await h.sql`select school from account where id = ${id}`
  return (row!.school as string | null) ?? null
}
async function auditCount(subjectId: string): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from audit_entry where subject_id = ${subjectId}`
  return row!.n as number
}

// ===========================================================================
describe('getAccount — the role-aware self-read', () => {
  test('an ADULT GUARDIAN: primaryEmail=account.email, secondary null, editable, no freeze', async () => {
    const gEmail = uniqEmail('guardian')
    const guardian = await makeAdult(h.sql, { email: gEmail })
    const child = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    await h.sql`
      insert into guardianship (guardian_account_id, student_account_id, relationship, status, verification_method, verified_by, source_ref, verified_at)
      values (${guardian}, ${child}, 'guardian', 'verified', 'signed_form_match', ${guardian}, ${randomUUID()}, now())
    `
    const out = await withRequest(() => acctSvc().getAccount(guardianCtx(guardian, [child]), { now: NOW }))
    expect(out.role).toBe('guardian')
    expect(out.primaryEmail).toBe(gEmail)
    expect(out.secondaryEmail).toBeNull()
    expect(out.emailEditable).toBe(true)
    expect(out.emailFrozenTo).toBeNull()
    expect(out.children).toEqual([{ name: 'Minor T.' }])
    expect(out.dateOfBirth).toBeNull() // not a student
  })

  test('a CHAPTER_DIRECTOR: primaryEmail=account.email, editable, chapter name present', async () => {
    const dEmail = uniqEmail('director')
    const director = await makeAdult(h.sql, { email: dEmail })
    const chapterId = await makeChapter(h.sql)
    await makeMembership(h.sql, director, chapterId, { role: 'chapter_director' })
    const ctx = baseCtx(director, NOW, [mem('chapter_director', chapterId)])
    const out = await withRequest(() => acctSvc().getAccount(ctx, { now: NOW }))
    expect(out.role).toBe('chapter_director')
    expect(out.roleLabel).toBe('Chapter Director')
    expect(out.primaryEmail).toBe(dEmail)
    expect(out.emailEditable).toBe(true)
    expect(out.chapter).toBeTruthy()
  })

  test('a STUDENT UNDER 13: emailEditable=false, frozen to guardian, dob/age/grade present', async () => {
    const gEmail = uniqEmail('g')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_UNDER_13 })
    await verifiedGuardian(student, gEmail)
    await seedFunnel(student, CHAP, { schoolName: 'Funnel Elementary', gradeEntering: '6', guardianPhone: '(216) 555-0143' })
    const out = await withRequest(() => acctSvc(flagOn).getAccount(studentCtx(student, 6), { now: NOW }))
    expect(out.role).toBe('student')
    expect(out.emailEditable).toBe(false)
    expect(out.emailFrozenTo).toBe(gEmail)
    expect(out.primaryEmail).toBe(gEmail)
    expect(out.secondaryEmail).toBeNull()
    expect(out.dateOfBirth).toBe(DOB_UNDER_13)
    expect(out.age).toBe(6)
    expect(out.grade).toBe('6')
    expect(out.guardian).toEqual({ name: 'Adult Testperson', email: gEmail })
  })

  test('a STUDENT 13+ with the flag OFF: editable=false, frozen to guardian', async () => {
    const gEmail = uniqEmail('g')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, gEmail)
    await captureGrant(student, guardian)
    const out = await withRequest(() => acctSvc(flagOff).getAccount(studentCtx(student), { now: NOW }))
    expect(out.emailEditable).toBe(false)
    expect(out.emailFrozenTo).toBe(gEmail)
    expect(out.primaryEmail).toBe(gEmail)
    expect(out.secondaryEmail).toBeNull()
  })

  test('a STUDENT 13+ (flag on + grant) who set their OWN primary: primary=own, secondary=guardian, editable', async () => {
    const gEmail = uniqEmail('g')
    const kid = uniqEmail('kid')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, gEmail)
    await captureGrant(student, guardian)
    await h.sql`update account set notification_email = ${kid} where id = ${student}`
    const out = await withRequest(() => acctSvc(flagOn).getAccount(studentCtx(student), { now: NOW }))
    expect(out.emailEditable).toBe(true)
    expect(out.emailFrozenTo).toBeNull()
    expect(out.primaryEmail).toBe(kid)
    expect(out.secondaryEmail).toBe(gEmail)
  })

  test('school FALLS BACK to parent_answers.schoolName when account.school is null; grade is read-only', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    await verifiedGuardian(student, uniqEmail('g'))
    await seedFunnel(student, CHAP, { schoolName: 'Funnel High', gradeEntering: '10' })
    const out = await withRequest(() => acctSvc().getAccount(studentCtx(student), { now: NOW }))
    expect(out.school).toBe('Funnel High')
    expect(out.grade).toBe('10')
  })

  test('school prefers account.school over the funnel fallback when set', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    await verifiedGuardian(student, uniqEmail('g'))
    await seedFunnel(student, CHAP, { schoolName: 'Funnel High' })
    await h.sql`update account set school = ${'Edited Academy'} where id = ${student}`
    const out = await withRequest(() => acctSvc().getAccount(studentCtx(student), { now: NOW }))
    expect(out.school).toBe('Edited Academy')
  })
})

// ===========================================================================
describe('updateAccount — the server-enforced editable fields', () => {
  test('an ADULT updates account.email (format validated); writes an audit row', async () => {
    const director = await makeAdult(h.sql, { email: uniqEmail('director') })
    const chapterId = await makeChapter(h.sql)
    await makeMembership(h.sql, director, chapterId, { role: 'chapter_director' })
    const ctx = baseCtx(director, NOW, [mem('chapter_director', chapterId)])
    const next = uniqEmail('director-new')
    await withRequest(() => acctSvc().updateAccount(ctx, { email: next }, { now: NOW }))
    expect(await acctEmail(director)).toBe(next)
    expect(await auditCount(director)).toBeGreaterThanOrEqual(1)
  })

  test('an ADULT bad email format → InvalidAccountEmailError (400), unchanged', async () => {
    const before = uniqEmail('director')
    const director = await makeAdult(h.sql, { email: before })
    const chapterId = await makeChapter(h.sql)
    await makeMembership(h.sql, director, chapterId, { role: 'chapter_director' })
    const ctx = baseCtx(director, NOW, [mem('chapter_director', chapterId)])
    await expect(
      withRequest(() => acctSvc().updateAccount(ctx, { email: 'not-an-email' }, { now: NOW })),
    ).rejects.toBeInstanceOf(InvalidAccountEmailError)
    expect(await acctEmail(director)).toBe(before)
  })

  test('a STUDENT UNDER 13 email PATCH is REJECTED (opaque), account.email untouched', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_UNDER_13 })
    await verifiedGuardian(student, uniqEmail('g'))
    await expect(
      withRequest(() => acctSvc(flagOn).updateAccount(studentCtx(student, 6), { email: 'kid@example.test' }, { now: NOW })),
    ).rejects.toBeInstanceOf(StudentNotificationEmailNotAuthorizedError)
    expect(await notifEmail(student)).toBeNull()
    expect(await acctEmail(student)).toBeNull()
  })

  test('a STUDENT 13+ email PATCH with the flag OFF is REJECTED', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, uniqEmail('g'))
    await captureGrant(student, guardian)
    await expect(
      withRequest(() => acctSvc(flagOff).updateAccount(studentCtx(student), { email: 'kid@example.test' }, { now: NOW })),
    ).rejects.toBeInstanceOf(StudentNotificationEmailNotAuthorizedError)
    expect(await notifEmail(student)).toBeNull()
  })

  test('a STUDENT 13+ email PATCH (flag on + grant) SUCCEEDS via the notification model — sets notification_email, NOT account.email', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, uniqEmail('g'))
    await captureGrant(student, guardian)
    const kid = 'kid@example.test'
    await withRequest(() => acctSvc(flagOn).updateAccount(studentCtx(student), { email: kid }, { now: NOW }))
    expect(await notifEmail(student)).toBe(kid) // notification primary
    expect(await acctEmail(student)).toBeNull() // login identity untouched
    expect(await auditCount(student)).toBeGreaterThanOrEqual(1)
  })

  test('a STUDENT updates school → account.school written; audit row', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    await verifiedGuardian(student, uniqEmail('g'))
    await withRequest(() => acctSvc().updateAccount(studentCtx(student), { school: 'New School' }, { now: NOW }))
    expect(await acctSchool(student)).toBe('New School')
    expect(await auditCount(student)).toBeGreaterThanOrEqual(1)
  })

  test('a NON-STUDENT school PATCH is REJECTED (AccountFieldNotEditableError)', async () => {
    const director = await makeAdult(h.sql, { email: uniqEmail('director') })
    const chapterId = await makeChapter(h.sql)
    await makeMembership(h.sql, director, chapterId, { role: 'chapter_director' })
    const ctx = baseCtx(director, NOW, [mem('chapter_director', chapterId)])
    await expect(
      withRequest(() => acctSvc().updateAccount(ctx, { school: 'Nope' }, { now: NOW })),
    ).rejects.toBeInstanceOf(AccountFieldNotEditableError)
  })

  test('an UNKNOWN field in the body is ignored (no error, no change)', async () => {
    const director = await makeAdult(h.sql, { email: uniqEmail('director') })
    const chapterId = await makeChapter(h.sql)
    await makeMembership(h.sql, director, chapterId, { role: 'chapter_director' })
    const ctx = baseCtx(director, NOW, [mem('chapter_director', chapterId)])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await withRequest(() => acctSvc().updateAccount(ctx, { legalName: 'Hacker' } as any, { now: NOW }))
    expect(out.fullName).toBe('Adult Testperson') // unchanged
  })
})
