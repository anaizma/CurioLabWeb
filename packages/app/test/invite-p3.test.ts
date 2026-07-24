// -------------------------------------------------------------------------
// admin/director backend §3 — guardian-before-student enforcement at
// accept-student (the COPPA ordering invariant). Embedded Postgres, synthetic
// data only.
//
// When a student invite's enrollment already binds a guardian-provisioned student
// account, accept-student CREDENTIALS that account and is REFUSED unless a VERIFIED
// guardianship edge exists AND the guardian's participation consent is on file. On
// success the one-time setup credential is routed to the guardian, never the child,
// and the account stays `pending` (no membership) — a student invite alone can
// never stand up an ACTIVE student.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, generateSessionToken, hashToken, verifyPassword } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { InviteService } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

interface Opts {
  edge?: 'none' | 'pending' | 'verified'
  participation?: boolean
}

// A guardian-provisioned, PENDING minor student the enrollment already binds
// (provisioned by the guardian-onboarding flow), a guardian account, an optional
// guardianship edge in the given state, an optional active participation consent,
// and a seeded student invite bound to the enrollment.
async function setup(opts: Opts = {}) {
  const edge = opts.edge ?? 'verified'
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)
  const guardian = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { status: 'pending' })
  const signedFormRef = randomUUID()
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild', 'parent@example.test',
      'Parent Testperson', 'parent@example.test', '2013-01-01T00:00:00Z'
    ) returning id
  `
  const [enr] = await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, form_signed_at, created_by
    ) values (
      ${app!.id}, ${student}, ${chapter}, ${term!.id},
      ${signedFormRef}, 'Parent Testperson', '2013-06-01', ${director}
    ) returning id
  `
  const enrollmentRecordId = enr!.id as string

  if (edge !== 'none') {
    await h.sql`
      insert into guardianship (
        guardian_account_id, student_account_id, relationship, status,
        verification_method, verified_by, source_ref, verified_at
      ) values (
        ${guardian}, ${student}, 'guardian', ${edge},
        'signed_form_match', ${edge === 'verified' ? director : null},
        ${edge === 'verified' ? signedFormRef : null}, ${edge === 'verified' ? h.sql`now()` : null}
      )
    `
  }
  if (opts.participation) {
    await h.sql`
      insert into consent (
        student_account_id, type, action, source, source_ref,
        enrollment_record_id, granted_by, effective_at, reason
      ) values (
        ${student}, 'platform_participation', 'grant', 'digital', ${null},
        ${enrollmentRecordId}, ${guardian}, now(), 'standard'
      )
    `
  }

  // Seed the student invite bound to the enrollment (student invites are not
  // issuable through the ops endpoint; they originate from a consented guardian).
  const token = generateSessionToken()
  const [inv] = await h.sql`
    insert into invite (
      token_hash, kind, enrollment_record_id, bound_chapter_id, issued_by,
      expires_at, status, delivery_status
    ) values (
      ${hashToken(token)}, 'student', ${enrollmentRecordId}, ${chapter}, ${director},
      now() + interval '7 days', 'issued', 'sent'
    ) returning id
  `
  return { chapter, director, guardian, student, enrollmentRecordId, inviteId: inv!.id as string, token }
}

function svc() {
  return new InviteService({ sql: h.sql, authorize })
}
const creds = () => ({
  username: `curio-${randomUUID().slice(0, 8)}`,
  password: 'correct horse battery staple',
  legalName: 'Minor Testchild',
  displayName: 'Minor T.',
})

describe('accept-student is refused without a consented, verified guardian', () => {
  test('no guardianship edge → opaque refusal, no credential set, invite still issued', async () => {
    const f = await setup({ edge: 'none', participation: true })
    await expect(svc().acceptInvite(f.token, creds(), { kind: 'student' })).rejects.toThrow()
    const [acct] = await h.sql`select username, password_hash from account where id = ${f.student}`
    expect(acct!.password_hash).toBeNull()
    const [inv] = await h.sql`select status from invite where id = ${f.inviteId}`
    expect(inv!.status).toBe('issued') // usable on retry once the guardian verifies
  })

  test('a PENDING (unverified) guardianship → refused', async () => {
    const f = await setup({ edge: 'pending', participation: true })
    await expect(svc().acceptInvite(f.token, creds(), { kind: 'student' })).rejects.toThrow()
    const [acct] = await h.sql`select password_hash from account where id = ${f.student}`
    expect(acct!.password_hash).toBeNull()
  })

  test('a VERIFIED guardianship but NO participation consent on file → refused', async () => {
    const f = await setup({ edge: 'verified', participation: false })
    await expect(svc().acceptInvite(f.token, creds(), { kind: 'student' })).rejects.toThrow()
    const [acct] = await h.sql`select password_hash from account where id = ${f.student}`
    expect(acct!.password_hash).toBeNull()
  })
})

describe('accept-student succeeds with a verified guardian + consent', () => {
  test('credentials the existing student, routes the setup token to the guardian, stays pending, no membership', async () => {
    const f = await setup({ edge: 'verified', participation: true })
    const c = creds()
    const res = await svc().acceptInvite(f.token, c, { kind: 'student' }, { clientIp: '203.0.113.9' })

    // The pre-existing student account is credentialed (not a new account).
    expect(res.accountId).toBe(f.student)
    const [acct] = await h.sql`select username, password_hash, status from account where id = ${f.student}`
    expect(acct!.username).toBe(c.username)
    expect(await verifyPassword(acct!.password_hash as string, c.password)).toBe(true)
    // Stays pending — a student invite alone never creates an ACTIVE student.
    expect(acct!.status).toBe('pending')
    const [m] = await h.sql`select count(*)::int as n from membership where account_id = ${f.student}`
    expect(m!.n).toBe(0)

    // The one-time setup credential is routed to the guardian, never the child.
    expect(res.setupToken).toBeTruthy()
    expect(res.setupTokenRoute).toBe('guardian')
    expect(res.guardianAccountId).toBe(f.guardian)
    const [tok] = await h.sql`
      select account_id, purpose from credential_token where token_hash = ${hashToken(res.setupToken as string)}
    `
    expect(tok!.account_id).toBe(f.student) // bound to the child account, guardian-delivered
    expect(tok!.purpose).toBe('minor_setup')

    // §8 ledger: the redemption row (with IP) and the consent-artifact row.
    const redeemed = await h.sql`
      select client_ip, guardian_account_id from access_ledger
      where event = 'invite.redeemed' and invite_id = ${f.inviteId}
    `
    expect(redeemed).toHaveLength(1)
    expect(String(redeemed[0]!.client_ip)).toBe('203.0.113.9')
    expect(redeemed[0]!.guardian_account_id).toBe(f.guardian)
    const consentRow = await h.sql`
      select consent_method from access_ledger
      where event = 'accept_student.consent' and invite_id = ${f.inviteId}
    `
    expect(consentRow).toHaveLength(1)
    expect(consentRow[0]!.consent_method).toBe('guardian_participation_consent')
  })
})
