// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 2) — the structural constraints, app
// layer. Embedded Postgres, SYNTHETIC data only, deterministic clocks. Built DARK
// behind MENTOR_DM_ENABLED. Covers:
//   * Closed hours (C.4): a send inside the window succeeds; outside refuses
//     DmClosedHoursError; a per-chapter override changes the window; reads are
//     never hours-gated.
//   * Off-platform contact-info flagging (C.4/C.5): a send with contact info still
//     succeeds but writes a dm_flag (category contact_info); the pre-send check
//     returns the detection WITHOUT sending.
//   * Export (C.4): the student and a verified guardian export the full decrypted
//     thread in order; a stranger cannot (403); export refuses when the flag is off.
// -------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import type { AuthContext } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  ConsentGrantService,
  DmClosedHoursError,
  DmEnableService,
  DmNotAuthorizedForPairError,
  DmThreadService,
  SafetyOfficerService,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  process.env.DM_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// The chapter timezone is America/New_York (EDT = UTC-4 in July). So:
//   NOW      = 2026-07-24T12:00Z -> 08:00 local  -> INSIDE the default [7,21) window.
//   NIGHT    = 2026-07-24T03:00Z -> 23:00 local  -> OUTSIDE (closed).
const NOW = new Date('2026-07-24T12:00:00Z')
const NIGHT = new Date('2026-07-24T03:00:00Z')
const TERM_START = '2026-01-01'
const TERM_END = '2026-12-31'

function directorCtx(id: string, chapter: string): AuthContext {
  return baseCtx(id, NOW, [mem('chapter_director', chapter)])
}
function mentorCtx(w: World): AuthContext {
  return baseCtx(w.mentorAccount, NOW, [mem('junior_mentor', w.chapter)])
}

async function insertMembership(o: {
  accountId: string
  chapterId: string
  role: string
  podId?: string | null
  termId?: string | null
}): Promise<string> {
  const [row] = await h.sql`
    insert into membership (account_id, chapter_id, role, status, pod_id, term_id)
    values (${o.accountId}, ${o.chapterId}, ${o.role}, 'active', ${o.podId ?? null}, ${o.termId ?? null})
    returning id
  `
  return row!.id as string
}

interface World {
  chapter: string
  term: string
  pod: string
  director: string
  directorCtx: AuthContext
  mentorAccount: string
  mentorMembership: string
  student: string
  guardian: string
  safetyOfficer: string
}

async function world(): Promise<World> {
  const chapter = await makeChapter(h.sql)
  const [t] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Synthetic Term 2026', ${TERM_START}, ${TERM_END}) returning id
  `
  const term = t!.id as string
  const director = await makeAdult(h.sql)
  const [p] = await h.sql`
    insert into pod (chapter_id, term_id, name) values (${chapter}, ${term}, 'Pod Synthetic') returning id
  `
  const pod = p!.id as string
  const mentorAccount = await makeAdult(h.sql)
  const mentorMembership = await insertMembership({
    accountId: mentorAccount, chapterId: chapter, role: 'junior_mentor', podId: pod, termId: term,
  })
  await h.sql`update pod set mentor_membership_id = ${mentorMembership} where id = ${pod}`
  for (const component of ['background_check', 'mandatory_reporter_training', 'cwru_affiliation_verified', 'signed_code_of_conduct']) {
    await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at, expires_at, recorded_by)
      values (${mentorMembership}, ${component}, ${NOW}, ${null}, ${director})
    `
  }
  const student = await makeMinor(h.sql)
  await insertMembership({ accountId: student, chapterId: chapter, role: 'student', podId: pod, termId: term })
  const guardian = await makeAdult(h.sql)
  await h.sql`
    insert into guardianship (
      guardian_account_id, student_account_id, relationship, status,
      verification_method, verified_by, verified_at
    ) values (${guardian}, ${student}, 'guardian', 'verified', 'signed_form_match', ${director}, ${NOW})
  `
  const safetyOfficer = await makeAdult(h.sql)
  return {
    chapter, term, pod, director, directorCtx: directorCtx(director, chapter),
    mentorAccount, mentorMembership, student, guardian, safetyOfficer,
  }
}

async function captureMentorDm(w: World): Promise<void> {
  const svc = new ConsentGrantService({ sql: h.sql, authorize })
  const gctx: AuthContext = { ...baseCtx(w.guardian, NOW), guardianOf: [w.student] }
  await withRequest(() =>
    svc.captureGrant(w.student, 'mentor_dm', gctx, {
      method: 'signed_form', evidenceArtifactRef: 'signed-dm-consent-ref', now: NOW,
    }),
  )
}

async function fullyProvisioned(): Promise<World> {
  const w = await world()
  await withRequest(() => new SafetyOfficerService({ sql: h.sql, authorize }).assign(w.chapter, w.safetyOfficer, w.directorCtx))
  await withRequest(() => new DmEnableService({ sql: h.sql, authorize }).recordInsuranceAttestation(w.chapter, { carrier: 'Synthetic Mutual' }, w.directorCtx))
  await withRequest(() => new DmEnableService({ sql: h.sql, authorize }).enable(w.chapter, w.directorCtx, { now: NOW }))
  await captureMentorDm(w)
  return w
}

/** An enabled DmThreadService (global flag on). */
function liveSvc(): DmThreadService {
  return new DmThreadService({ sql: h.sql, config: { mentorDmEnabled: true }, authorize })
}

async function send(w: World, svc: DmThreadService, body: string, now: Date) {
  return withRequest(() =>
    svc.sendMessage(
      { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body },
      mentorCtx(w), now,
    ),
  )
}

// ===========================================================================
describe('closed hours (design C.4)', () => {
  test('a send inside the window succeeds', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, liveSvc(), 'inside the window (synthetic)', NOW)
    expect(threadId).toBeTruthy()
  })

  test('a send outside the window refuses with DmClosedHoursError and writes nothing', async () => {
    const w = await fullyProvisioned()
    await expect(send(w, liveSvc(), 'late night (synthetic)', NIGHT)).rejects.toBeInstanceOf(DmClosedHoursError)
    const rows = await h.sql`
      select 1 from dm_thread where mentor_membership_id = ${w.mentorMembership} and student_account_id = ${w.student}
    `
    expect(rows.length).toBe(0)
  })

  test('a per-chapter override changes the window (open=9 refuses an 08:00-local send)', async () => {
    const w = await fullyProvisioned()
    await h.sql`update chapter set dm_open_hour = 9, dm_close_hour = 18 where id = ${w.chapter}`
    // NOW is 08:00 local — allowed under the default [7,21) but refused under [9,18).
    await expect(send(w, liveSvc(), 'before override open (synthetic)', NOW)).rejects.toBeInstanceOf(DmClosedHoursError)
  })

  test('reads are NEVER hours-gated (a read at a closed hour still returns messages)', async () => {
    const w = await fullyProvisioned()
    const svc = liveSvc()
    const { threadId } = await send(w, svc, 'daytime send (synthetic)', NOW)
    // Read it back "at night" — reads carry no `now` and are never hours-gated.
    const read = await svc.readThread(threadId, w.student)
    expect(read.messages[0]!.body).toBe('daytime send (synthetic)')
  })
})

// ===========================================================================
describe('off-platform contact-info flagging (design C.4/C.5)', () => {
  test('a send with contact info still succeeds but writes a dm_flag (category contact_info)', async () => {
    const w = await fullyProvisioned()
    const { threadId, messageId } = await send(w, liveSvc(), 'call me at 216-555-0199 (synthetic)', NOW)
    expect(messageId).toBeTruthy()
    const flags = await h.sql`select category, detail from dm_flag where message_id = ${messageId}`
    expect(flags.length).toBeGreaterThan(0)
    expect(flags.every((f) => f.category === 'contact_info')).toBe(true)
    expect(flags.some((f) => f.detail === 'phone')).toBe(true)
    // The thread + message really were written (not blocked).
    const [t] = await h.sql`select 1 from dm_thread where id = ${threadId}`
    expect(t).toBeTruthy()
  })

  test('an ordinary send writes NO dm_flag', async () => {
    const w = await fullyProvisioned()
    const { messageId } = await send(w, liveSvc(), 'Great work on the robot today! (synthetic)', NOW)
    const flags = await h.sql`select 1 from dm_flag where message_id = ${messageId}`
    expect(flags.length).toBe(0)
  })

  test('the pre-send check returns the detection WITHOUT sending', async () => {
    const w = await fullyProvisioned()
    const svc = liveSvc()
    const check = svc.checkDraft('email me at coach@example.com (synthetic)')
    expect(check.flags.some((f) => f.category === 'contact_info' && f.detail === 'email')).toBe(true)
    // Nothing was written — no thread, no message, no flag.
    const rows = await h.sql`
      select 1 from dm_thread where mentor_membership_id = ${w.mentorMembership} and student_account_id = ${w.student}
    `
    expect(rows.length).toBe(0)
  })
})

// ===========================================================================
describe('thread export (design C.4)', () => {
  async function threadWithMessages(w: World): Promise<string> {
    const svc = liveSvc()
    const { threadId } = await send(w, svc, 'first message (synthetic)', NOW)
    await send(w, svc, 'second message (synthetic)', NOW)
    return threadId
  }

  test('the student exports the full decrypted thread in order', async () => {
    const w = await fullyProvisioned()
    const threadId = await threadWithMessages(w)
    const exp = await liveSvc().exportThread(threadId, w.student, NOW)
    expect(exp.thread.id).toBe(threadId)
    expect(exp.messages.map((m) => m.body)).toEqual(['first message (synthetic)', 'second message (synthetic)'])
  })

  test('a verified guardian exports the child thread', async () => {
    const w = await fullyProvisioned()
    const threadId = await threadWithMessages(w)
    const exp = await liveSvc().exportThread(threadId, w.guardian, NOW)
    expect(exp.thread.studentAccountId).toBe(w.student)
    expect(exp.messages.length).toBe(2)
  })

  test('a stranger cannot export (opaque 403)', async () => {
    const w = await fullyProvisioned()
    const threadId = await threadWithMessages(w)
    const stranger = await makeAdult(h.sql)
    await expect(liveSvc().exportThread(threadId, stranger, NOW)).rejects.toBeInstanceOf(Forbidden)
  })

  test('the mentor cannot export via this student/guardian-scoped path (opaque 403)', async () => {
    const w = await fullyProvisioned()
    const threadId = await threadWithMessages(w)
    await expect(liveSvc().exportThread(threadId, w.mentorAccount, NOW)).rejects.toBeInstanceOf(Forbidden)
  })

  test('with the GLOBAL flag OFF, export refuses (dark)', async () => {
    const w = await fullyProvisioned()
    const threadId = await threadWithMessages(w)
    const darkSvc = new DmThreadService({ sql: h.sql, authorize }) // default config: flag off
    await expect(darkSvc.exportThread(threadId, w.student, NOW)).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
  })
})
