// -------------------------------------------------------------------------
// EnrollmentService tests (Milestone 1 step 2, coupling D) under the ruled
// DOB-provenance rework. Embedded Postgres, synthetic data only.
//
// Two cases (02-data-model.md "enrollment_record"; decision-log.md "DOB on the
// enrollment record, reversed and refined"):
//
//   SEEDING (primary) — a brand-new student, no account yet. The enrollment is
//     written with student_account_id = null and date_of_birth = the DOB from
//     the signed form. The form-sourced consent rows key on a student account
//     (consent.student_account_id is NOT NULL) which does not exist yet, so they
//     are NOT written here; they follow once the account exists (accept-student
//     copies the DOB, then activation captures consents — the next step). The
//     signed form + enrollment record still commit atomically.
//
//   RETURNING (secondary) — a student who already has an account (a later-term
//     enrollment). student_account_id is set, date_of_birth stays null (no second
//     copy to drift), and coupling D's two form-sourced consents commit in the
//     same transaction exactly as before.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  EnrollmentService,
  InMemoryStorageAdapter,
  type CreateEnrollmentInput,
  type EnrollmentAuthorizeFn,
  type StorageAdapter,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// An accepted application with an EXPLICIT past submission date, plus the term
// and director account needed to enroll. A student account is also created for
// the RETURNING case; the SEEDING case ignores it. The past submission lets a
// signature date sit legitimately between submission and the (now()) enrollment
// upload — the case the ruled temporal change fixes.
async function acceptedApplication(submittedAt = '2026-06-01T00:00:00Z') {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)
  const student = await makeMinor(h.sql)
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild',
      'parent@example.test', 'Parent Testperson', 'parent@example.test', ${submittedAt}
    ) returning id
  `
  return {
    chapter,
    term: term!.id as string,
    director,
    student,
    applicationId: app!.id as string,
  }
}

/** SEEDING input: no student account yet; the form's DOB is required. */
function seedingInput(
  f: Awaited<ReturnType<typeof acceptedApplication>>,
  overrides: Partial<CreateEnrollmentInput> = {},
): CreateEnrollmentInput {
  return {
    applicationId: f.applicationId,
    chapterId: f.chapter,
    termId: f.term,
    dateOfBirth: '2015-06-01',
    guardianNameOnForm: 'Parent Testperson',
    signatureDate: new Date('2026-06-15T00:00:00Z'),
    signedForm: { body: 'synthetic-signed-scan-bytes', contentType: 'application/pdf' },
    ...overrides,
  }
}

/** RETURNING input: an existing student account; no DOB copy on the enrollment. */
function returningInput(
  f: Awaited<ReturnType<typeof acceptedApplication>>,
  overrides: Partial<CreateEnrollmentInput> = {},
): CreateEnrollmentInput {
  return {
    applicationId: f.applicationId,
    studentAccountId: f.student,
    chapterId: f.chapter,
    termId: f.term,
    guardianNameOnForm: 'Parent Testperson',
    signatureDate: new Date('2026-06-15T00:00:00Z'),
    signedForm: { body: 'synthetic-signed-scan-bytes', contentType: 'application/pdf' },
    ...overrides,
  }
}

async function enrollmentCount(applicationId: string): Promise<number> {
  const [row] = await h.sql`
    select count(*)::int as n from enrollment_record where application_id = ${applicationId}
  `
  return row!.n as number
}
async function consentCount(studentId: string): Promise<number> {
  const [row] = await h.sql`
    select count(*)::int as n from consent where student_account_id = ${studentId}
  `
  return row!.n as number
}

// ===========================================================================
describe('SEEDING createEnrollment (primary): brand-new student, no account yet', () => {
  test('writes the enrollment record with student_account_id null and the form DOB, storing the signed form; no consents (no account to anchor them)', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    let result!: Awaited<ReturnType<EnrollmentService['createEnrollment']>>
    await withRequest(async () => {
      result = await svc.createEnrollment(seedingInput(f), ctx)
    })

    // The signed form is stored and the ref threads through the record.
    expect(storage.size).toBe(1)
    expect(storage.has(result.signedFormRef)).toBe(true)

    // Exactly one enrollment record: no account yet, DOB carried on the record.
    const [enr] = await h.sql`
      select *, date_of_birth::text as dob_text from enrollment_record where id = ${result.enrollmentRecordId}
    `
    expect(enr!.application_id).toBe(f.applicationId)
    expect(enr!.signed_form_ref).toBe(result.signedFormRef)
    expect(enr!.student_account_id).toBeNull()
    expect(enr!.dob_text).toBe('2015-06-01')
    expect(await enrollmentCount(f.applicationId)).toBe(1)

    // No form-sourced consents at seeding time (no student account to key on).
    expect(Object.keys(result.consentIds)).toEqual([])
  })

  test('requires the form DOB: a seeding enrollment with no dateOfBirth throws and nothing persists', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(seedingInput(f, { dateOfBirth: undefined }), ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/date of birth|dob/i)
    expect(storage.size).toBe(0)
    expect(await enrollmentCount(f.applicationId)).toBe(0)
  })

  test('is atomic: a storage upload failure persists no enrollment record', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const throwingStorage: StorageAdapter = {
      putObject: async () => {
        throw new Error('storage upload boom')
      },
      getSignedUrl: async () => {
        throw new Error('unused')
      },
    }
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage: throwingStorage })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(seedingInput(f), ctx)
      } catch (e) {
        caught = e
      }
    })

    expect((caught as Error).message).toMatch(/storage upload boom/)
    expect(await enrollmentCount(f.applicationId)).toBe(0)
  })

  test('is atomic: an enrollment insert failure compensates the storage upload', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    // A non-existent application id: the enrollment_record FK insert fails AFTER
    // the storage upload; the orphaned object must be compensated.
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(seedingInput(f, { applicationId: randomUUID() }), ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect(storage.size).toBe(0) // compensated
    expect(await enrollmentCount(f.applicationId)).toBe(0)
  })
})

// ===========================================================================
describe('RETURNING createEnrollment (secondary): existing account, coupling D consents', () => {
  test('produces the enrollment record (DOB null) plus the two form-sourced consents, and consent_current reflects both active', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    let result!: Awaited<ReturnType<EnrollmentService['createEnrollment']>>
    await withRequest(async () => {
      result = await svc.createEnrollment(returningInput(f), ctx)
    })

    expect(storage.size).toBe(1)
    expect(storage.has(result.signedFormRef)).toBe(true)

    // The enrollment record: account present, no second DOB copy.
    const [enr] = await h.sql`select * from enrollment_record where id = ${result.enrollmentRecordId}`
    expect(enr!.student_account_id).toBe(f.student)
    expect(enr!.date_of_birth).toBeNull()
    expect(await enrollmentCount(f.applicationId)).toBe(1)

    // Exactly the two form-sourced consents, correct fields.
    const consents = await h.sql`
      select * from consent where student_account_id = ${f.student} order by type::text
    `
    expect(consents.map((c) => c.type)).toEqual(['data_collection', 'enrollment'])
    for (const c of consents) {
      expect(c.action).toBe('grant')
      expect(c.source).toBe('signed_form')
      expect(c.source_ref).toBe(result.signedFormRef)
      expect(c.enrollment_record_id).toBe(result.enrollmentRecordId)
      expect(c.granted_by).toBeNull() // backfilled later at guardian verification
      expect(new Date(c.effective_at as string).toISOString()).toBe('2026-06-15T00:00:00.000Z')
    }

    const current = await h.sql`
      select type, active from consent_current
      where student_account_id = ${f.student} and type in ('enrollment', 'data_collection')
      order by type::text
    `
    expect(current).toEqual([
      { type: 'data_collection', active: true },
      { type: 'enrollment', active: true },
    ])
  })

  test('accepts a signature date before the upload (the ruled temporal fix)', async () => {
    const f = await acceptedApplication('2026-06-01T00:00:00Z')
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage: new InMemoryStorageAdapter() })

    let result!: Awaited<ReturnType<EnrollmentService['createEnrollment']>>
    await withRequest(async () => {
      result = await svc.createEnrollment(
        returningInput(f, { signatureDate: new Date('2026-06-15T00:00:00Z') }),
        ctx,
      )
    })

    const [enr] = await h.sql`select created_at from enrollment_record where id = ${result.enrollmentRecordId}`
    const [c] = await h.sql`
      select effective_at from consent where enrollment_record_id = ${result.enrollmentRecordId} limit 1
    `
    expect(new Date(c!.effective_at as string).getTime()).toBeLessThan(
      new Date(enr!.created_at as string).getTime(),
    )
  })

  test('is atomic: a consent insert rejected by the temporal trigger rolls back the enrollment and compensates storage', async () => {
    // Signature BEFORE the application submission: the enrollment inserts, then
    // the consent is rejected by the temporal trigger, aborting the transaction.
    const f = await acceptedApplication('2026-06-01T00:00:00Z')
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(
          returningInput(f, { signatureDate: new Date('2026-05-01T00:00:00Z') }),
          ctx,
        )
      } catch (e) {
        caught = e
      }
    })

    expect((caught as Error).message).toMatch(/submission|precede/i)
    expect(storage.size).toBe(0) // compensated
    expect(await enrollmentCount(f.applicationId)).toBe(0)
    expect(await consentCount(f.student)).toBe(0)
  })

  test('a future signature date is rejected by the temporal trigger and nothing persists', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(
          returningInput(f, { signatureDate: new Date('2099-01-01T00:00:00Z') }),
          ctx,
        )
      } catch (e) {
        caught = e
      }
    })

    expect((caught as Error).message).toMatch(/future/i)
    expect(storage.size).toBe(0)
    expect(await enrollmentCount(f.applicationId)).toBe(0)
    expect(await consentCount(f.student)).toBe(0)
  })
})

// ===========================================================================
describe('form_signed_at capture on the enrollment record (coupling D, both cases)', () => {
  test('seeding: the signature date is recorded on the enrollment record', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage: new InMemoryStorageAdapter() })

    let result!: Awaited<ReturnType<EnrollmentService['createEnrollment']>>
    await withRequest(async () => {
      result = await svc.createEnrollment(seedingInput(f), ctx)
    })

    const [enr] = await h.sql`
      select form_signed_at::text as fsa from enrollment_record where id = ${result.enrollmentRecordId}
    `
    expect(enr!.fsa).toBe('2026-06-15')
  })

  test('returning: the signature date is recorded on the enrollment record', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage: new InMemoryStorageAdapter() })

    let result!: Awaited<ReturnType<EnrollmentService['createEnrollment']>>
    await withRequest(async () => {
      result = await svc.createEnrollment(returningInput(f), ctx)
    })

    const [enr] = await h.sql`
      select form_signed_at::text as fsa from enrollment_record where id = ${result.enrollmentRecordId}
    `
    expect(enr!.fsa).toBe('2026-06-15')
  })
})

// ===========================================================================
describe('authorization is enforced through authorize', () => {
  test('a director in another chapter is denied: opaque Forbidden, one permission.denied row, nothing persists', async () => {
    const f = await acceptedApplication()
    const otherChapter = await makeChapter(h.sql)
    const strangerId = await makeAdult(h.sql)
    const stranger = baseCtx(strangerId, new Date(), [mem('chapter_director', otherChapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(seedingInput(f), stranger)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)

    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${strangerId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'enrollment.create', reason: 'out_of_scope' })

    expect(storage.size).toBe(0)
    expect(await enrollmentCount(f.applicationId)).toBe(0)
  })

  test('the runtime backstop holds: an authorize that allows without recording a decision cannot mutate', async () => {
    const f = await acceptedApplication()
    const director = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const allowWithoutRecording: EnrollmentAuthorizeFn = async () => undefined
    const svc = new EnrollmentService({ sql: h.sql, authorize: allowWithoutRecording, storage })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(seedingInput(f), director)
      } catch (e) {
        caught = e
      }
    })

    expect((caught as Error).message).toMatch(/no authorization decision recorded/)
    expect(storage.size).toBe(0)
    expect(await enrollmentCount(f.applicationId)).toBe(0)
  })
})
