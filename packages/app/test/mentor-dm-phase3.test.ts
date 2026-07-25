// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 3) — the DETECTION & OVERSIGHT layer,
// app services. Embedded Postgres, SYNTHETIC data only, deterministic clocks.
// Built DARK behind MENTOR_DM_ENABLED. Covers (design C.5–C.8, C.15):
//   * content-flag categories flag their representative phrases on a send (one
//     dm_flag per matched category; detail = KIND);
//   * the full-coverage reading queue (chapter-scoped, decrypted, flags pinned,
//     per-thread read/unread + the weekly-volume threshold flag); role/chapter 403s;
//   * read-receipts drive 100% coverage; the monitoring ledger logs officer +
//     guardian reads and has no update path; the quarterly report aggregates;
//   * the two-adult guardian-visibility suspension (reason required; inactive until
//     a non-mentor second adult acknowledges; guardian removed from the party-check
//     while active; 90-day auto-restore; reporter checkpoint returned + recorded);
//   * the mentor-departure freeze (rejects new sends, preserves reads, never deletes).
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
  DmNotAuthorizedForPairError,
  DmOversightService,
  DmSuspensionSecondAdultInvalidError,
  DmSuspensionReasonRequiredError,
  DmThreadFrozenError,
  DmThreadService,
  DmVisibilitySuspensionService,
  SafetyOfficerService,
  dmOversightReport,
  runDmFreezeOnDeparture,
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
const LATER_91D = new Date(NOW.getTime() + 91 * 24 * 60 * 60 * 1000)
const TERM_START = '2026-01-01'
const TERM_END = '2026-12-31'

function directorCtx(id: string, chapter: string): AuthContext {
  return baseCtx(id, NOW, [mem('chapter_director', chapter)])
}
function mentorCtx(w: World): AuthContext {
  return baseCtx(w.mentorAccount, NOW, [mem('junior_mentor', w.chapter)])
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
function liveOversight(config: Record<string, unknown> = {}): DmOversightService {
  return new DmOversightService({ sql: h.sql, config: { mentorDmEnabled: true, ...config }, authorize })
}
function liveSuspension(): DmVisibilitySuspensionService {
  return new DmVisibilitySuspensionService({ sql: h.sql, config: { mentorDmEnabled: true }, authorize })
}

async function send(w: World, body: string, now: Date = NOW, svc: DmThreadService = liveThread()) {
  return withRequest(() =>
    svc.sendMessage(
      { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body },
      mentorCtx(w), now,
    ),
  )
}

// ===========================================================================
describe('content-flag categories on a send (design C.5)', () => {
  test('a secrecy-framing send writes a secrecy_framing dm_flag (KIND detail, not raw)', async () => {
    const w = await fullyProvisioned()
    const { messageId } = await send(w, "keep this between us ok (synthetic)")
    const flags = await h.sql`select category, detail from dm_flag where message_id = ${messageId}`
    expect(flags.some((f) => f.category === 'secrecy_framing')).toBe(true)
    for (const f of flags) expect(String(f.detail)).not.toContain('between')
  })

  test('each new category flags its representative phrase; benign text does not', async () => {
    const w = await fullyProvisioned()
    const cases: Array<[string, string]> = [
      ['i can give you a ride to the mall (synthetic)', 'in_person_arrangement'],
      ['you are so beautiful (synthetic)', 'romantic_appearance'],
      ['are you ever home alone (synthetic)', 'home_life_probing'],
    ]
    for (const [body, cat] of cases) {
      const { messageId } = await send(w, body)
      const flags = await h.sql`select category from dm_flag where message_id = ${messageId}`
      expect(flags.some((f) => f.category === cat)).toBe(true)
    }
    const { messageId: benign } = await send(w, 'great job on the robot today (synthetic)')
    const none = await h.sql`select 1 from dm_flag where message_id = ${benign}`
    expect(none.length).toBe(0)
  })

  test('a send matching two categories writes one dm_flag per category', async () => {
    const w = await fullyProvisioned()
    const { messageId } = await send(w, "keep this between us — are you home alone (synthetic)")
    const flags = await h.sql`select category from dm_flag where message_id = ${messageId}`
    const cats = flags.map((f) => f.category).sort()
    expect(cats).toContain('secrecy_framing')
    expect(cats).toContain('home_life_probing')
  })
})

// ===========================================================================
describe('full-coverage reading queue (design C.6)', () => {
  test('returns the chapter’s messages chronologically, decrypted, flagged pinned', async () => {
    const w = await fullyProvisioned()
    await send(w, 'first ordinary message (synthetic)')
    await send(w, 'keep this between us (synthetic)') // flagged
    await send(w, 'third ordinary message (synthetic)')
    const q = await withRequest(() => liveOversight().readingQueue(w.chapter, officerCtx(w), NOW))
    expect(q.items.length).toBe(3)
    // decrypted bodies present
    expect(q.items.map((i) => i.body)).toContain('keep this between us (synthetic)')
    // flagged item pinned to the top
    expect(q.items[0]!.flagged).toBe(true)
    expect(q.items[0]!.body).toBe('keep this between us (synthetic)')
    // per-thread coverage present
    expect(q.threads.length).toBe(1)
    expect(q.threads[0]!.totalMessages).toBe(3)
    expect(q.threads[0]!.unreadMessages).toBe(3)
  })

  test('a non-safety-officer cannot call the queue (opaque 403)', async () => {
    const w = await fullyProvisioned()
    await send(w, 'msg (synthetic)')
    await expect(
      withRequest(() => liveOversight().readingQueue(w.chapter, mentorCtx(w), NOW)),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('another chapter’s officer sees nothing of this chapter (opaque 403)', async () => {
    const w = await fullyProvisioned()
    await send(w, 'msg (synthetic)')
    const otherOfficer = await makeAdult(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const otherCtx = baseCtx(otherOfficer, NOW, [mem('safety_officer', otherChapter)])
    await expect(
      withRequest(() => liveOversight().readingQueue(w.chapter, otherCtx, NOW)),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('the over/under weekly-volume threshold flag computes from the config', async () => {
    const w = await fullyProvisioned()
    await send(w, 'one (synthetic)')
    await send(w, 'two (synthetic)')
    const over = await withRequest(() => liveOversight({ dmFullReviewMaxWeeklyMessages: 1 }).readingQueue(w.chapter, officerCtx(w), NOW))
    expect(over.overFullReviewThreshold).toBe(true)
    const under = await withRequest(() => liveOversight({ dmFullReviewMaxWeeklyMessages: 999 }).readingQueue(w.chapter, officerCtx(w), NOW))
    expect(under.overFullReviewThreshold).toBe(false)
  })

  test('with the global flag OFF the queue refuses (dark)', async () => {
    const w = await fullyProvisioned()
    await send(w, 'msg (synthetic)')
    const dark = new DmOversightService({ sql: h.sql, authorize }) // flag off by default
    await expect(
      withRequest(() => dark.readingQueue(w.chapter, officerCtx(w), NOW)),
    ).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
  })
})

// ===========================================================================
describe('read-receipts + coverage (design C.6)', () => {
  test('marking a thread read records a receipt to the latest seq → 100% coverage', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'a (synthetic)')
    await send(w, 'b (synthetic)')
    const os = liveOversight()
    await withRequest(() => os.markThreadRead(threadId, officerCtx(w), NOW))
    const q = await withRequest(() => os.readingQueue(w.chapter, officerCtx(w), NOW))
    const cov = q.threads.find((t) => t.threadId === threadId)!
    expect(cov.readMessages).toBe(cov.totalMessages)
    expect(cov.unreadMessages).toBe(0)
  })
})

// ===========================================================================
describe('monitoring ledger + oversight of the officer (design C.7)', () => {
  test('an officer read and a guardian read each append a monitoring-ledger entry', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'msg (synthetic)')
    await withRequest(() => liveOversight().readingQueue(w.chapter, officerCtx(w), NOW))
    await liveThread().readThread(threadId, w.guardian, NOW)
    const officerReads = await h.sql`select 1 from access_ledger where event = 'dm.read_by_officer'`
    const guardianReads = await h.sql`select 1 from access_ledger where event = 'dm.read_by_guardian'`
    expect(officerReads.length).toBeGreaterThan(0)
    expect(guardianReads.length).toBeGreaterThan(0)
  })

  test('the monitoring ledger has no update or delete path (append-only)', async () => {
    const w = await fullyProvisioned()
    await send(w, 'msg (synthetic)')
    await withRequest(() => liveOversight().readingQueue(w.chapter, officerCtx(w), NOW))
    const [row] = await h.sql`select id from access_ledger where event = 'dm.read_by_officer' limit 1`
    await expect(h.sql`update access_ledger set event = 'x' where id = ${row!.id}`).rejects.toThrow(/append-only/i)
    await expect(h.sql`delete from access_ledger where id = ${row!.id}`).rejects.toThrow(/append-only/i)
  })

  test('the quarterly report aggregates coverage, flags + disposition, and suspensions for a window', async () => {
    const w = await fullyProvisioned()
    const { threadId, messageId } = await send(w, 'keep this between us (synthetic)') // 1 flag
    await send(w, 'ordinary (synthetic)')
    const os = liveOversight()
    await withRequest(() => os.markThreadRead(threadId, officerCtx(w), NOW))
    const [flag] = await h.sql`select id from dm_flag where message_id = ${messageId} limit 1`
    await withRequest(() => os.reviewFlag(flag!.id as string, 'benign', officerCtx(w), { now: NOW }))
    // dm_flag / dm_flag_review rows are stamped with the DB wall clock (their
    // created_at defaults to now()), whereas the messages above use the injected
    // synthetic NOW. A tight NOW±24h window therefore drops the flags/reviews once
    // the real clock drifts past it — a wall-clock-sensitive test. This report
    // exercises AGGREGATION, not tight windowing, so use a wide fixed window that
    // always spans both clocks. (A cleaner fix — stamping dm_flag/dm_flag_review
    // created_at from the injected now — needs a coordinated change to the flag
    // insert in mentor-dm.ts, currently owned by the email-notification work.)
    const from = new Date('2020-01-01T00:00:00Z')
    const to = new Date('2100-01-01T00:00:00Z')
    const rep = await dmOversightReport({ sql: h.sql, chapterId: w.chapter, from, to })
    expect(rep.totalMessages).toBe(2)
    expect(rep.readMessages).toBe(2)
    expect(rep.flagsRaised).toBeGreaterThanOrEqual(1)
    expect(rep.flagsReviewed).toBeGreaterThanOrEqual(1)
  })
})

// ===========================================================================
describe('two-adult guardian-visibility suspension (design C.8)', () => {
  async function threaded(w: World): Promise<string> {
    const { threadId } = await send(w, 'first message (synthetic)')
    return threadId
  }

  test('initiation requires a recorded reason', async () => {
    const w = await fullyProvisioned()
    await threaded(w)
    await expect(
      withRequest(() =>
        liveSuspension().initiate(
          { studentAccountId: w.student, reason: '  ', chapterId: w.chapter },
          officerCtx(w), NOW,
        ),
      ),
    ).rejects.toBeInstanceOf(DmSuspensionReasonRequiredError)
  })

  test('initiation surfaces + records the mandatory-reporter checkpoint', async () => {
    const w = await fullyProvisioned()
    await threaded(w)
    const res = await withRequest(() =>
      liveSuspension().initiate(
        { studentAccountId: w.student, reason: 'guardian may be the risk (synthetic)', chapterId: w.chapter },
        officerCtx(w), NOW,
      ),
    )
    expect(res.reporterCheckpoint.ohioHotline).toBeTruthy()
    const [row] = await h.sql`
      select reporter_checkpoint_ack from dm_visibility_suspension where id = ${res.suspensionId}
    `
    expect(row!.reporter_checkpoint_ack).toBe(true)
  })

  test('it does NOT take effect until a second adult acknowledges; then the guardian cannot read but the other three parties can', async () => {
    const w = await fullyProvisioned()
    const threadId = await threaded(w)
    // Before suspension: the guardian reads.
    expect((await liveThread().readThread(threadId, w.guardian, NOW)).messages.length).toBe(1)
    const { suspensionId } = await withRequest(() =>
      liveSuspension().initiate(
        { studentAccountId: w.student, reason: 'synthetic reason', chapterId: w.chapter },
        officerCtx(w), NOW,
      ),
    )
    // Initiated but NOT acknowledged → guardian STILL reads.
    expect((await liveThread().readThread(threadId, w.guardian, NOW)).messages.length).toBe(1)
    // A non-mentor second adult (the director) acknowledges.
    await withRequest(() => liveSuspension().acknowledge(suspensionId, w.directorCtx, NOW))
    // Now the guardian is NOT a party — read is refused.
    await expect(liveThread().readThread(threadId, w.guardian, NOW)).rejects.toBeInstanceOf(Forbidden)
    // The other three parties are unaffected.
    expect((await liveThread().readThread(threadId, w.student, NOW)).messages.length).toBe(1)
    expect((await liveThread().readThread(threadId, w.mentorAccount, NOW)).messages.length).toBe(1)
    expect((await liveThread().readThread(threadId, w.safetyOfficer, NOW)).messages.length).toBe(1)
  })

  test('a mentor cannot be the second adult (opaque 403 from the acknowledge floor)', async () => {
    const w = await fullyProvisioned()
    await threaded(w)
    const { suspensionId } = await withRequest(() =>
      liveSuspension().initiate(
        { studentAccountId: w.student, reason: 'synthetic reason', chapterId: w.chapter },
        officerCtx(w), NOW,
      ),
    )
    await expect(
      withRequest(() => liveSuspension().acknowledge(suspensionId, mentorCtx(w), NOW)),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('a director who ALSO holds a mentor membership is rejected as the second adult (not-a-mentor)', async () => {
    const w = await fullyProvisioned()
    await threaded(w)
    // give the director a mentor membership in the same chapter
    await insertMembership({ accountId: w.director, chapterId: w.chapter, role: 'senior_instructor' })
    const { suspensionId } = await withRequest(() =>
      liveSuspension().initiate(
        { studentAccountId: w.student, reason: 'synthetic reason', chapterId: w.chapter },
        officerCtx(w), NOW,
      ),
    )
    await expect(
      withRequest(() => liveSuspension().acknowledge(suspensionId, w.directorCtx, NOW)),
    ).rejects.toBeInstanceOf(DmSuspensionSecondAdultInvalidError)
  })

  test('the initiating officer cannot be their own second adult', async () => {
    const w = await fullyProvisioned()
    await threaded(w)
    const { suspensionId } = await withRequest(() =>
      liveSuspension().initiate(
        { studentAccountId: w.student, reason: 'synthetic reason', chapterId: w.chapter },
        officerCtx(w), NOW,
      ),
    )
    await expect(
      withRequest(() => liveSuspension().acknowledge(suspensionId, officerCtx(w), NOW)),
    ).rejects.toBeInstanceOf(DmSuspensionSecondAdultInvalidError)
  })

  test('it auto-restores after 90 days (deterministic now) — the guardian reads again', async () => {
    const w = await fullyProvisioned()
    const threadId = await threaded(w)
    const { suspensionId } = await withRequest(() =>
      liveSuspension().initiate(
        { studentAccountId: w.student, reason: 'synthetic reason', chapterId: w.chapter },
        officerCtx(w), NOW,
      ),
    )
    await withRequest(() => liveSuspension().acknowledge(suspensionId, w.directorCtx, NOW))
    // Active now: guardian blocked.
    await expect(liveThread().readThread(threadId, w.guardian, NOW)).rejects.toBeInstanceOf(Forbidden)
    // 91 days later the suspension has expired → guardian reads again.
    expect((await liveThread().readThread(threadId, w.guardian, LATER_91D)).messages.length).toBe(1)
  })

  test('every suspension step is logged in the monitoring ledger', async () => {
    const w = await fullyProvisioned()
    await threaded(w)
    const { suspensionId } = await withRequest(() =>
      liveSuspension().initiate(
        { studentAccountId: w.student, reason: 'synthetic reason', chapterId: w.chapter },
        officerCtx(w), NOW,
      ),
    )
    await withRequest(() => liveSuspension().acknowledge(suspensionId, w.directorCtx, NOW))
    const suspended = await h.sql`select 1 from access_ledger where event = 'dm.visibility_suspended'`
    const acked = await h.sql`select 1 from access_ledger where event = 'dm.visibility_acknowledged'`
    expect(suspended.length).toBeGreaterThan(0)
    expect(acked.length).toBeGreaterThan(0)
  })

  test('with the global flag OFF suspension refuses (dark)', async () => {
    const w = await fullyProvisioned()
    await threaded(w)
    const dark = new DmVisibilitySuspensionService({ sql: h.sql, authorize })
    await expect(
      withRequest(() =>
        dark.initiate({ studentAccountId: w.student, reason: 'r', chapterId: w.chapter }, officerCtx(w), NOW),
      ),
    ).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
  })
})

// ===========================================================================
describe('mentor-departure freeze (design C.15)', () => {
  test('a frozen thread rejects a new send, still reads, and is never deleted', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'before freeze (synthetic)')
    const res = await runDmFreezeOnDeparture(h.sql, {
      mentorMembershipId: w.mentorMembership,
      handoffDecision: 'safety_officer_conversation',
      reason: 'mentor removed (synthetic)',
      now: NOW,
    })
    expect(res.frozenThreadIds).toContain(threadId)
    // a new send is rejected even though the pair is still otherwise valid
    await expect(send(w, 'after freeze (synthetic)')).rejects.toBeInstanceOf(DmThreadFrozenError)
    // still reads for an authorized party
    expect((await liveThread().readThread(threadId, w.student, NOW)).messages.length).toBe(1)
    // never deleted
    const [t] = await h.sql`select 1 from dm_thread where id = ${threadId}`
    expect(t).toBeTruthy()
  })

  test('the handoff decision is recorded', async () => {
    const w = await fullyProvisioned()
    const { threadId } = await send(w, 'msg (synthetic)')
    await runDmFreezeOnDeparture(h.sql, {
      mentorMembershipId: w.mentorMembership,
      handoffDecision: 'successor_mentor',
      now: NOW,
    })
    const [f] = await h.sql`select handoff_decision from dm_thread_freeze where thread_id = ${threadId}`
    expect(f!.handoff_decision).toBe('successor_mentor')
  })
})
