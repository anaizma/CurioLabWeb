// -------------------------------------------------------------------------
// Database guarantee tests (07-test-plan.md, "Database guarantee tests", the
// Milestone 0 subset). Each guarantee inserts a violating row and asserts the
// database rejects it, with a positive control that the legal row is accepted.
//
// TDD: run with CURIOLAB_MIGRATE_UPTO=0000 to witness these fail (the base
// schema accepts the violating rows); the default run applies 0001_guarantees
// and 0002_roles and they pass.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import {
  makeAdult,
  makeApplication,
  makeChapter,
  makeEnrollment,
  makeMembership,
  makeMinor,
  makePod,
  makeTerm,
} from './helpers/fixtures.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness({ uptoInclusive: process.env.CURIOLAB_MIGRATE_UPTO })
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// ---------------------------------------------------------------------------
describe('Decision-4 DOB trigger', () => {
  test('active student membership requires enrollment_record provenance', async () => {
    const chapter = await makeChapter(h.sql)
    const bad = await makeMinor(h.sql, { dobProvenance: 'self_reported', dobSourceRef: null })
    await expect(
      makeMembership(h.sql, bad, chapter, { role: 'student', status: 'active' }),
    ).rejects.toThrow(/dob/i)
  })

  test('provenance enrollment_record with a source ref is accepted (control)', async () => {
    const chapter = await makeChapter(h.sql)
    const good = await makeMinor(h.sql) // enrollment_record provenance + source ref
    const id = await makeMembership(h.sql, good, chapter, { role: 'student', status: 'active' })
    expect(id).toBeTruthy()
  })

  test('enrollment_record provenance but null source ref is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const bad = await makeMinor(h.sql, { dobProvenance: 'enrollment_record', dobSourceRef: null })
    await expect(
      makeMembership(h.sql, bad, chapter, { role: 'student', status: 'active' }),
    ).rejects.toThrow(/dob/i)
  })
})

// ---------------------------------------------------------------------------
describe('Form-sourced consent checks', () => {
  async function student(): Promise<string> {
    return makeMinor(h.sql)
  }

  test('data_collection signed_form with null source_ref is rejected', async () => {
    const s = await student()
    await expect(h.sql`
      insert into consent (student_account_id, type, action, source, source_ref, effective_at, reason)
      values (${s}, 'data_collection', 'grant', 'signed_form', null, '2025-01-01', 'standard')
    `).rejects.toThrow(/source_ref/i)
  })

  test('data_collection signed_form with a source_ref and enrollment link is accepted (control)', async () => {
    // Under the ruled change a signed_form row must also name its enrollment
    // anchor and carry a signature date not before the application submission.
    const s = await student()
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const issuer = await makeAdult(h.sql)
    const application = await makeApplication(h.sql, chapter, 'parent@example.test')
    const enrollment = await makeEnrollment(h.sql, {
      applicationId: application,
      chapterId: chapter,
      termId: term,
      createdBy: issuer,
    })
    const rows = await h.sql`
      insert into consent (
        student_account_id, type, action, source, source_ref, enrollment_record_id,
        effective_at, reason
      ) values (
        ${s}, 'data_collection', 'grant', 'signed_form', ${randomUUID()}, ${enrollment},
        now(), 'standard'
      ) returning id
    `
    expect(rows.length).toBe(1)
  })

  test('external_publication with null scope_ref is rejected', async () => {
    const s = await student()
    await expect(h.sql`
      insert into consent (student_account_id, type, action, source, scope_ref, effective_at, reason)
      values (${s}, 'external_publication', 'grant', 'digital', null, '2025-01-01', 'standard')
    `).rejects.toThrow(/scope_ref/i)
  })

  test('external_publication with a scope_ref is accepted (control)', async () => {
    const s = await student()
    const rows = await h.sql`
      insert into consent (student_account_id, type, action, source, scope_ref, effective_at, reason)
      values (${s}, 'external_publication', 'grant', 'digital', ${randomUUID()}, '2025-01-01', 'standard')
      returning id
    `
    expect(rows.length).toBe(1)
  })

  test('effective_at in the future is rejected', async () => {
    const s = await student()
    await expect(h.sql`
      insert into consent (student_account_id, type, action, source, effective_at, reason)
      values (${s}, 'platform_participation', 'grant', 'digital', '2099-01-01', 'standard')
    `).rejects.toThrow(/future/i)
  })
})

// ---------------------------------------------------------------------------
describe('Consent enrollment link and temporal rule (ruled change)', () => {
  // Build an accepted application + enrollment with EXPLICIT timestamps, so the
  // temporal floor (the application submission date) and the enrollment
  // record's own creation can be placed on either side of a signature date.
  async function enrollmentWith(opts: {
    submittedAt: string
    enrollmentCreatedAt: string
  }): Promise<{ studentId: string; enrollmentId: string }> {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const issuer = await makeAdult(h.sql)
    const student = await makeMinor(h.sql)
    const [app] = await h.sql`
      insert into application (
        kind, chapter_id, status, applicant_name, applicant_contact_email,
        guardian_name, guardian_email, created_at
      ) values (
        'student', ${chapter}, 'accepted', 'Minor Testchild',
        'parent@example.test', 'Parent Testperson', 'parent@example.test', ${opts.submittedAt}
      ) returning id
    `
    const [enr] = await h.sql`
      insert into enrollment_record (
        application_id, student_account_id, chapter_id, term_id, signed_form_ref,
        guardian_name_on_form, created_by, created_at
      ) values (
        ${app!.id}, ${student}, ${chapter}, ${term}, ${randomUUID()},
        'Parent Testperson', ${issuer}, ${opts.enrollmentCreatedAt}
      ) returning id
    `
    return { studentId: student, enrollmentId: enr!.id as string }
  }

  test('a signed_form consent with null enrollment_record_id is rejected', async () => {
    const s = await makeMinor(h.sql)
    await expect(h.sql`
      insert into consent (
        student_account_id, type, action, source, source_ref, enrollment_record_id,
        effective_at, reason
      ) values (
        ${s}, 'enrollment', 'grant', 'signed_form', ${randomUUID()}, null,
        '2026-01-01T00:00:00Z', 'standard'
      )
    `).rejects.toThrow(/enrollment_record|signed_form/i)
  })

  test('a signature after submission but before the enrollment record creation is accepted (the old rule got this wrong)', async () => {
    // Application submitted Jan 1; guardian signs the form Feb 1; staff upload
    // the scan (enrollment record created) Mar 1. The old rule floored at the
    // enrollment record's created_at (Mar 1) and wrongly rejected a Feb 1
    // signature; the new rule floors at the Jan 1 submission and accepts it.
    const { studentId, enrollmentId } = await enrollmentWith({
      submittedAt: '2026-01-01T00:00:00Z',
      enrollmentCreatedAt: '2026-03-01T00:00:00Z',
    })
    const rows = await h.sql`
      insert into consent (
        student_account_id, type, action, source, source_ref, enrollment_record_id,
        effective_at, reason
      ) values (
        ${studentId}, 'enrollment', 'grant', 'signed_form', ${randomUUID()}, ${enrollmentId},
        '2026-02-01T00:00:00Z', 'standard'
      ) returning id
    `
    expect(rows.length).toBe(1)
  })

  test('an effective_at before the application submission date is rejected', async () => {
    const { studentId, enrollmentId } = await enrollmentWith({
      submittedAt: '2026-01-01T00:00:00Z',
      enrollmentCreatedAt: '2026-03-01T00:00:00Z',
    })
    await expect(h.sql`
      insert into consent (
        student_account_id, type, action, source, source_ref, enrollment_record_id,
        effective_at, reason
      ) values (
        ${studentId}, 'enrollment', 'grant', 'signed_form', ${randomUUID()}, ${enrollmentId},
        '2025-12-01T00:00:00Z', 'standard'
      )
    `).rejects.toThrow(/submission|precede/i)
  })

  test('a future effective_at is rejected even with an enrollment link', async () => {
    const { studentId, enrollmentId } = await enrollmentWith({
      submittedAt: '2026-01-01T00:00:00Z',
      enrollmentCreatedAt: '2026-03-01T00:00:00Z',
    })
    await expect(h.sql`
      insert into consent (
        student_account_id, type, action, source, source_ref, enrollment_record_id,
        effective_at, reason
      ) values (
        ${studentId}, 'enrollment', 'grant', 'signed_form', ${randomUUID()}, ${enrollmentId},
        '2099-01-01T00:00:00Z', 'standard'
      )
    `).rejects.toThrow(/future/i)
  })
})

// ---------------------------------------------------------------------------
describe('Enrollment DOB provenance (ruled): seeding requirement and write-once', () => {
  // A fresh application + term + issuer to hang enrollment records off.
  async function funnel(): Promise<{
    chapter: string
    term: string
    issuer: string
    application: string
  }> {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const issuer = await makeAdult(h.sql)
    const application = await makeApplication(h.sql, chapter, 'parent@example.test')
    return { chapter, term, issuer, application }
  }

  async function insertEnrollment(opts: {
    application: string
    chapter: string
    term: string
    issuer: string
    studentAccountId: string | null
    dateOfBirth: string | null
  }) {
    return h.sql`
      insert into enrollment_record (
        application_id, student_account_id, chapter_id, term_id, signed_form_ref,
        guardian_name_on_form, date_of_birth, created_by
      ) values (
        ${opts.application}, ${opts.studentAccountId}, ${opts.chapter}, ${opts.term}, ${randomUUID()},
        'Parent Testperson', ${opts.dateOfBirth}, ${opts.issuer}
      ) returning id
    `
  }

  test('a seeding enrollment (student_account_id null) with a null DOB is rejected', async () => {
    const f = await funnel()
    await expect(
      insertEnrollment({ ...f, studentAccountId: null, dateOfBirth: null }),
    ).rejects.toThrow(/date_of_birth|dob|check/i)
  })

  test('a seeding enrollment with a DOB is accepted (control)', async () => {
    const f = await funnel()
    const rows = await insertEnrollment({
      ...f,
      studentAccountId: null,
      dateOfBirth: '2015-06-01',
    })
    expect(rows.length).toBe(1)
  })

  test('a returning enrollment (student_account_id present) with a null DOB is accepted (control)', async () => {
    const f = await funnel()
    const student = await makeMinor(h.sql)
    const rows = await insertEnrollment({
      ...f,
      studentAccountId: student,
      dateOfBirth: null,
    })
    expect(rows.length).toBe(1)
  })

  test('an ordinary UPDATE of enrollment_record.date_of_birth is rejected (write-once)', async () => {
    const f = await funnel()
    const [enr] = await insertEnrollment({
      ...f,
      studentAccountId: null,
      dateOfBirth: '2015-06-01',
    })
    await expect(
      h.sql`update enrollment_record set date_of_birth = '2016-06-01' where id = ${enr!.id}`,
    ).rejects.toThrow(/write.?once|date_of_birth|dob/i)
  })

  test('an ordinary UPDATE of account.date_of_birth is rejected (write-once)', async () => {
    const student = await makeMinor(h.sql)
    await expect(
      h.sql`update account set date_of_birth = '2016-06-01' where id = ${student}`,
    ).rejects.toThrow(/write.?once|date_of_birth|dob/i)
  })

  test('a correction transaction (app.dob_correction=on) may update the enrollment record DOB', async () => {
    const f = await funnel()
    const [enr] = await insertEnrollment({
      ...f,
      studentAccountId: null,
      dateOfBirth: '2015-06-01',
    })
    const id = enr!.id as string
    await h.sql.begin(async (tx) => {
      await tx`set local app.dob_correction = 'on'`
      await tx`update enrollment_record set date_of_birth = '2016-06-01' where id = ${id}`
    })
    const [row] = await h.sql`select date_of_birth from enrollment_record where id = ${id}`
    expect(new Date(row!.date_of_birth as string).getUTCFullYear()).toBe(2016)
  })

  test('a correction transaction (app.dob_correction=on) may update the account DOB', async () => {
    const student = await makeMinor(h.sql)
    await h.sql.begin(async (tx) => {
      await tx`set local app.dob_correction = 'on'`
      await tx`update account set date_of_birth = '2016-06-01' where id = ${student}`
    })
    const [row] = await h.sql`select date_of_birth from account where id = ${student}`
    expect(new Date(row!.date_of_birth as string).getUTCFullYear()).toBe(2016)
  })
})

// ---------------------------------------------------------------------------
describe('Single active membership', () => {
  test('two active memberships for the same (account, chapter, role) collide', async () => {
    const chapter = await makeChapter(h.sql)
    const adult = await makeAdult(h.sql)
    await makeMembership(h.sql, adult, chapter, { role: 'lead_instructor', status: 'active' })
    await expect(
      makeMembership(h.sql, adult, chapter, { role: 'lead_instructor', status: 'active' }),
    ).rejects.toThrow(/duplicate|unique/i)
  })

  test('a second non-active membership is allowed (control)', async () => {
    const chapter = await makeChapter(h.sql)
    const adult = await makeAdult(h.sql)
    await makeMembership(h.sql, adult, chapter, { role: 'lead_instructor', status: 'active' })
    const id = await makeMembership(h.sql, adult, chapter, {
      role: 'lead_instructor',
      status: 'inactive',
    })
    expect(id).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('Evidence-backed tier transition', () => {
  test('null evidence_ref is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const student = await makeMinor(h.sql)
    const membership = await makeMembership(h.sql, student, chapter, {
      role: 'student',
      status: 'active',
    })
    const director = await makeAdult(h.sql)
    await expect(h.sql`
      insert into tier_transition (membership_id, to_tier, granted_by, evidence_ref)
      values (${membership}, 'builder', ${director}, null)
    `).rejects.toThrow(/evidence_ref|not-null|null value/i)
  })

  test('an inserted transition syncs membership.current_tier (coupling F)', async () => {
    const chapter = await makeChapter(h.sql)
    const student = await makeMinor(h.sql)
    const membership = await makeMembership(h.sql, student, chapter, {
      role: 'student',
      status: 'active',
      currentTier: 'explorer',
    })
    const director = await makeAdult(h.sql)
    await h.sql`
      insert into tier_transition (membership_id, from_tier, to_tier, granted_by, evidence_ref)
      values (${membership}, 'explorer', 'builder', ${director}, ${randomUUID()})
    `
    const [row] = await h.sql`select current_tier from membership where id = ${membership}`
    expect(row!.current_tier).toBe('builder')
  })
})

// ---------------------------------------------------------------------------
describe('Append-only: consent and audit_entry', () => {
  async function aConsent(): Promise<string> {
    const s = await makeMinor(h.sql)
    const [row] = await h.sql`
      insert into consent (student_account_id, type, action, source, effective_at, reason)
      values (${s}, 'platform_participation', 'grant', 'digital', '2025-01-01', 'standard')
      returning id
    `
    return row!.id as string
  }
  async function anAudit(): Promise<string> {
    const [row] = await h.sql`
      insert into audit_entry (action, subject_type, subject_id, detail)
      values ('test.event', 'account', ${randomUUID()}, '{}'::jsonb)
      returning id
    `
    return row!.id as string
  }

  test('owner UPDATE on consent raises the append-only trigger', async () => {
    const id = await aConsent()
    await expect(
      h.sql`update consent set reason = 'safeguarding' where id = ${id}`,
    ).rejects.toThrow(/append-only/i)
  })

  test('owner DELETE on consent raises the append-only trigger', async () => {
    const id = await aConsent()
    await expect(h.sql`delete from consent where id = ${id}`).rejects.toThrow(/append-only/i)
  })

  test('owner UPDATE on audit_entry raises the append-only trigger', async () => {
    const id = await anAudit()
    await expect(
      h.sql`update audit_entry set action = 'tampered' where id = ${id}`,
    ).rejects.toThrow(/append-only/i)
  })

  test('owner DELETE on audit_entry raises the append-only trigger', async () => {
    const id = await anAudit()
    await expect(h.sql`delete from audit_entry where id = ${id}`).rejects.toThrow(/append-only/i)
  })

  test('the app role is denied UPDATE and DELETE at the grant level', async () => {
    const id = await aConsent()
    const app = h.connectAs('curiolab_app', 'app_pw')
    await expect(
      app`update consent set reason = 'safeguarding' where id = ${id}`,
    ).rejects.toThrow(/permission denied/i)
    await expect(app`delete from consent where id = ${id}`).rejects.toThrow(/permission denied/i)
    const auditId = await anAudit()
    await expect(
      app`update audit_entry set action = 'tampered' where id = ${auditId}`,
    ).rejects.toThrow(/permission denied/i)
    await expect(app`delete from audit_entry where id = ${auditId}`).rejects.toThrow(
      /permission denied/i,
    )
  })
})

// ---------------------------------------------------------------------------
describe('consent_current maintenance and ordering', () => {
  async function insertConsent(
    student: string,
    action: 'grant' | 'revoke',
    effectiveAt: string,
  ): Promise<void> {
    await h.sql`
      insert into consent (student_account_id, type, action, source, effective_at, reason)
      values (${student}, 'platform_participation', ${action}, 'digital', ${effectiveAt}, 'standard')
    `
  }
  async function currentActive(student: string): Promise<boolean> {
    const [row] = await h.sql`
      select active from consent_current
      where student_account_id = ${student} and type = 'platform_participation'
    `
    return row!.active as boolean
  }

  test('a grant makes consent_current active', async () => {
    const s = await makeMinor(h.sql)
    await insertConsent(s, 'grant', '2025-09-01')
    expect(await currentActive(s)).toBe(true)
  })

  test('ordering 1: form dated Sep 1 uploaded after an Oct 5 revocation stays inactive', async () => {
    const s = await makeMinor(h.sql)
    // Filing order: the revocation is filed first, the older-dated grant later.
    await insertConsent(s, 'revoke', '2025-10-05')
    await insertConsent(s, 'grant', '2025-09-01')
    expect(await currentActive(s)).toBe(false)
  })

  test('ordering 2: a new form dated Oct 12 after an Oct 5 revocation becomes active', async () => {
    const s = await makeMinor(h.sql)
    await insertConsent(s, 'revoke', '2025-10-05')
    await insertConsent(s, 'grant', '2025-10-12')
    expect(await currentActive(s)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('Impersonation of a minor is read-only', () => {
  async function admin(): Promise<string> {
    return makeAdult(h.sql)
  }

  test('a full session impersonating a minor is rejected', async () => {
    const actor = await admin()
    const minor = await makeMinor(h.sql)
    await expect(h.sql`
      insert into session (token_hash, account_id, mode, impersonated_account_id, real_actor_account_id, expires_at)
      values (${randomUUID()}, ${actor}, 'full', ${minor}, ${actor}, now() + interval '30 minutes')
    `).rejects.toThrow(/read.?only|minor/i)
  })

  test('a read_only session impersonating a minor is accepted (control)', async () => {
    const actor = await admin()
    const minor = await makeMinor(h.sql)
    const rows = await h.sql`
      insert into session (token_hash, account_id, mode, impersonated_account_id, real_actor_account_id, expires_at)
      values (${randomUUID()}, ${actor}, 'read_only', ${minor}, ${actor}, now() + interval '30 minutes')
      returning id
    `
    expect(rows.length).toBe(1)
  })

  test('a full session impersonating an adult is accepted (control)', async () => {
    const actor = await admin()
    const adult = await makeAdult(h.sql)
    const rows = await h.sql`
      insert into session (token_hash, account_id, mode, impersonated_account_id, real_actor_account_id, expires_at)
      values (${randomUUID()}, ${actor}, 'full', ${adult}, ${actor}, now() + interval '30 minutes')
      returning id
    `
    expect(rows.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('Alumni membership shape', () => {
  test('alumni membership with a pod_id is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const pod = await makePod(h.sql, chapter, term)
    const account = await makeAdult(h.sql)
    await expect(
      makeMembership(h.sql, account, chapter, { role: 'alumni', status: 'active', podId: pod }),
    ).rejects.toThrow(/pod/i)
  })

  test('alumni membership with a current_tier is rejected', async () => {
    const chapter = await makeChapter(h.sql)
    const account = await makeAdult(h.sql)
    await expect(
      makeMembership(h.sql, account, chapter, {
        role: 'alumni',
        status: 'active',
        currentTier: 'builder',
      }),
    ).rejects.toThrow(/tier/i)
  })

  test('alumni membership with null pod and tier is accepted (control)', async () => {
    const chapter = await makeChapter(h.sql)
    const account = await makeAdult(h.sql)
    const id = await makeMembership(h.sql, account, chapter, { role: 'alumni', status: 'active' })
    expect(id).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('Guardian invite must equal the enrollment email', () => {
  async function setup(guardianEmail: string): Promise<{ enrollment: string; issuer: string }> {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    const issuer = await makeAdult(h.sql)
    const application = await makeApplication(h.sql, chapter, guardianEmail)
    const enrollment = await makeEnrollment(h.sql, {
      applicationId: application,
      chapterId: chapter,
      termId: term,
      createdBy: issuer,
    })
    return { enrollment, issuer }
  }

  test('a guardian invite to a different email is rejected', async () => {
    const { enrollment, issuer } = await setup('parent@example.test')
    await expect(h.sql`
      insert into invite (token_hash, kind, target_email, enrollment_record_id, issued_by, expires_at, status, delivery_status)
      values (${randomUUID()}, 'guardian', 'someone-else@example.test', ${enrollment}, ${issuer}, now() + interval '14 days', 'issued', 'sent')
    `).rejects.toThrow(/enrollment|guardian|email/i)
  })

  test('a guardian invite matching the enrollment email is accepted (control)', async () => {
    const { enrollment, issuer } = await setup('parent@example.test')
    const rows = await h.sql`
      insert into invite (token_hash, kind, target_email, enrollment_record_id, issued_by, expires_at, status, delivery_status)
      values (${randomUUID()}, 'guardian', 'parent@example.test', ${enrollment}, ${issuer}, now() + interval '14 days', 'issued', 'sent')
      returning id
    `
    expect(rows.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
describe('Mechanism A: restricted analytics role', () => {
  test('the analytics role is denied SELECT on enrollment_record and guardianship', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    await expect(analytics`select 1 from enrollment_record limit 1`).rejects.toThrow(
      /permission denied/i,
    )
    await expect(analytics`select 1 from guardianship limit 1`).rejects.toThrow(
      /permission denied/i,
    )
  })

  test('the analytics role may still read a non-sensitive table (control)', async () => {
    const analytics = h.connectAs('curiolab_analytics', 'analytics_pw')
    const rows = await analytics`select 1 as ok from chapter limit 1`
    expect(Array.isArray(rows)).toBe(true)
  })

  test('the app role may read enrollment_record (control)', async () => {
    const app = h.connectAs('curiolab_app', 'app_pw')
    const rows = await app`select 1 from enrollment_record limit 1`
    expect(Array.isArray(rows)).toBe(true)
  })
})
