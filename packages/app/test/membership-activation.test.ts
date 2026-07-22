// -------------------------------------------------------------------------
// MembershipActivationService tests (Milestone 1 step 6, part C). Flow B step 3:
// the Chapter Director activates a pending student, moving the membership AND its
// account `pending -> active` together (coupling A) and writing the initial
// Explorer tier_transition (coupling F), in one transaction, gated on an active
// `enrollment` consent. Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  EnrollmentService,
  InviteService,
  InMemoryStorageAdapter,
  MembershipActivationService,
  MembershipActivationConsentError,
  type MembershipActivationAuthorizeFn,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}

// The full seeding chain, ending at a PENDING student ready to activate:
//   createEnrollment (seeding, DOB + form_signed_at) -> issue+accept student
//   invite (account created, DOB copied, form-sourced consents created) ->
//   insert the pending student membership.
async function seededPendingStudent() {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  // A director account (a real account: it is the tier_transition granted_by).
  const [dir] = await h.sql`
    insert into account (
      email, legal_name, display_name, date_of_birth, dob_provenance,
      credential_owner, status, maturation_state
    ) values (
      ${`director-${randomUUID().slice(0, 8)}@example.test`}, 'Director Testperson', 'Director T.',
      '1980-01-01', 'staff_entered', 'self_private', 'active', 'self_managed'
    ) returning id
  `
  const director = dir!.id as string
  const guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild',
      ${guardianEmail}, 'Parent Testperson', ${guardianEmail}, '2013-01-01T00:00:00Z'
    ) returning id
  `
  const ctx = directorCtx(director, chapter)

  // Coupling D (seeding): enrollment record with the form DOB + signature date.
  const enroll = new EnrollmentService({ sql: h.sql, authorize, storage: new InMemoryStorageAdapter() })
  let enrollmentRecordId!: string
  await withRequest(async () => {
    const r = await enroll.createEnrollment(
      {
        applicationId: app!.id as string,
        chapterId: chapter,
        termId: term!.id as string,
        dateOfBirth: '2014-04-04',
        guardianNameOnForm: 'Parent Testperson',
        signatureDate: new Date('2014-05-05T00:00:00Z'),
        signedForm: { body: 'synthetic-signed-scan-bytes', contentType: 'application/pdf' },
      },
      ctx,
    )
    enrollmentRecordId = r.enrollmentRecordId
  })

  // accept-student: the account is created (DOB copied, provenance
  // enrollment_record) and the two form-sourced consents are written.
  const invites = new InviteService({ sql: h.sql, authorize })
  let token!: string
  await withRequest(async () => {
    token = (await invites.issueInvite({ kind: 'student', chapterId: chapter, enrollmentRecordId }, ctx)).token
  })
  const username = `curio-${randomUUID().slice(0, 8)}`
  const { accountId } = await invites.acceptInvite(token, {
    username,
    password: 'correct horse battery staple',
    legalName: 'Minor Testchild',
    displayName: 'Minor T.',
  })

  // The pending student membership (created upstream at enroll; synthesized here).
  const [m] = await h.sql`
    insert into membership (account_id, chapter_id, role, status, term_id)
    values (${accountId}, ${chapter}, 'student', 'pending', ${term!.id}) returning id
  `
  return { chapter, term: term!.id as string, director, accountId, enrollmentRecordId, membershipId: m!.id as string }
}

async function statusesOf(membershipId: string, accountId: string) {
  const [m] = await h.sql`select status, current_tier from membership where id = ${membershipId}`
  const [a] = await h.sql`select status from account where id = ${accountId}`
  return { membership: m!.status as string, currentTier: m!.current_tier as string | null, account: a!.status as string }
}

function svc(authorizeFn = authorize as unknown as MembershipActivationAuthorizeFn) {
  return new MembershipActivationService({ sql: h.sql, authorize: authorizeFn })
}

// ===========================================================================
describe('activateStudent (happy path: the full seeding chain)', () => {
  test('consent_current shows enrollment + data_collection active after accept, then activation flips membership+account active and writes the Explorer tier', async () => {
    const f = await seededPendingStudent()

    // After accept-student, the two form-sourced consents are active (Part B).
    const beforeConsent = await h.sql`
      select type, active from consent_current
      where student_account_id = ${f.accountId} and type in ('enrollment', 'data_collection')
      order by type::text
    `
    expect(beforeConsent).toEqual([
      { type: 'data_collection', active: true },
      { type: 'enrollment', active: true },
    ])

    // Pre-state: everything pending, no tier.
    expect(await statusesOf(f.membershipId, f.accountId)).toEqual({
      membership: 'pending',
      currentTier: null,
      account: 'pending',
    })

    const ctx = directorCtx(f.director, f.chapter)
    await withRequest(async () => {
      await svc().activateStudent(f.membershipId, ctx)
    })

    // Coupling A: membership and account both active. Coupling F: tier synced.
    expect(await statusesOf(f.membershipId, f.accountId)).toEqual({
      membership: 'active',
      currentTier: 'explorer',
      account: 'active',
    })

    // The initial tier_transition: from null, to explorer, evidence = the
    // enrollment record (admission is the entry evidence), granted by the actor.
    const [tt] = await h.sql`select * from tier_transition where membership_id = ${f.membershipId}`
    expect(tt!.from_tier).toBeNull()
    expect(tt!.to_tier).toBe('explorer')
    expect(tt!.granted_by).toBe(f.director)
    expect(tt!.evidence_ref).toBe(f.enrollmentRecordId)
    expect(tt!.evidence_ref).not.toBeNull()
  })
})

// ===========================================================================
describe('activateStudent (guards)', () => {
  test('is rejected when the enrollment consent is not active — nothing flips', async () => {
    // A pending student with a proper account and enrollment record, but NO
    // enrollment consent (never went through accept-student).
    const chapter = await makeChapter(h.sql)
    const [term] = await h.sql`
      insert into term (chapter_id, name, starts_on, ends_on)
      values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
    `
    const director = await makeAdult(h.sql)
    const student = await makeMinor(h.sql, { status: 'pending' })
    const [app] = await h.sql`
      insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_name, guardian_email)
      values ('student', ${chapter}, 'accepted', 'Minor Testchild', 'p@example.test', 'Parent Testperson', 'p@example.test') returning id
    `
    const [enr] = await h.sql`
      insert into enrollment_record (application_id, student_account_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, created_by)
      values (${app!.id}, ${student}, ${chapter}, ${term!.id}, ${randomUUID()}, 'Parent Testperson', ${director}) returning id
    `
    const [m] = await h.sql`
      insert into membership (account_id, chapter_id, role, status, term_id)
      values (${student}, ${chapter}, 'student', 'pending', ${term!.id}) returning id
    `
    void enr

    const ctx = directorCtx(director, chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().activateStudent(m!.id as string, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(MembershipActivationConsentError)
    expect(await statusesOf(m!.id as string, student)).toEqual({
      membership: 'pending',
      currentTier: null,
      account: 'pending',
    })
    const [ttc] = await h.sql`select count(*)::int as n from tier_transition where membership_id = ${m!.id}`
    expect(ttc!.n).toBe(0)
  })

  test('is atomic: a failure at the tier-grant step leaves the membership and account pending', async () => {
    const f = await seededPendingStudent()
    // Inject a failure at the tier grant: the actor account does not exist, so
    // the tier_transition.granted_by FK insert fails AFTER the membership and
    // account have flipped inside the transaction — which must roll back.
    const ghostDirector = randomUUID()
    const ctx = baseCtx(ghostDirector, new Date(), [mem('chapter_director', f.chapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().activateStudent(f.membershipId, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Error)
    expect(await statusesOf(f.membershipId, f.accountId)).toEqual({
      membership: 'pending',
      currentTier: null,
      account: 'pending',
    })
    const [ttc] = await h.sql`select count(*)::int as n from tier_transition where membership_id = ${f.membershipId}`
    expect(ttc!.n).toBe(0)
  })

  test('a non-director is denied through authorize: opaque Forbidden, one permission.denied row, nothing flips', async () => {
    const f = await seededPendingStudent()
    // A director in a DIFFERENT chapter -> out_of_scope for this membership.
    const otherChapter = await makeChapter(h.sql)
    const strangerId = f.director // reuse a real account id as the actor
    const stranger = baseCtx(strangerId, new Date(), [mem('chapter_director', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().activateStudent(f.membershipId, stranger)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)

    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${strangerId}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'member.activate', reason: 'out_of_scope' })

    expect(await statusesOf(f.membershipId, f.accountId)).toEqual({
      membership: 'pending',
      currentTier: null,
      account: 'pending',
    })
  })

  test('the runtime backstop holds: an authorize that allows without recording a decision cannot mutate', async () => {
    const f = await seededPendingStudent()
    const ctx = directorCtx(f.director, f.chapter)
    const allowWithoutRecording: MembershipActivationAuthorizeFn = async () => undefined

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc(allowWithoutRecording).activateStudent(f.membershipId, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect((caught as Error).message).toMatch(/no authorization decision recorded/)
    expect(await statusesOf(f.membershipId, f.accountId)).toEqual({
      membership: 'pending',
      currentTier: null,
      account: 'pending',
    })
  })
})

// ===========================================================================
describe('activateStudent (the decision-4 DOB trigger fires on activation)', () => {
  test('succeeds for a properly-seeded student (provenance enrollment_record, source_ref set)', async () => {
    const f = await seededPendingStudent()
    const ctx = directorCtx(f.director, f.chapter)
    let ok = false
    await withRequest(async () => {
      await svc().activateStudent(f.membershipId, ctx)
      ok = true
    })
    expect(ok).toBe(true)
    const [a] = await h.sql`select dob_provenance, dob_source_ref from account where id = ${f.accountId}`
    expect(a!.dob_provenance).toBe('enrollment_record')
    expect(a!.dob_source_ref).not.toBeNull()
  })

  test('is rejected by the trigger for a student whose account lacks enrollment_record provenance', async () => {
    // A malformed account: self_reported provenance, no source ref. It has an
    // active enrollment consent (so we pass the consent gate) and a pending
    // student membership, so the decision-4 trigger is what stops activation.
    const chapter = await makeChapter(h.sql)
    const [term] = await h.sql`
      insert into term (chapter_id, name, starts_on, ends_on)
      values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
    `
    const director = await makeAdult(h.sql)
    const bad = await makeMinor(h.sql, { dobProvenance: 'self_reported', dobSourceRef: null, status: 'pending' })
    const [app] = await h.sql`
      insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_name, guardian_email, created_at)
      values ('student', ${chapter}, 'accepted', 'Minor Testchild', 'p@example.test', 'Parent Testperson', 'p@example.test', '2013-01-01T00:00:00Z') returning id
    `
    const [enr] = await h.sql`
      insert into enrollment_record (application_id, student_account_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, created_by)
      values (${app!.id}, ${bad}, ${chapter}, ${term!.id}, ${randomUUID()}, 'Parent Testperson', ${director}) returning id
    `
    // An active enrollment consent for the bad account.
    await h.sql`
      insert into consent (student_account_id, type, action, source, source_ref, enrollment_record_id, granted_by, effective_at, reason)
      values (${bad}, 'enrollment', 'grant', 'signed_form', ${randomUUID()}, ${enr!.id}, ${null}, now(), 'standard')
    `
    // The membership must be inserted PENDING (an active one would already trip
    // the trigger); pending does not.
    const [m] = await h.sql`
      insert into membership (account_id, chapter_id, role, status, term_id)
      values (${bad}, ${chapter}, 'student', 'pending', ${term!.id}) returning id
    `

    const ctx = directorCtx(director, chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().activateStudent(m!.id as string, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect((caught as Error).message).toMatch(/dob/i)
    // Rolled back: still pending.
    expect(await statusesOf(m!.id as string, bad)).toEqual({
      membership: 'pending',
      currentTier: null,
      account: 'pending',
    })
  })
})
