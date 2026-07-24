// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 4) — the PARTICIPANT & GUARDIAN
// SURFACES app services over the Phase 1-3 encrypted append-only thread store +
// detection/oversight + the 0033 tables. Embedded Postgres, SYNTHETIC data only,
// deterministic clocks. Built DARK behind MENTOR_DM_ENABLED. Covers (design C.2,
// C.10, C.12):
//   * participant list + read: the caller's own threads; the read carries the
//     permanent visibility header AND the who-can-read statement; a non-party 403;
//     a guardian under an ACTIVE suspension is excluded while the participants read;
//   * first-open onboarding: the content returns; ack records once; state flips;
//   * "something feels off" report: writes the report + a dm.student_report ledger
//     entry, routes to the safety officer's view, produces NO mentor-visible signal;
//   * guardian read of the child's threads; another child 403; the digest aggregates
//     only that child; a suspended guardian is excluded;
//   * everything refuses with the global flag OFF (dark).
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
  DmEnableService,
  DmGuardianDmService,
  DmNotAuthorizedForPairError,
  DmParticipantService,
  DmThreadNotFoundError,
  DmThreadService,
  DmVisibilitySuspensionService,
  DM_ONBOARDING,
  DM_VISIBILITY_HEADER_TEXT,
  DM_WHO_CAN_READ_TEXT,
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

const NOW = new Date('2026-07-24T12:00:00Z') // 08:00 America/New_York — inside [7,21)
const TERM_START = '2026-01-01'
const TERM_END = '2026-12-31'

function directorCtx(id: string, chapter: string): AuthContext {
  return baseCtx(id, NOW, [mem('chapter_director', chapter)])
}
function mentorCtx(w: World): AuthContext {
  return baseCtx(w.mentorAccount, NOW, [mem('junior_mentor', w.chapter)])
}
function studentCtx(w: World): AuthContext {
  return baseCtx(w.student, NOW, [mem('student', w.chapter)])
}
function officerCtx(w: World, now: Date = NOW): AuthContext {
  return baseCtx(w.safetyOfficer, now, [mem('safety_officer', w.chapter)])
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
  await insertMembership({ accountId: director, chapterId: chapter, role: 'chapter_director' })
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

function liveThread(): DmThreadService {
  return new DmThreadService({ sql: h.sql, config: { mentorDmEnabled: true }, authorize })
}
function liveParticipant(): DmParticipantService {
  return new DmParticipantService({ sql: h.sql, config: { mentorDmEnabled: true }, authorize })
}
function darkParticipant(): DmParticipantService {
  return new DmParticipantService({ sql: h.sql, authorize }) // flag off by default
}
function liveGuardianDm(): DmGuardianDmService {
  return new DmGuardianDmService({ sql: h.sql, config: { mentorDmEnabled: true } })
}
function liveSuspension(): DmVisibilitySuspensionService {
  return new DmVisibilitySuspensionService({ sql: h.sql, config: { mentorDmEnabled: true }, authorize })
}

async function sendAs(w: World, ctx: AuthContext, body: string, now: Date = NOW) {
  return withRequest(() =>
    liveThread().sendMessage(
      { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body },
      ctx, now,
    ),
  )
}
async function send(w: World, body: string, now: Date = NOW) {
  return sendAs(w, mentorCtx(w), body, now)
}

// ===========================================================================
describe('participant send (design C.2)', () => {
  test('an authorized STUDENT can send in their own thread', async () => {
    const w = await fullyProvisioned()
    const { threadId, messageId } = await sendAs(w, studentCtx(w), 'hi mentor (synthetic)')
    expect(threadId).toBeTruthy()
    expect(messageId).toBeTruthy()
    const [row] = await h.sql`select sender_account_id from dm_message where id = ${messageId}`
    expect(row!.sender_account_id).toBe(w.student)
  })

  test('an authorized MENTOR can send in the assigned pair', async () => {
    const w = await fullyProvisioned()
    const { messageId } = await send(w, 'hi student (synthetic)')
    const [row] = await h.sql`select sender_account_id from dm_message where id = ${messageId}`
    expect(row!.sender_account_id).toBe(w.mentorAccount)
  })
})

// ===========================================================================
describe('participant list + read (design C.2)', () => {
  test('a participant lists their OWN threads', async () => {
    const w = await fullyProvisioned()
    await send(w, 'first (synthetic)')
    const asMentor = await liveParticipant().listThreads(w.mentorAccount, NOW)
    expect(asMentor.items.length).toBe(1)
    expect(asMentor.items[0]!.visibilityHeader).toBe(DM_VISIBILITY_HEADER_TEXT)
    expect(asMentor.items[0]!.whoCanRead).toBe(DM_WHO_CAN_READ_TEXT)
    const asStudent = await liveParticipant().listThreads(w.student, NOW)
    expect(asStudent.items.length).toBe(1)
    // a stranger sees none
    const stranger = await makeAdult(h.sql)
    expect((await liveParticipant().listThreads(stranger, NOW)).items.length).toBe(0)
  })

  test('reading a thread carries the visibility header AND the who-can-read statement', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    const read = await liveParticipant().readThread(threadId, w.student, NOW)
    expect(read.visibilityHeader).toBe(DM_VISIBILITY_HEADER_TEXT)
    expect(read.whoCanRead).toBe(DM_WHO_CAN_READ_TEXT)
    expect(read.messages.map((m) => m.body)).toContain('hello (synthetic)')
    expect(read.threadId).toBe(threadId)
  })

  test('a non-party read is an opaque 403', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    const stranger = await makeAdult(h.sql)
    await expect(liveParticipant().readThread(threadId, stranger, NOW)).rejects.toBeInstanceOf(Forbidden)
  })

  test('a guardian under an ACTIVE suspension is excluded while the participants + officer still read', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    // guardian reads before suspension
    expect((await liveParticipant().readThread(threadId, w.guardian, NOW)).messages.length).toBe(1)
    const { suspensionId } = await withRequest(() =>
      liveSuspension().initiate({ studentAccountId: w.student, reason: 'synthetic', chapterId: w.chapter }, officerCtx(w), NOW),
    )
    await withRequest(() => liveSuspension().acknowledge(suspensionId, w.directorCtx, NOW))
    await expect(liveParticipant().readThread(threadId, w.guardian, NOW)).rejects.toBeInstanceOf(Forbidden)
    expect((await liveParticipant().readThread(threadId, w.student, NOW)).messages.length).toBe(1)
    expect((await liveParticipant().readThread(threadId, w.mentorAccount, NOW)).messages.length).toBe(1)
    expect((await liveParticipant().readThread(threadId, w.safetyOfficer, NOW)).messages.length).toBe(1)
  })

  test('with the global flag OFF list + read refuse (dark)', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    await expect(darkParticipant().listThreads(w.student, NOW)).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
    await expect(darkParticipant().readThread(threadId, w.student, NOW)).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
  })
})

// ===========================================================================
describe('first-open onboarding (design C.12)', () => {
  test('the content returns and starts un-acknowledged; ack records once and flips the state', async () => {
    const w = await fullyProvisioned()
    const before = await liveParticipant().getOnboarding(w.student)
    expect(before.content).toEqual(DM_ONBOARDING)
    expect(before.acknowledged).toBe(false)
    expect(before.acknowledgedAt).toBeNull()

    const ack = await withRequest(() => liveParticipant().acknowledgeOnboarding(studentCtx(w), NOW))
    expect(ack.acknowledged).toBe(true)
    expect(ack.acknowledgedAt).toBeTruthy()

    const after = await liveParticipant().getOnboarding(w.student)
    expect(after.acknowledged).toBe(true)
    expect(after.acknowledgedAt).toBeTruthy()

    // idempotent: a second ack does not create a duplicate ack row
    await withRequest(() => liveParticipant().acknowledgeOnboarding(studentCtx(w), NOW))
    const rows = await h.sql`select count(*) as c from dm_onboarding_ack where student_account_id = ${w.student}`
    expect(Number(rows[0]!.c)).toBe(1)
  })

  test('with the global flag OFF onboarding refuses (dark)', async () => {
    const w = await fullyProvisioned()
    await expect(darkParticipant().getOnboarding(w.student)).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
    await expect(
      withRequest(() => darkParticipant().acknowledgeOnboarding(studentCtx(w), NOW)),
    ).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
  })
})

// ===========================================================================
describe('"something feels off" report (design C.12)', () => {
  test('a student report writes the report + a dm.student_report ledger entry and produces NO mentor-visible signal', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    const flagsBefore = await h.sql`select count(*) as c from dm_flag where thread_id = ${threadId}`
    const msgsBefore = await h.sql`select count(*) as c from dm_message where thread_id = ${threadId}`

    const { reportId } = await withRequest(() =>
      liveParticipant().reportThread(threadId, studentCtx(w), { note: 'uncomfortable (synthetic)' }, NOW),
    )
    expect(reportId).toBeTruthy()

    const [rep] = await h.sql`select reporter_account_id, note from dm_report where id = ${reportId}`
    expect(rep!.reporter_account_id).toBe(w.student)

    // routes to the safety officer via the monitoring ledger
    const ledger = await h.sql`select 1 from access_ledger where event = 'dm.student_report'`
    expect(ledger.length).toBeGreaterThan(0)

    // NO mentor-visible signal: no new dm_flag, no new dm_message, nothing on the thread
    const flagsAfter = await h.sql`select count(*) as c from dm_flag where thread_id = ${threadId}`
    const msgsAfter = await h.sql`select count(*) as c from dm_message where thread_id = ${threadId}`
    expect(Number(flagsAfter[0]!.c)).toBe(Number(flagsBefore[0]!.c))
    expect(Number(msgsAfter[0]!.c)).toBe(Number(msgsBefore[0]!.c))
    // the mentor's read of the thread shows only the original message
    const mentorRead = await liveParticipant().readThread(threadId, w.mentorAccount, NOW)
    expect(mentorRead.messages.length).toBe(1)
  })

  test('the report surfaces to the safety officer’s view; a non-officer cannot read it', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    await withRequest(() => liveParticipant().reportThread(threadId, studentCtx(w), {}, NOW))
    const officerView = await withRequest(() => liveParticipant().listReports(w.chapter, officerCtx(w), NOW))
    expect(officerView.items.length).toBe(1)
    expect(officerView.items[0]!.threadId).toBe(threadId)
    // a mentor cannot read the officer report view (opaque 403 from dm.oversee)
    await expect(
      withRequest(() => liveParticipant().listReports(w.chapter, mentorCtx(w), NOW)),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('a non-party cannot file a report (opaque 403)', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    const strangerStudent = await makeMinor(h.sql)
    const otherChapterMem = mem('student', w.chapter)
    const strangerCtx = baseCtx(strangerStudent, NOW, [otherChapterMem])
    await expect(
      withRequest(() => liveParticipant().reportThread(threadId, strangerCtx, {}, NOW)),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('with the global flag OFF the report refuses (dark)', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    await expect(
      withRequest(() => darkParticipant().reportThread(threadId, studentCtx(w), {}, NOW)),
    ).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
  })
})

// ===========================================================================
describe('guardian read + digest (design C.10)', () => {
  test('a verified guardian reads their child’s threads (decrypted, with headers)', async () => {
    const w = await fullyProvisioned()
    await send(w, 'hello (synthetic)')
    const res = await liveGuardianDm().listChildThreads(w.guardian, w.student, NOW)
    expect(res.items.length).toBe(1)
    expect(res.items[0]!.visibilityHeader).toBe(DM_VISIBILITY_HEADER_TEXT)
    expect(res.items[0]!.whoCanRead).toBe(DM_WHO_CAN_READ_TEXT)
    expect(res.items[0]!.messages.map((m) => m.body)).toContain('hello (synthetic)')
  })

  test('a guardian cannot read another child’s threads (opaque 403)', async () => {
    const w = await fullyProvisioned()
    await send(w, 'hello (synthetic)')
    const otherChild = await makeMinor(h.sql)
    await expect(
      liveGuardianDm().listChildThreads(w.guardian, otherChild, NOW),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('a guardian under an ACTIVE suspension is excluded from the read', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'hello (synthetic)')
    const { suspensionId } = await withRequest(() =>
      liveSuspension().initiate({ studentAccountId: w.student, reason: 'synthetic', chapterId: w.chapter }, officerCtx(w), NOW),
    )
    await withRequest(() => liveSuspension().acknowledge(suspensionId, w.directorCtx, NOW))
    const res = await liveGuardianDm().listChildThreads(w.guardian, w.student, NOW)
    // the suspended guardian sees the thread excluded
    expect(res.items.find((i) => i.threadId === threadId)).toBeUndefined()
  })

  test('the weekly digest aggregates thread + message counts and flags for that child only', async () => {
    const w = await fullyProvisioned()
    await send(w, 'ordinary one (synthetic)')
    await send(w, 'keep this between us (synthetic)') // 1 flag (secrecy_framing)
    const digest = await liveGuardianDm().childDigest(w.guardian, w.student, NOW)
    expect(digest.childAccountId).toBe(w.student)
    expect(digest.threadCount).toBe(1)
    expect(digest.messageCount).toBe(2)
    expect(digest.flagCount).toBeGreaterThanOrEqual(1)
    expect(digest.flagsByCategory.secrecy_framing).toBeGreaterThanOrEqual(1)
  })

  test('a guardian cannot get a digest for another child (opaque 403)', async () => {
    const w = await fullyProvisioned()
    const otherChild = await makeMinor(h.sql)
    await expect(
      liveGuardianDm().childDigest(w.guardian, otherChild, NOW),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('with the global flag OFF guardian read + digest refuse (dark)', async () => {
    const w = await fullyProvisioned()
    await send(w, 'hello (synthetic)')
    const dark = new DmGuardianDmService({ sql: h.sql }) // flag off
    await expect(dark.listChildThreads(w.guardian, w.student, NOW)).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
    await expect(dark.childDigest(w.guardian, w.student, NOW)).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
  })
})

// ===========================================================================
describe('read of an unknown thread', () => {
  test('readThread of a missing thread is a 404-shaped not-found', async () => {
    await fullyProvisioned()
    const missing = '00000000-0000-0000-0000-000000000000'
    await expect(liveParticipant().readThread(missing, missing, NOW)).rejects.toBeInstanceOf(DmThreadNotFoundError)
  })
})
