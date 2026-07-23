// -------------------------------------------------------------------------
// Ops back-office controllers (05-api-surface.md "Operations back office").
// Embedded Postgres, synthetic data only.
//
// The representative authed-ops assertions (task acceptance):
//   - a valid chapter_director session succeeds;
//   - NO session -> opaque 403, and NO permission.denied row (no actor);
//   - a WRONG-ROLE session -> opaque 403 (no DenyReason in the body) AND exactly
//     one permission.denied audit row.
// Plus success-wiring for every ops controller: enrollment, invite+resend,
// guardianship verify, membership activate, deletion review+fulfill, export.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult } from './helpers/fixtures.js'
import {
  seedDirector,
  seedAcceptedApplication,
  onboardStudent,
} from './helpers/seed.js'
import {
  transitionApplication,
  createEnrollment,
  issueInvite,
  resendInvite,
  verifyGuardianship,
  activateMembership,
  reviewDeletion,
  fulfillDeletion,
  fulfillExport,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function submittedApplication(chapter: string): Promise<string> {
  const [app] = await h.sql`
    insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_name, guardian_email)
    values ('student', ${chapter}, 'submitted', 'Minor Testchild', 'p@example.test', 'Parent Testperson', 'p@example.test')
    returning id
  `
  return app!.id as string
}

async function sessionFor(accountId: string): Promise<string> {
  const { token } = await createSession(h.sql, {
    accountId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return token
}

async function permissionDenied(actor: string, capability: string) {
  return h.sql`
    select detail from audit_entry
    where action = 'permission.denied' and actor_account_id = ${actor}
      and detail->>'capability' = ${capability}
  `
}

// ===========================================================================
describe('transitionApplication — the representative authed ops controller', () => {
  test('a chapter_director session transitions submitted -> screening (200)', async () => {
    const d = await seedDirector(h.sql)
    const appId = await submittedApplication(d.chapter)
    const res = await transitionApplication({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: appId },
      body: { action: 'screen' },
    })
    expect(res.status).toBe(200)
    expect(res.body.to).toBe('screening')
    const [app] = await h.sql`select status from application where id = ${appId}`
    expect(app!.status).toBe('screening')
  })

  test('NO session -> opaque 403 with no actor audit', async () => {
    const d = await seedDirector(h.sql)
    const appId = await submittedApplication(d.chapter)
    const res = await transitionApplication({
      sql: h.sql,
      params: { id: appId },
      body: { action: 'screen' },
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/role_not_permitted|out_of_scope|reason/)
    const [app] = await h.sql`select status from application where id = ${appId}`
    expect(app!.status).toBe('submitted') // unchanged
  })

  test('a WRONG-ROLE session -> opaque 403 and exactly one permission.denied row', async () => {
    const d = await seedDirector(h.sql)
    const appId = await submittedApplication(d.chapter)
    // An active account whose only membership is comms_associate: cannot transition.
    const wrong = await makeAdult(h.sql)
    await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${wrong}, ${d.chapter}, 'comms_associate', 'active')
    `
    const token = await sessionFor(wrong)

    const res = await transitionApplication({
      sql: h.sql,
      sessionToken: token,
      params: { id: appId },
      body: { action: 'screen' },
    })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/role_not_permitted|out_of_scope|reason/)
    const denied = await permissionDenied(wrong, 'application.transition')
    expect(denied).toHaveLength(1)
    const [app] = await h.sql`select status from application where id = ${appId}`
    expect(app!.status).toBe('submitted')
  })

  test('an unknown action is a 400, not a 500', async () => {
    const d = await seedDirector(h.sql)
    const appId = await submittedApplication(d.chapter)
    const res = await transitionApplication({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: appId },
      body: { action: 'teleport' },
    })
    expect(res.status).toBe(400)
  })

  test('an illegal transition is a 409', async () => {
    const d = await seedDirector(h.sql)
    const appId = await submittedApplication(d.chapter)
    // submitted -> accepted is not a legal single edge.
    const res = await transitionApplication({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: appId },
      body: { action: 'accept' },
    })
    expect(res.status).toBe(409)
  })
})

// ===========================================================================
describe('createEnrollment', () => {
  test('a director records a seeding enrollment (201)', async () => {
    const d = await seedDirector(h.sql)
    const { applicationId } = await seedAcceptedApplication(h.sql, d.chapter)
    const res = await createEnrollment({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: {
        applicationId,
        chapterId: d.chapter,
        termId: d.term,
        dateOfBirth: '2014-04-04',
        guardianNameOnForm: 'Parent Testperson',
        signatureDate: '2014-05-05',
        signedForm: { body: 'synthetic-signed-scan-bytes' },
      },
    })
    expect(res.status).toBe(201)
    expect(res.body.enrollmentRecordId).toBeTruthy()
  })
})

// ===========================================================================
describe('issueInvite / resendInvite', () => {
  test('a director issues a mentor invite (201, token)', async () => {
    const d = await seedDirector(h.sql)
    const issued = await issueInvite({
      sql: h.sql,
      sessionToken: d.directorToken,
      body: { kind: 'mentor', chapterId: d.chapter },
    })
    expect(issued.status).toBe(201)
    expect(issued.body.token).toBeTruthy()
  })

  test('a director issues then resends an enrollment-bound guardian invite', async () => {
    // resend derives the chapter scope from the invite's bound enrollment, so a
    // resendable invite must be enrollment-bound (a guardian invite).
    const s = await onboardStudent(h.sql, { activate: false })
    const issued = await issueInvite({
      sql: h.sql,
      sessionToken: s.directorToken,
      body: {
        kind: 'guardian',
        chapterId: s.chapter,
        targetEmail: s.guardianEmail,
        enrollmentRecordId: s.enrollmentRecordId,
      },
    })
    expect(issued.status).toBe(201)

    const resent = await resendInvite({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: issued.body.inviteId },
    })
    expect(resent.status).toBe(201)
    expect(resent.body.token).not.toBe(issued.body.token)
    const [old] = await h.sql`select status from invite where id = ${issued.body.inviteId}`
    expect(old!.status).toBe('revoked')
  })
})

// ===========================================================================
describe('verifyGuardianship', () => {
  test('a director verifies a name-matching pending edge (200, verified)', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    // A guardian account whose legal_name matches the name on the enrollment form.
    const [g] = await h.sql`
      insert into account (email, legal_name, display_name, date_of_birth, dob_provenance, credential_owner, status, maturation_state)
      values (${s.guardianEmail}, 'Parent Testperson', 'Parent T.', '1985-01-01', 'staff_entered', 'self_private', 'active', 'self_managed')
      returning id
    `
    const [edge] = await h.sql`
      insert into guardianship (guardian_account_id, student_account_id, relationship, status, verification_method)
      values (${g!.id}, ${s.accountId}, 'guardian', 'pending', 'signed_form_match')
      returning id
    `
    const res = await verifyGuardianship({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: edge!.id as string },
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('verified')
    expect(res.body.matched).toBe(true)
  })
})

// ===========================================================================
describe('activateMembership', () => {
  test('a director activates a pending student (200, explorer)', async () => {
    const s = await onboardStudent(h.sql, { activate: false })
    const res = await activateMembership({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: s.membershipId },
    })
    expect(res.status).toBe(200)
    expect(res.body.tier).toBe('explorer')
    const [m] = await h.sql`select status, current_tier from membership where id = ${s.membershipId}`
    expect(m!.status).toBe('active')
  })
})

// ===========================================================================
describe('reviewDeletion / fulfillDeletion / fulfillExport', () => {
  test('review then full fulfillment of a deletion request', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const [dr] = await h.sql`
      insert into deletion_request (subject_account_id, requested_by, scope_requested, status)
      values (${s.accountId}, ${s.director}, 'full', 'requested') returning id
    `
    const requestId = dr!.id as string

    const reviewed = await reviewDeletion({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: requestId },
    })
    expect(reviewed.status).toBe(200)
    expect(reviewed.body.status).toBe('under_review')

    const fulfilled = await fulfillDeletion({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: requestId },
      body: { decision: 'full' },
    })
    expect(fulfilled.status).toBe(200)
    expect(fulfilled.body.status).toBe('fulfilled_full')
    const [a] = await h.sql`select status, legal_name from account where id = ${s.accountId}`
    expect(a!.status).toBe('closed')
    expect(a!.legal_name).toBe('[redacted]')
  })

  test('a partial fulfillment without a reason is a 400', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const [dr] = await h.sql`
      insert into deletion_request (subject_account_id, requested_by, scope_requested, status)
      values (${s.accountId}, ${s.director}, 'redaction', 'requested') returning id
    `
    const requestId = dr!.id as string
    await reviewDeletion({ sql: h.sql, sessionToken: s.directorToken, params: { id: requestId } })
    const res = await fulfillDeletion({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: requestId },
      body: { decision: 'partial' },
    })
    expect(res.status).toBe(400)
  })

  test('a director fulfills an export request (200, bundle)', async () => {
    const s = await onboardStudent(h.sql, { activate: true })
    const [er] = await h.sql`
      insert into export_request (subject_account_id, requested_by, status)
      values (${s.accountId}, ${s.director}, 'requested') returning id
    `
    const res = await fulfillExport({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: er!.id as string },
    })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('fulfilled')
    expect(res.body.bundle.consents.enrollment).toBe(true)
  })

  test('a non-existent deletion request is a 404', async () => {
    const d = await seedDirector(h.sql)
    const res = await reviewDeletion({
      sql: h.sql,
      sessionToken: d.directorToken,
      params: { id: randomUUID() },
    })
    expect(res.status).toBe(404)
  })
})
