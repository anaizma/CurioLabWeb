// -------------------------------------------------------------------------
// Invite onboarding-entry controllers (05-api-surface.md "single-code-path
// invariant" — the unauthenticated, actor-less, INERT set; 06-onboarding-flows
// Flows A/B). Embedded Postgres, synthetic data only.
//
//   GET  /api/invites/:token            validate (kind + chapter ONLY, no name;
//                                        identical result for invalid/expired/accepted)
//   POST /api/invites/:token/accept          email path  -> pending account (+ pending edge)
//   POST /api/invites/:token/accept-student  username path -> pending student account
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { authorize, hashToken, withRequest } from '@curiolab/runtime'
import { EnrollmentService, InMemoryStorageAdapter, InviteService } from '@curiolab/app'
import { startHarness, type Harness } from './helpers/pg.js'
import {
  seedDirector,
  seedAcceptedApplication,
  directorCtx,
  onboardStudent,
} from './helpers/seed.js'
import { validateInviteToken, acceptInvite, acceptStudent } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/** A fresh SEEDING enrollment (form_signed_at set, no student account yet). */
async function seedingEnrollment() {
  const base = await seedDirector(h.sql)
  const { applicationId, guardianEmail } = await seedAcceptedApplication(h.sql, base.chapter)
  const ctx = directorCtx(base.director, base.chapter)
  let enrollmentRecordId!: string
  await withRequest(async () => {
    const r = await new EnrollmentService({
      sql: h.sql,
      authorize,
      storage: new InMemoryStorageAdapter(),
    }).createEnrollment(
      {
        applicationId,
        chapterId: base.chapter,
        termId: base.term,
        dateOfBirth: '2014-04-04',
        guardianNameOnForm: 'Parent Testperson',
        signatureDate: new Date('2014-05-05T00:00:00Z'),
        signedForm: { body: 'synthetic-signed-scan-bytes', contentType: 'application/pdf' },
      },
      ctx,
    )
    enrollmentRecordId = r.enrollmentRecordId
  })
  return { ...base, applicationId, guardianEmail, enrollmentRecordId, ctx }
}

/** Issue a student invite over a seeding enrollment; return the opaque token. */
async function issueStudentInvite(chapter: string, enrollmentRecordId: string, ctx: ReturnType<typeof directorCtx>) {
  let token!: string
  await withRequest(async () => {
    token = (
      await new InviteService({ sql: h.sql, authorize }).issueInvite(
        { kind: 'student', chapterId: chapter, enrollmentRecordId },
        ctx,
      )
    ).token
  })
  return token
}

describe('validateInviteToken (GET /api/invites/:token)', () => {
  test('a usable invite returns kind + chapter ONLY — never a name', async () => {
    const s = await seedingEnrollment()
    const token = await issueStudentInvite(s.chapter, s.enrollmentRecordId, s.ctx)

    const res = await validateInviteToken({ sql: h.sql, params: { token } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ usable: true, kind: 'student', chapter: s.chapter })
    // No child name / applicant field leaks in the body.
    expect(Object.keys(res.body).sort()).toEqual(['chapter', 'kind', 'usable'])
    expect(JSON.stringify(res.body)).not.toMatch(/name|child|Testchild|Testperson/i)
  })

  test('invalid, expired, and accepted tokens are byte-identical NOT_USABLE', async () => {
    // invalid
    const invalid = await validateInviteToken({ sql: h.sql, params: { token: randomUUID() } })

    // expired: insert an issued invite whose expires_at is already past
    const s = await seedingEnrollment()
    const expiredToken = randomUUID()
    await h.sql`
      insert into invite (token_hash, kind, enrollment_record_id, issued_by, expires_at, status, delivery_status)
      values (${hashToken(expiredToken)}, 'student', ${s.enrollmentRecordId}, ${s.director},
              now() - interval '1 day', 'issued', 'sent')
    `
    const expired = await validateInviteToken({ sql: h.sql, params: { token: expiredToken } })

    // accepted: issue then accept a student invite
    const acceptToken = await issueStudentInvite(s.chapter, s.enrollmentRecordId, s.ctx)
    await acceptStudent({
      sql: h.sql,
      params: { token: acceptToken },
      body: {
        username: `curio-${randomUUID().slice(0, 8)}`,
        password: 'correct horse battery staple',
        legalName: 'Minor Testchild',
        displayName: 'Minor T.',
      },
    })
    const accepted = await validateInviteToken({ sql: h.sql, params: { token: acceptToken } })

    const NOT_USABLE = { usable: false, kind: null, chapter: null }
    expect(invalid.body).toEqual(NOT_USABLE)
    expect(expired.body).toEqual(NOT_USABLE)
    expect(accepted.body).toEqual(NOT_USABLE)
    // Byte-identical serialization across all three.
    expect(JSON.stringify(expired.body)).toBe(JSON.stringify(invalid.body))
    expect(JSON.stringify(accepted.body)).toBe(JSON.stringify(invalid.body))
  })
})

describe('acceptStudent (POST /api/invites/:token/accept-student)', () => {
  test('creates a PENDING, username-identified minor account, no authority', async () => {
    const s = await seedingEnrollment()
    const token = await issueStudentInvite(s.chapter, s.enrollmentRecordId, s.ctx)
    const username = `curio-${randomUUID().slice(0, 8)}`

    const res = await acceptStudent({
      sql: h.sql,
      params: { token },
      body: {
        username,
        password: 'correct horse battery staple',
        legalName: 'Minor Testchild',
        displayName: 'Minor T.',
      },
    })
    expect(res.status).toBe(201)
    expect(res.body.accountId).toBeTruthy()
    expect(res.body.guardianshipId).toBeNull()

    const [acct] = await h.sql`
      select status, maturation_state, email, username from account where id = ${res.body.accountId}
    `
    expect(acct!.status).toBe('pending')
    expect(acct!.maturation_state).toBe('minor')
    expect(acct!.email).toBeNull()
    expect(acct!.username).toBe(username)
    // No active membership yet (authority attaches only at staff activation).
    const mems = await h.sql`select 1 from membership where account_id = ${res.body.accountId} and status = 'active'`
    expect(mems).toHaveLength(0)
  })

  test('a wrong (email) credential shape for a student invite is a 400', async () => {
    const s = await seedingEnrollment()
    const token = await issueStudentInvite(s.chapter, s.enrollmentRecordId, s.ctx)
    const res = await acceptInvite({
      sql: h.sql,
      params: { token },
      body: {
        email: 'someone@example.test',
        password: 'correct horse battery staple',
        legalName: 'X',
        displayName: 'X',
        dateOfBirth: '2000-01-01',
      },
    })
    expect(res.status).toBe(400)
  })
})

describe('acceptInvite (POST /api/invites/:token/accept — email path)', () => {
  test('a guardian accept creates a PENDING account and a PENDING edge', async () => {
    const s = await onboardStudent(h.sql, { activate: false })
    // Issue a guardian invite bound to the enrollment + the exact guardian email.
    let token!: string
    await withRequest(async () => {
      token = (
        await new InviteService({ sql: h.sql, authorize }).issueInvite(
          {
            kind: 'guardian',
            chapterId: s.chapter,
            targetEmail: s.guardianEmail,
            enrollmentRecordId: s.enrollmentRecordId,
          },
          directorCtx(s.director, s.chapter),
        )
      ).token
    })

    const res = await acceptInvite({
      sql: h.sql,
      params: { token },
      body: {
        email: s.guardianEmail,
        password: 'correct horse battery staple',
        legalName: 'Parent Testperson',
        displayName: 'Parent T.',
        dateOfBirth: '1985-01-01',
      },
    })
    expect(res.status).toBe(201)
    expect(res.body.accountId).toBeTruthy()
    expect(res.body.guardianshipId).toBeTruthy()

    const [acct] = await h.sql`select status from account where id = ${res.body.accountId}`
    expect(acct!.status).toBe('pending')
    const [edge] = await h.sql`select status from guardianship where id = ${res.body.guardianshipId}`
    expect(edge!.status).toBe('pending')
  })

  test('an invalid token is an opaque 401', async () => {
    const res = await acceptInvite({
      sql: h.sql,
      params: { token: randomUUID() },
      body: {
        email: 'x@example.test',
        password: 'correct horse battery staple',
        legalName: 'X',
        displayName: 'X',
        dateOfBirth: '1990-01-01',
      },
    })
    expect(res.status).toBe(401)
  })
})
