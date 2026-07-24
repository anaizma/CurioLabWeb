// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 4) — the PARTICIPANT & GUARDIAN
// SURFACES HTTP controllers wired over the app services (design C.2, C.10, C.12).
// Embedded Postgres, SYNTHETIC data only. This file enables the feature (the
// enable-dm side-effect import MUST be first, before any @curiolab import) so the
// controllers run LIVE; the dark refusal is proven at the service layer and by the
// route-adapter smoke (mentor-dm-phase4-dark.test.ts).
//
// Covers the HTTP boundary: an authorized participant send (201), the participant
// list + read (200, carrying the visibility header + who-can-read), onboarding
// get/ack, the report (201) routing to the safety officer's view (200) with a
// mentor 403 on that view, and the guardian read + digest (200; another child 403).
// -------------------------------------------------------------------------

import './helpers/enable-dm.js'

import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { authorize, createSession, withRequest } from '@curiolab/runtime'
import {
  ConsentGrantService,
  DmEnableService,
  SafetyOfficerService,
} from '@curiolab/app'
import { baseCtx, mem } from '../../app/test/helpers/ctx.js'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import {
  sendDmMessage,
  listDmThreads,
  readDmThread,
  getDmOnboarding,
  ackDmOnboarding,
  reportDmThread,
  listDmReports,
  readChildDm,
  readChildDmDigest,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  // Do not leak the enabled flag to other test files sharing this worker process.
  delete process.env.MENTOR_DM_ENABLED
  await h?.end()
})

const TERM_START = '2026-01-01'
const TERM_END = '2026-12-31'

async function makeAdult(sql: Sql): Promise<string> {
  const [row] = await sql`
    insert into account (email, legal_name, display_name, date_of_birth, dob_provenance, credential_owner, status, maturation_state)
    values (${`a-${randomUUID().slice(0, 8)}@example.test`}, 'Adult Testperson', 'Adult T.', '1985-01-01', 'staff_entered', 'self_private', 'active', 'self_managed')
    returning id
  `
  return row!.id as string
}
async function makeMinor(sql: Sql): Promise<string> {
  const [row] = await sql`
    insert into account (username, legal_name, display_name, date_of_birth, dob_provenance, dob_source_ref, credential_owner, status, maturation_state)
    values (${`s-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.', '2015-06-01', 'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor')
    returning id
  `
  return row!.id as string
}
async function token(accountId: string): Promise<string> {
  const { token } = await createSession(h.sql, { accountId, expiresAt: new Date(Date.now() + 3_600_000) })
  return token
}

interface World {
  chapter: string
  mentorMembership: string
  mentorAccount: string
  mentorToken: string
  student: string
  studentToken: string
  guardian: string
  guardianToken: string
  officer: string
  officerToken: string
}

async function fullyProvisioned(): Promise<World> {
  const chapter = await makeChapter(h.sql)
  const [t] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Synthetic Term 2026', ${TERM_START}, ${TERM_END}) returning id
  `
  const term = t!.id as string
  const director = await makeAdult(h.sql)
  await h.sql`insert into membership (account_id, chapter_id, role, status) values (${director}, ${chapter}, 'chapter_director', 'active')`
  const dctx = baseCtx(director, new Date(), [mem('chapter_director', chapter)])
  const [p] = await h.sql`insert into pod (chapter_id, term_id, name) values (${chapter}, ${term}, 'Pod Synthetic') returning id`
  const pod = p!.id as string
  const mentorAccount = await makeAdult(h.sql)
  const [mm] = await h.sql`
    insert into membership (account_id, chapter_id, role, status, pod_id, term_id)
    values (${mentorAccount}, ${chapter}, 'junior_mentor', 'active', ${pod}, ${term}) returning id
  `
  const mentorMembership = mm!.id as string
  await h.sql`update pod set mentor_membership_id = ${mentorMembership} where id = ${pod}`
  for (const c of ['background_check', 'mandatory_reporter_training', 'cwru_affiliation_verified', 'signed_code_of_conduct']) {
    await h.sql`insert into mentor_eligibility (membership_id, component, cleared_at, expires_at, recorded_by) values (${mentorMembership}, ${c}, now(), ${null}, ${director})`
  }
  const student = await makeMinor(h.sql)
  await h.sql`insert into membership (account_id, chapter_id, role, status, pod_id, term_id) values (${student}, ${chapter}, 'student', 'active', ${pod}, ${term})`
  const guardian = await makeAdult(h.sql)
  await h.sql`
    insert into guardianship (guardian_account_id, student_account_id, relationship, status, verification_method, verified_by, verified_at)
    values (${guardian}, ${student}, 'guardian', 'verified', 'signed_form_match', ${director}, now())
  `
  const officer = await makeAdult(h.sql)

  await withRequest(() => new SafetyOfficerService({ sql: h.sql, authorize }).assign(chapter, officer, dctx))
  await withRequest(() => new DmEnableService({ sql: h.sql, authorize }).recordInsuranceAttestation(chapter, { carrier: 'Synthetic Mutual' }, dctx))
  await withRequest(() => new DmEnableService({ sql: h.sql, authorize }).enable(chapter, dctx))
  const gctx = { ...baseCtx(guardian, new Date()), guardianOf: [student] }
  await withRequest(() =>
    new ConsentGrantService({ sql: h.sql, authorize }).captureGrant(student, 'mentor_dm', gctx, {
      method: 'signed_form', evidenceArtifactRef: 'signed-dm-consent-ref',
    }),
  )

  return {
    chapter, mentorMembership, mentorAccount, mentorToken: await token(mentorAccount),
    student, studentToken: await token(student),
    guardian, guardianToken: await token(guardian),
    officer, officerToken: await token(officer),
  }
}

async function seedThread(w: World): Promise<string> {
  const res = await sendDmMessage({
    sql: h.sql, sessionToken: w.mentorToken,
    body: { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'hello student (synthetic)' },
  })
  expect(res.status).toBe(201)
  return (res.body as { threadId: string }).threadId
}

// ===========================================================================
describe('participant send + read (design C.2)', () => {
  test('an authorized mentor sends (201); the student lists + reads it with the header + who-can-read', async () => {
    const w = await fullyProvisioned()
    const threadId = await seedThread(w)

    const list = await listDmThreads({ sql: h.sql, sessionToken: w.studentToken })
    expect(list.status).toBe(200)
    const items = (list.body as { items: Array<{ threadId: string; whoCanRead: string; visibilityHeader: string }> }).items
    expect(items.length).toBe(1)
    expect(items[0]!.whoCanRead.length).toBeGreaterThan(0)

    const read = await readDmThread({ sql: h.sql, sessionToken: w.studentToken, params: { threadId } })
    expect(read.status).toBe(200)
    const detail = read.body as { visibilityHeader: string; whoCanRead: string; messages: Array<{ body: string }> }
    expect(detail.visibilityHeader.length).toBeGreaterThan(0)
    expect(detail.whoCanRead.length).toBeGreaterThan(0)
    expect(detail.messages.map((m) => m.body)).toContain('hello student (synthetic)')
  })

  test('a non-party (a stranger) reading is an opaque 403', async () => {
    const w = await fullyProvisioned()
    const threadId = await seedThread(w)
    const stranger = await makeAdult(h.sql)
    const res = await readDmThread({ sql: h.sql, sessionToken: await token(stranger), params: { threadId } })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/reason|out_of_scope/)
  })

  test('no session is an opaque 403', async () => {
    const res = await listDmThreads({ sql: h.sql })
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
describe('first-open onboarding (design C.12)', () => {
  test('content returns un-acknowledged; ack flips the state', async () => {
    const w = await fullyProvisioned()
    const before = await getDmOnboarding({ sql: h.sql, sessionToken: w.studentToken })
    expect(before.status).toBe(200)
    expect((before.body as { acknowledged: boolean }).acknowledged).toBe(false)

    const ack = await ackDmOnboarding({ sql: h.sql, sessionToken: w.studentToken })
    expect(ack.status).toBe(201)

    const after = await getDmOnboarding({ sql: h.sql, sessionToken: w.studentToken })
    expect((after.body as { acknowledged: boolean }).acknowledged).toBe(true)
  })
})

// ===========================================================================
describe('report routes to the safety officer, not the mentor (design C.12)', () => {
  test('a student report (201) surfaces to the officer view (200); the mentor gets 403 on that view', async () => {
    const w = await fullyProvisioned()
    const threadId = await seedThread(w)

    const report = await reportDmThread({
      sql: h.sql, sessionToken: w.studentToken, params: { threadId }, body: { note: 'uncomfortable (synthetic)' },
    })
    expect(report.status).toBe(201)

    const officerView = await listDmReports({ sql: h.sql, sessionToken: w.officerToken, query: { chapterId: w.chapter } })
    expect(officerView.status).toBe(200)
    expect((officerView.body as { items: unknown[] }).items.length).toBe(1)

    // the mentor cannot read the officer report view — opaque 403 (no mentor signal)
    const mentorView = await listDmReports({ sql: h.sql, sessionToken: w.mentorToken, query: { chapterId: w.chapter } })
    expect(mentorView.status).toBe(403)
  })
})

// ===========================================================================
describe('guardian read + digest (design C.10)', () => {
  test('a verified guardian reads their child’s threads (200) and gets a digest (200)', async () => {
    const w = await fullyProvisioned()
    await seedThread(w)

    const read = await readChildDm({ sql: h.sql, sessionToken: w.guardianToken, params: { id: w.student } })
    expect(read.status).toBe(200)
    expect((read.body as { items: unknown[] }).items.length).toBe(1)

    const digest = await readChildDmDigest({ sql: h.sql, sessionToken: w.guardianToken, params: { id: w.student } })
    expect(digest.status).toBe(200)
    expect((digest.body as { threadCount: number }).threadCount).toBe(1)
  })

  test('a guardian reading a NON-child is an opaque 403', async () => {
    const w = await fullyProvisioned()
    await seedThread(w)
    const otherChild = await makeMinor(h.sql)
    const res = await readChildDm({ sql: h.sql, sessionToken: w.guardianToken, params: { id: otherChild } })
    expect(res.status).toBe(403)
  })
})
