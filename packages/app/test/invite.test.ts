// -------------------------------------------------------------------------
// InviteService tests (Milestone 1 step 3): invite issue, validate, accept,
// resend. Embedded Postgres, synthetic data only.
//
// Covers the three unauthenticated actor-less endpoints (GET /invites/:token,
// POST /invites/:token/accept, POST /invites/:token/accept-student) and the two
// authorized ops writes (POST /ops/invites, /:id/resend, `member.invite`). Email
// DELIVERY and the HTTP layer are deferred; returning the opaque token is the
// seam the future mailer uses.
//
// Scope note: guardian verification / name-match (step 4), consent capture
// (step 5), and membership activation (step 6) are NOT built here. Acceptance
// confers NO authority — only a `pending` account and, for a guardian, a
// `pending` guardianship edge.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, hashToken, verifyPassword, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { InviteService, INVITE_TTL_MS } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// A chapter + term + director + an accepted student application + an enrollment
// record whose student_account_id points at a real minor account. This is what
// a guardian invite binds to (04-guarantees: a guardian invite must bind an
// enrollment whose application.guardian_email equals the invite target_email).
// The guardian email is unique per setup: accept turns it into an `account.email`
// and that column is globally unique, so tests must not share one.
async function guardianSetup(guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`) {
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
      guardian_name, guardian_email
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild',
      ${guardianEmail}, 'Parent Testperson', ${guardianEmail}
    ) returning id
  `
  const [enr] = await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${student}, ${chapter}, ${term!.id},
      ${randomUUID()}, 'Parent Testperson', ${director}
    ) returning id
  `
  return {
    chapter,
    term: term!.id as string,
    director,
    student,
    applicationId: app!.id as string,
    enrollmentRecordId: enr!.id as string,
    guardianEmail,
  }
}

// A SEEDING enrollment for the student accept path: the enrollment record
// carries the form DOB with student_account_id NULL (the brand-new student whose
// account does not exist yet). accept-student copies the DOB with
// dob_provenance='enrollment_record' + dob_source_ref=signed_form_ref, then
// backfills student_account_id. The signed_form_ref is captured so the test can
// assert it lands on the account.
async function seedingStudentSetup() {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)
  const guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild',
      ${guardianEmail}, 'Parent Testperson', ${guardianEmail}
    ) returning id
  `
  const signedFormRef = randomUUID()
  const formDob = '2014-04-04'
  const [enr] = await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, date_of_birth, created_by
    ) values (
      ${app!.id}, ${null}, ${chapter}, ${term!.id},
      ${signedFormRef}, 'Parent Testperson', ${formDob}, ${director}
    ) returning id
  `
  return {
    chapter,
    term: term!.id as string,
    director,
    applicationId: app!.id as string,
    enrollmentRecordId: enr!.id as string,
    signedFormRef,
    formDob,
  }
}

function svc() {
  return new InviteService({ sql: h.sql, authorize })
}
function directorCtx(f: { director: string; chapter: string }) {
  return baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
}

/** Issue a guardian invite bound to the setup's enrollment, returning the token. */
async function issueGuardian(f: Awaited<ReturnType<typeof guardianSetup>>) {
  const ctx = directorCtx(f)
  let out!: Awaited<ReturnType<InviteService['issueInvite']>>
  await withRequest(async () => {
    out = await svc().issueInvite(
      {
        kind: 'guardian',
        chapterId: f.chapter,
        targetEmail: f.guardianEmail,
        enrollmentRecordId: f.enrollmentRecordId,
      },
      ctx,
    )
  })
  return out
}

const emailCreds = (email: string) => ({
  email,
  password: 'correct horse battery staple',
  legalName: 'Parent Testperson',
  displayName: 'Parent T.',
  dateOfBirth: '1985-03-04',
})
const usernameCreds = (username: string) => ({
  username,
  password: 'correct horse battery staple',
  legalName: 'Minor Testchild',
  displayName: 'Minor T.',
  dateOfBirth: '2015-06-01',
})

async function memberCount(accountId: string): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from membership where account_id = ${accountId}`
  return row!.n as number
}
async function activeMemberCount(accountId: string): Promise<number> {
  const [row] = await h.sql`
    select count(*)::int as n from membership where account_id = ${accountId} and status = 'active'
  `
  return row!.n as number
}

// ===========================================================================
describe('issueInvite', () => {
  test('creates an issued invite storing only the token HASH, with a 14-day expiry', async () => {
    const f = await guardianSetup()
    const before = Date.now()
    const out = await issueGuardian(f)

    // The opaque token is returned; only its hash is stored.
    expect(typeof out.token).toBe('string')
    expect(out.token.length).toBeGreaterThan(20)

    const [row] = await h.sql`select * from invite where id = ${out.inviteId}`
    expect(row!.status).toBe('issued')
    expect(row!.kind).toBe('guardian')
    expect(row!.token_hash).toBe(hashToken(out.token))
    expect(row!.token_hash).not.toBe(out.token) // never the raw token
    expect(row!.target_email).toBe(f.guardianEmail)
    expect(row!.enrollment_record_id).toBe(f.enrollmentRecordId)
    expect(row!.issued_by).toBe(f.director)

    const exp = new Date(row!.expires_at as string).getTime()
    expect(exp).toBeGreaterThan(before + INVITE_TTL_MS - 60_000)
    expect(exp).toBeLessThan(Date.now() + INVITE_TTL_MS + 60_000)
  })

  test('a guardian invite whose target_email differs from the bound enrollment email is rejected — service check', async () => {
    const f = await guardianSetup()
    const ctx = directorCtx(f)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().issueInvite(
          {
            kind: 'guardian',
            chapterId: f.chapter,
            targetEmail: 'someone-else@example.test',
            enrollmentRecordId: f.enrollmentRecordId,
          },
          ctx,
        )
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Error)
    const [row] = await h.sql`select count(*)::int as n from invite where enrollment_record_id = ${f.enrollmentRecordId}`
    expect(row!.n).toBe(0) // nothing persisted
  })

  test('the DB trigger is the floor: a direct mismatched insert is rejected too', async () => {
    const f = await guardianSetup()
    let caught: unknown
    try {
      await h.sql`
        insert into invite (token_hash, kind, target_email, enrollment_record_id, issued_by, expires_at, status, delivery_status)
        values (${hashToken('x')}, 'guardian', 'wrong@example.test', ${f.enrollmentRecordId}, ${f.director}, now() + interval '14 days', 'issued', 'sent')
      `
    } catch (e) {
      caught = e
    }
    expect((caught as Error).message).toMatch(/target_email|guardian invite/i)
  })

  test('a director in another chapter is denied: opaque Forbidden, one permission.denied row, no invite', async () => {
    const f = await guardianSetup()
    const otherChapter = await makeChapter(h.sql)
    const strangerId = await makeAdult(h.sql)
    const stranger = baseCtx(strangerId, new Date(), [mem('chapter_director', otherChapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().issueInvite(
          { kind: 'guardian', chapterId: f.chapter, targetEmail: f.guardianEmail, enrollmentRecordId: f.enrollmentRecordId },
          stranger,
        )
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
    expect(denied[0]!.detail).toMatchObject({ capability: 'member.invite', reason: 'out_of_scope' })
    const [cnt] = await h.sql`select count(*)::int as n from invite where enrollment_record_id = ${f.enrollmentRecordId}`
    expect(cnt!.n).toBe(0)
  })
})

// ===========================================================================
describe('validateInvite', () => {
  test('returns only { usable, kind, chapter } for a usable invite — no name of any kind', async () => {
    const f = await guardianSetup()
    const out = await issueGuardian(f)
    const result = await svc().validateInvite(out.token)
    expect(result).toEqual({ usable: true, kind: 'guardian', chapter: f.chapter })
    // No child/guardian name leaks anywhere in the response shape.
    expect(Object.keys(result).sort()).toEqual(['chapter', 'kind', 'usable'])
    expect(JSON.stringify(result)).not.toMatch(/Testchild|Testperson/)
  })

  test('invalid, expired, and already-accepted tokens return the SAME not-usable result', async () => {
    // invalid: a token that was never issued.
    const invalid = await svc().validateInvite('this-token-was-never-issued')

    // expired: issue, then push expiry into the past (decision-time evaluation).
    const f1 = await guardianSetup()
    const e = await issueGuardian(f1)
    await h.sql`update invite set expires_at = now() - interval '1 day' where id = ${e.inviteId}`
    const expired = await svc().validateInvite(e.token)

    // already-accepted: issue then accept.
    const f2 = await guardianSetup()
    const a = await issueGuardian(f2)
    await svc().acceptInvite(a.token, emailCreds(f2.guardianEmail))
    const accepted = await svc().validateInvite(a.token)

    const notUsable = { usable: false, kind: null, chapter: null }
    expect(invalid).toEqual(notUsable)
    expect(expired).toEqual(notUsable)
    expect(accepted).toEqual(notUsable)
    expect(invalid).toEqual(expired)
    expect(expired).toEqual(accepted)
  })
})

// ===========================================================================
describe('acceptInvite', () => {
  test('email accept creates a pending guardian account and a pending guardianship edge — no membership', async () => {
    const f = await guardianSetup()
    const out = await issueGuardian(f)
    const res = await svc().acceptInvite(out.token, emailCreds(f.guardianEmail))

    const [acct] = await h.sql`select * from account where id = ${res.accountId}`
    expect(acct!.status).toBe('pending')
    expect(acct!.email).toBe(f.guardianEmail)
    expect(acct!.username).toBeNull()
    expect(acct!.password_hash).not.toBeNull()
    expect(await verifyPassword(acct!.password_hash as string, 'correct horse battery staple')).toBe(true)

    // A pending guardianship edge to the enrollment's child; NO authority yet.
    expect(res.guardianshipId).not.toBeNull()
    const [edge] = await h.sql`select * from guardianship where id = ${res.guardianshipId}`
    expect(edge!.status).toBe('pending')
    expect(edge!.guardian_account_id).toBe(res.accountId)
    expect(edge!.student_account_id).toBe(f.student)
    expect(edge!.verified_at).toBeNull()

    // The invite is consumed.
    const [inv] = await h.sql`select status, accepted_at from invite where id = ${out.inviteId}`
    expect(inv!.status).toBe('accepted')
    expect(inv!.accepted_at).not.toBeNull()

    // Wrong-person containment: the accepting account holds NO active membership.
    expect(await memberCount(res.accountId)).toBe(0)
    expect(await activeMemberCount(res.accountId)).toBe(0)
  })

  test('username accept creates a pending student account with a username and NULL email — no membership, no edge', async () => {
    const f = await seedingStudentSetup()
    const ctx = directorCtx(f)
    let issued!: Awaited<ReturnType<InviteService['issueInvite']>>
    await withRequest(async () => {
      issued = await svc().issueInvite({ kind: 'student', chapterId: f.chapter, enrollmentRecordId: f.enrollmentRecordId }, ctx)
    })
    const username = `curio-${randomUUID().slice(0, 8)}`
    const res = await svc().acceptInvite(issued.token, usernameCreds(username))

    const [acct] = await h.sql`select * from account where id = ${res.accountId}`
    expect(acct!.status).toBe('pending')
    expect(acct!.username).toBe(username)
    expect(acct!.email).toBeNull()
    expect(acct!.credential_owner).toBe('guardian_provisioned')
    expect(acct!.maturation_state).toBe('minor')
    expect(res.guardianshipId).toBeNull()
    expect(await memberCount(res.accountId)).toBe(0)
  })

  test('accept-student copies the DOB from the seeding enrollment with enrollment_record provenance + dob_source_ref, NOT from caller input, and backfills student_account_id', async () => {
    const f = await seedingStudentSetup()
    const ctx = directorCtx(f)
    let issued!: Awaited<ReturnType<InviteService['issueInvite']>>
    await withRequest(async () => {
      issued = await svc().issueInvite({ kind: 'student', chapterId: f.chapter, enrollmentRecordId: f.enrollmentRecordId }, ctx)
    })
    const username = `curio-${randomUUID().slice(0, 8)}`
    // The caller supplies a DIFFERENT DOB; it must be ignored in favour of the
    // form DOB on the enrollment record.
    const res = await svc().acceptInvite(issued.token, {
      username,
      password: 'correct horse battery staple',
      legalName: 'Minor Testchild',
      displayName: 'Minor T.',
      dateOfBirth: '2000-01-01', // decoy; must NOT be used
    })

    const [acct] = await h.sql`
      select date_of_birth::text as dob, dob_provenance, dob_source_ref
      from account where id = ${res.accountId}
    `
    // DOB comes from the enrollment record, not the caller.
    expect(acct!.dob).toBe(f.formDob)
    expect(acct!.dob_provenance).toBe('enrollment_record')
    expect(acct!.dob_source_ref).toBe(f.signedFormRef)

    // The linkage backfill: the seeding enrollment now points at the new account,
    // and its own DOB is untouched (write-once).
    const [enr] = await h.sql`
      select student_account_id, date_of_birth::text as dob from enrollment_record where id = ${f.enrollmentRecordId}
    `
    expect(enr!.student_account_id).toBe(res.accountId)
    expect(enr!.dob).toBe(f.formDob)

    // The resulting account satisfies the decision-4 trigger: an active student
    // membership is accepted (provenance=enrollment_record, dob_source_ref set).
    const [m] = await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${res.accountId}, ${f.chapter}, 'student', 'active') returning id
    `
    expect(m!.id).toBeTruthy()
  })

  test('single-use: the second accept with the same token fails and no second account is created', async () => {
    const f = await guardianSetup()
    const out = await issueGuardian(f)
    await svc().acceptInvite(out.token, emailCreds(f.guardianEmail))

    let caught: unknown
    try {
      await svc().acceptInvite(out.token, emailCreds('second@example.test'))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    const [cnt] = await h.sql`select count(*)::int as n from account where email = 'second@example.test'`
    expect(cnt!.n).toBe(0)
  })

  test('an expired token is rejected', async () => {
    const f = await guardianSetup()
    const out = await issueGuardian(f)
    await h.sql`update invite set expires_at = now() - interval '1 day' where id = ${out.inviteId}`
    let caught: unknown
    try {
      await svc().acceptInvite(out.token, emailCreds(f.guardianEmail))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
  })

  test('a revoked (superseded) token is rejected', async () => {
    const f = await guardianSetup()
    const out = await issueGuardian(f)
    const ctx = directorCtx(f)
    await withRequest(async () => {
      await svc().resendInvite(out.inviteId, ctx)
    })
    let caught: unknown
    try {
      await svc().acceptInvite(out.token, emailCreds(f.guardianEmail))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
  })

  test('a credential shape that does not match the invite kind is rejected', async () => {
    const f = await guardianSetup()
    const out = await issueGuardian(f)
    let caught: unknown
    try {
      // A guardian invite requires email+password, not a username.
      await svc().acceptInvite(out.token, usernameCreds('someuser'))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    // The invite is untouched (still issued) so a correct retry still works.
    const [inv] = await h.sql`select status from invite where id = ${out.inviteId}`
    expect(inv!.status).toBe('issued')
  })
})

// ===========================================================================
describe('resendInvite', () => {
  test('revokes the old token and issues a working new one', async () => {
    const f = await guardianSetup()
    const first = await issueGuardian(f)
    const ctx = directorCtx(f)

    let second!: Awaited<ReturnType<InviteService['resendInvite']>>
    await withRequest(async () => {
      second = await svc().resendInvite(first.inviteId, ctx)
    })

    expect(second.token).not.toBe(first.token)
    expect(second.inviteId).not.toBe(first.inviteId)

    // Old row revoked, new row issued.
    const [oldRow] = await h.sql`select status from invite where id = ${first.inviteId}`
    const [newRow] = await h.sql`select status from invite where id = ${second.inviteId}`
    expect(oldRow!.status).toBe('revoked')
    expect(newRow!.status).toBe('issued')

    // The old token no longer validates; the new one does.
    expect(await svc().validateInvite(first.token)).toEqual({ usable: false, kind: null, chapter: null })
    expect(await svc().validateInvite(second.token)).toEqual({ usable: true, kind: 'guardian', chapter: f.chapter })

    // The new token accepts; the old one cannot.
    const res = await svc().acceptInvite(second.token, emailCreds(f.guardianEmail))
    expect(res.accountId).toBeTruthy()
  })
})
