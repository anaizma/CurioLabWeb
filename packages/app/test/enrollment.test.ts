// -------------------------------------------------------------------------
// EnrollmentService tests (Milestone 1 step 2, coupling D). Embedded Postgres,
// synthetic data only. Coupling D is: the signed-form upload, the enrollment
// record, and the two form-sourced consent rows (enrollment, data_collection)
// commit in ONE transaction — an operational record never exists before its
// consent row (04-state-machines "D").
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

// An accepted application with an EXPLICIT past submission date, plus the term,
// director account, and student account needed to enroll. The past submission
// lets a signature date sit legitimately between submission and the (now())
// enrollment upload — the case the ruled temporal change fixes.
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

function inputFor(
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

describe('coupling D: a successful createEnrollment', () => {
  test('produces exactly the enrollment record plus the two form-sourced consents, and consent_current reflects both active', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    let result!: Awaited<ReturnType<EnrollmentService['createEnrollment']>>
    await withRequest(async () => {
      result = await svc.createEnrollment(inputFor(f), ctx)
    })

    // The signed form is stored and the ref threads through the DB rows.
    expect(storage.size).toBe(1)
    expect(storage.has(result.signedFormRef)).toBe(true)

    // Exactly one enrollment record, linked to the accepted application.
    const enr = await h.sql`select * from enrollment_record where id = ${result.enrollmentRecordId}`
    expect(enr).toHaveLength(1)
    expect(enr[0]!.application_id).toBe(f.applicationId)
    expect(enr[0]!.signed_form_ref).toBe(result.signedFormRef)
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

    // consent_current reflects enrollment and data_collection active.
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

  test('accepts a signature date before the upload (signature precedes the enrollment record creation) — the ruled fix', async () => {
    const f = await acceptedApplication('2026-06-01T00:00:00Z')
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage: new InMemoryStorageAdapter() })

    let result!: Awaited<ReturnType<EnrollmentService['createEnrollment']>>
    await withRequest(async () => {
      result = await svc.createEnrollment(
        inputFor(f, { signatureDate: new Date('2026-06-15T00:00:00Z') }),
        ctx,
      )
    })

    const [enr] = await h.sql`select created_at from enrollment_record where id = ${result.enrollmentRecordId}`
    const [c] = await h.sql`
      select effective_at from consent where enrollment_record_id = ${result.enrollmentRecordId} limit 1
    `
    // The signature (effective_at) legitimately PRECEDES the record's creation.
    expect(new Date(c!.effective_at as string).getTime()).toBeLessThan(
      new Date(enr!.created_at as string).getTime(),
    )
  })
})

describe('coupling D is atomic: an injected failure at each step persists nothing', () => {
  test('step 1 (storage upload) fails: no enrollment record, no consent rows', async () => {
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
        await svc.createEnrollment(inputFor(f), ctx)
      } catch (e) {
        caught = e
      }
    })

    expect((caught as Error).message).toMatch(/storage upload boom/)
    expect(await enrollmentCount(f.applicationId)).toBe(0)
    expect(await consentCount(f.student)).toBe(0)
  })

  test('step 2 (enrollment insert) fails: storage upload is compensated and no rows persist', async () => {
    const f = await acceptedApplication()
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    // A non-existent application id: the enrollment_record FK insert (step 2)
    // fails AFTER the storage upload (step 1). The orphaned object must be
    // compensated so nothing dangles.
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(inputFor(f, { applicationId: randomUUID() }), ctx)
      } catch (e) {
        caught = e
      }
    })

    expect(caught).toBeInstanceOf(Error)
    expect(storage.size).toBe(0) // compensated
    expect(await enrollmentCount(f.applicationId)).toBe(0)
    expect(await consentCount(f.student)).toBe(0)
  })

  test('step 3 (consent insert) fails: enrollment record rolls back and storage is compensated', async () => {
    // Signature BEFORE the application submission: step 2 (enrollment) inserts,
    // then step 3 (consent) is rejected by the temporal trigger, aborting the
    // whole transaction.
    const f = await acceptedApplication('2026-06-01T00:00:00Z')
    const ctx = baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
    const storage = new InMemoryStorageAdapter()
    const svc = new EnrollmentService({ sql: h.sql, authorize, storage })

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc.createEnrollment(
          inputFor(f, { signatureDate: new Date('2026-05-01T00:00:00Z') }),
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
          inputFor(f, { signatureDate: new Date('2099-01-01T00:00:00Z') }),
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
        await svc.createEnrollment(inputFor(f), stranger)
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

    // Nothing was stored and nothing persisted (denial precedes the transaction).
    expect(storage.size).toBe(0)
    expect(await enrollmentCount(f.applicationId)).toBe(0)
    expect(await consentCount(f.student)).toBe(0)
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
        await svc.createEnrollment(inputFor(f), director)
      } catch (e) {
        caught = e
      }
    })

    expect((caught as Error).message).toMatch(/no authorization decision recorded/)
    expect(storage.size).toBe(0)
    expect(await enrollmentCount(f.applicationId)).toBe(0)
    expect(await consentCount(f.student)).toBe(0)
  })
})
