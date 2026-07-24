// -------------------------------------------------------------------------
// admin/director backend §9 — minor account recovery. Embedded Postgres.
//
//   * a minor's password reset is guardian-routed (the token is bound to the
//     child account but its delivery route is the guardian; a self-serve minor
//     reset never hands the child a usable token) — via CredentialTokenService;
//   * an adult's reset routes to their own email (unchanged);
//   * a LOGGED mentor/director-assisted recovery mints a setup token AND writes an
//     access_ledger row (who assisted, which minor, when, IP);
//   * an unauthorized actor cannot initiate assisted recovery; an adult subject is
//     refused (that path is minors-only).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, hashToken, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import { CredentialTokenService, MaturationService, MaturationAgeError } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function minorWithEnrollment(o: { username?: string } = {}) {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const director = await makeAdult(h.sql)
  const username = o.username ?? `curio-${randomUUID().slice(0, 8)}`
  const student = await makeMinor(h.sql, { username })
  const [app] = await h.sql`
    insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_email)
    values ('student', ${chapter}, 'accepted', 'Minor Testchild', 'p@example.test', 'p@example.test') returning id
  `
  await h.sql`
    insert into enrollment_record (application_id, student_account_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, created_by)
    values (${app!.id}, ${student}, ${chapter}, ${term!.id}, ${randomUUID()}, 'Parent Testperson', ${director})
  `
  return { chapter, director, student, username }
}

function maturation() {
  return new MaturationService({ sql: h.sql, authorize })
}

describe('a minor password reset is guardian-routed; an adult is self', () => {
  test("a minor's reset resolves route 'guardian' and stores the token on the CHILD account", async () => {
    const f = await minorWithEnrollment()
    const res = await new CredentialTokenService({ sql: h.sql }).issuePasswordReset(f.username)
    expect(res).not.toBeNull()
    expect(res!.route).toBe('guardian') // delivered via the guardian, not the child
    const [tok] = await h.sql`
      select account_id, purpose from credential_token where account_id = ${f.student} and purpose = 'password_reset'
    `
    expect(tok!.account_id).toBe(f.student)
  })

  test("an adult's reset routes to their own email", async () => {
    const email = `adult-${randomUUID().slice(0, 8)}@example.test`
    await makeAdult(h.sql, { email })
    const res = await new CredentialTokenService({ sql: h.sql }).issuePasswordReset(email)
    expect(res!.route).toBe('self_email')
  })
})

describe('mentor/director-assisted recovery (§9)', () => {
  test('a chapter mentor mints a setup token AND writes an access_ledger row + audit', async () => {
    const f = await minorWithEnrollment()
    const mentorId = await makeAdult(h.sql)
    const ctx = baseCtx(mentorId, new Date(), [mem('junior_mentor', f.chapter)])

    let out!: Awaited<ReturnType<MaturationService['assistRecovery']>>
    await withRequest(async () => {
      out = await maturation().assistRecovery(f.student, ctx, { clientIp: '198.51.100.4' })
    })

    expect(out.route).toBe('guardian')
    expect(out.chapterId).toBe(f.chapter)
    const [tok] = await h.sql`
      select purpose from credential_token where token_hash = ${hashToken(out.token)}
    `
    expect(tok!.purpose).toBe('minor_setup')

    const ledger = await h.sql`
      select actor_account_id, subject_account_id, chapter_id, client_ip
      from access_ledger where event = 'recovery.mentor_assisted' and subject_account_id = ${f.student}
    `
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.actor_account_id).toBe(mentorId)
    expect(String(ledger[0]!.client_ip)).toBe('198.51.100.4')

    const [audit] = await h.sql`
      select count(*)::int as n from audit_entry where action = 'account.assist_recovery' and subject_id = ${f.student}
    `
    expect(audit!.n).toBe(1)
  })

  test('an unauthorized actor (comms, not teaching) cannot initiate assisted recovery', async () => {
    const f = await minorWithEnrollment()
    const commsId = await makeAdult(h.sql)
    const ctx = baseCtx(commsId, new Date(), [mem('comms_associate', f.chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await maturation().assistRecovery(f.student, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const [n] = await h.sql`select count(*)::int as n from access_ledger where subject_account_id = ${f.student}`
    expect(n!.n).toBe(0) // nothing written on deny
  })

  test('an adult subject is refused (the assisted path is minors-only)', async () => {
    const chapter = await makeChapter(h.sql)
    const [term] = await h.sql`
      insert into term (chapter_id, name, starts_on, ends_on)
      values (${chapter}, 'T', '2099-09-01', '2099-12-15') returning id`
    const director = await makeAdult(h.sql)
    const adult = await makeAdult(h.sql)
    const [app] = await h.sql`
      insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email, guardian_email)
      values ('student', ${chapter}, 'accepted', 'A', 'p@example.test', 'p@example.test') returning id`
    await h.sql`
      insert into enrollment_record (application_id, student_account_id, chapter_id, term_id, signed_form_ref, guardian_name_on_form, created_by)
      values (${app!.id}, ${adult}, ${chapter}, ${term!.id}, ${randomUUID()}, 'P', ${director})`
    const mentorId = await makeAdult(h.sql)
    const ctx = baseCtx(mentorId, new Date(), [mem('chapter_director', chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await maturation().assistRecovery(adult, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(MaturationAgeError)
  })
})
