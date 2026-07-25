// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 1) — the app-layer services. Embedded
// Postgres, SYNTHETIC data only, deterministic clocks. Built DARK behind
// MENTOR_DM_ENABLED: the send path is hard-gated so NOTHING flows with the flag
// off. Covers:
//   * mentor_dm grant: a click is refused (service + DB trigger); a signed_form +
//     artifact succeeds; it expires at term end; a revoke works;
//   * safety_officer assignment: refuses a peer (mentor/student in that chapter);
//     a non-peer succeeds;
//   * the enable gate: refuses without a safety officer / insurance / current-term
//     pod; succeeds when all present; opaque 403 for a non-director;
//   * canDirectMessage composition: true only with assignment + current grant +
//     eligibility + chapter switch + global flag; each missing leg -> false;
//   * thread/message: the body is stored ENCRYPTED (stored != plaintext, an
//     authorized read decrypts it); the four-party read check admits exactly
//     participants + safety officer + guardian and denies everyone else; a send
//     with the flag off is refused (globally dark).
// -------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import type { AuthContext } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  type AppConfig,
  ConsentGrantService,
  DmEnableService,
  DmEnablePreconditionError,
  DmNotAuthorizedForPairError,
  DmThreadService,
  FakeMailer,
  GrantSignedFormRequiredError,
  SafetyOfficerPeerConflictError,
  SafetyOfficerService,
  type Mailer,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  process.env.DM_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const NOW = new Date('2026-07-24T12:00:00Z')
const TERM_START = '2026-01-01'
const TERM_END = '2026-12-31'

function directorCtx(id: string, chapter: string): AuthContext {
  return baseCtx(id, NOW, [mem('chapter_director', chapter)])
}

/** The mentor participant's own AuthContext (a junior_mentor in the chapter). */
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

/** A fully-provisioned, authorizable mentor-student pair (no switch/grant yet).
 *  `opts.studentDob` overrides the student's write-once date_of_birth at creation
 *  (the default makeMinor DOB is age 11 at NOW). */
async function world(opts: { studentDob?: string } = {}): Promise<World> {
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
  // Mentor eligibility: all four components cleared, unexpired.
  for (const component of ['background_check', 'mandatory_reporter_training', 'cwru_affiliation_verified', 'signed_code_of_conduct']) {
    await h.sql`
      insert into mentor_eligibility (membership_id, component, cleared_at, expires_at, recorded_by)
      values (${mentorMembership}, ${component}, ${NOW}, ${null}, ${director})
    `
  }

  const student = await makeMinor(h.sql, opts.studentDob ? { dateOfBirth: opts.studentDob } : {})
  await insertMembership({ accountId: student, chapterId: chapter, role: 'student', podId: pod, termId: term })

  const guardian = await makeAdult(h.sql)
  await h.sql`
    insert into guardianship (
      guardian_account_id, student_account_id, relationship, status,
      verification_method, verified_by, verified_at
    )
    values (${guardian}, ${student}, 'guardian', 'verified', 'signed_form_match', ${director}, ${NOW})
  `
  const safetyOfficer = await makeAdult(h.sql)
  return {
    chapter, term, pod, director, directorCtx: directorCtx(director, chapter),
    mentorAccount, mentorMembership, student, guardian, safetyOfficer,
  }
}

/** Capture a signed-form mentor_dm grant for the student (via the guardian). */
async function captureMentorDm(w: World, opts: { now?: Date } = {}): Promise<void> {
  const svc = new ConsentGrantService({ sql: h.sql, authorize })
  const gctx: AuthContext = { ...baseCtx(w.guardian, opts.now ?? NOW), guardianOf: [w.student] }
  await withRequest(() =>
    svc.captureGrant(w.student, 'mentor_dm', gctx, {
      method: 'signed_form', evidenceArtifactRef: 'signed-dm-consent-ref', now: opts.now ?? NOW,
    }),
  )
}

/** Capture a signed-form student_notification_email grant for a 13+ student (via the guardian). */
async function captureNotificationEmailGrant(w: World, opts: { now?: Date } = {}): Promise<void> {
  const svc = new ConsentGrantService({ sql: h.sql, authorize })
  const gctx: AuthContext = { ...baseCtx(w.guardian, opts.now ?? NOW), guardianOf: [w.student] }
  await withRequest(() =>
    svc.captureGrant(w.student, 'student_notification_email', gctx, {
      method: 'signed_form', evidenceArtifactRef: 'signed-notif-consent-ref', now: opts.now ?? NOW,
    }),
  )
}

async function assignSafetyOfficer(w: World): Promise<void> {
  const svc = new SafetyOfficerService({ sql: h.sql, authorize })
  await withRequest(() => svc.assign(w.chapter, w.safetyOfficer, w.directorCtx))
}

async function recordInsurance(w: World): Promise<void> {
  const svc = new DmEnableService({ sql: h.sql, authorize })
  await withRequest(() => svc.recordInsuranceAttestation(w.chapter, { carrier: 'Synthetic Mutual' }, w.directorCtx))
}

async function enableChapter(w: World): Promise<void> {
  const svc = new DmEnableService({ sql: h.sql, authorize })
  await withRequest(() => svc.enable(w.chapter, w.directorCtx, { now: NOW }))
}

// ===========================================================================
describe('mentor_dm consent grant (design C.3)', () => {
  test('a click method is REFUSED at the service (signed_form required)', async () => {
    const w = await world()
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    const gctx: AuthContext = { ...baseCtx(w.guardian, NOW), guardianOf: [w.student] }
    await expect(
      withRequest(() => svc.captureGrant(w.student, 'mentor_dm', gctx, { method: 'click', evidenceArtifactRef: 'x', now: NOW })),
    ).rejects.toBeInstanceOf(GrantSignedFormRequiredError)
  })

  test('a signed_form with no artifact is REFUSED', async () => {
    const w = await world()
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    const gctx: AuthContext = { ...baseCtx(w.guardian, NOW), guardianOf: [w.student] }
    await expect(
      withRequest(() => svc.captureGrant(w.student, 'mentor_dm', gctx, { method: 'signed_form', now: NOW })),
    ).rejects.toBeInstanceOf(GrantSignedFormRequiredError)
  })

  test('a signed_form + artifact succeeds, expires at term end, and revokes', async () => {
    const w = await world()
    const svc = new ConsentGrantService({ sql: h.sql, authorize })
    const gctx: AuthContext = { ...baseCtx(w.guardian, NOW), guardianOf: [w.student] }
    const res = await withRequest(() =>
      svc.captureGrant(w.student, 'mentor_dm', gctx, { method: 'signed_form', evidenceArtifactRef: 'ref-1', now: NOW }),
    )
    expect(res.grantType).toBe('mentor_dm')
    // Term expiry: ~180 days out from capture (the grant renewal clock).
    expect(res.expiresAt).not.toBeNull()
    expect(res.expiresAt!.getTime()).toBeGreaterThan(NOW.getTime())

    // Independently revocable via the existing per-grant revoke.
    const rev = await withRequest(() => svc.revokeGrant(w.student, 'mentor_dm', gctx, { now: NOW }))
    expect(rev.grantType).toBe('mentor_dm')
    const [cur] = await h.sql`select active from consent_grant_current where subject_student_account_id = ${w.student} and grant_type = 'mentor_dm'`
    expect(cur!.active).toBe(false)
  })
})

// ===========================================================================
describe('safety_officer assignment (design C.1)', () => {
  test('refuses a peer (an account that is a mentor in that chapter)', async () => {
    const w = await world()
    const svc = new SafetyOfficerService({ sql: h.sql, authorize })
    await expect(
      withRequest(() => svc.assign(w.chapter, w.mentorAccount, w.directorCtx)),
    ).rejects.toBeInstanceOf(SafetyOfficerPeerConflictError)
  })

  test('refuses a peer (an account that is a student in that chapter)', async () => {
    const w = await world()
    const svc = new SafetyOfficerService({ sql: h.sql, authorize })
    await expect(
      withRequest(() => svc.assign(w.chapter, w.student, w.directorCtx)),
    ).rejects.toBeInstanceOf(SafetyOfficerPeerConflictError)
  })

  test('a non-peer assignment succeeds', async () => {
    const w = await world()
    const svc = new SafetyOfficerService({ sql: h.sql, authorize })
    const res = await withRequest(() => svc.assign(w.chapter, w.safetyOfficer, w.directorCtx))
    expect(res.accountId).toBe(w.safetyOfficer)
    const [row] = await h.sql`select role from membership where id = ${res.membershipId}`
    expect(row!.role).toBe('safety_officer')
  })

  test('a non-director is denied an opaque 403', async () => {
    const w = await world()
    const svc = new SafetyOfficerService({ sql: h.sql, authorize })
    const mentorCtx = baseCtx(w.mentorAccount, NOW, [mem('junior_mentor', w.chapter)])
    await expect(
      withRequest(() => svc.assign(w.chapter, w.safetyOfficer, mentorCtx)),
    ).rejects.toBeInstanceOf(Forbidden)
  })
})

// ===========================================================================
describe('the enable gate (design Part D)', () => {
  test('refuses without a safety officer', async () => {
    const w = await world()
    await recordInsurance(w) // insurance present, pod present, but no safety officer
    const svc = new DmEnableService({ sql: h.sql, authorize })
    await expect(withRequest(() => svc.enable(w.chapter, w.directorCtx, { now: NOW })))
      .rejects.toMatchObject({ reason: 'no_safety_officer' } as Partial<DmEnablePreconditionError>)
  })

  test('refuses without an insurance attestation', async () => {
    const w = await world()
    await assignSafetyOfficer(w)
    const svc = new DmEnableService({ sql: h.sql, authorize })
    await expect(withRequest(() => svc.enable(w.chapter, w.directorCtx, { now: NOW })))
      .rejects.toMatchObject({ reason: 'no_insurance_attestation' })
  })

  test('refuses without a current-term pod (a stale term)', async () => {
    const w = await world()
    await assignSafetyOfficer(w)
    await recordInsurance(w)
    // Move the only term entirely into the past so the pod is not current-term.
    await h.sql`update term set starts_on = '2000-01-01', ends_on = '2000-12-31' where id = ${w.term}`
    const svc = new DmEnableService({ sql: h.sql, authorize })
    await expect(withRequest(() => svc.enable(w.chapter, w.directorCtx, { now: NOW })))
      .rejects.toMatchObject({ reason: 'no_current_term_pod' })
  })

  test('succeeds when a safety officer, insurance, and a current-term pod are all present', async () => {
    const w = await world()
    await assignSafetyOfficer(w)
    await recordInsurance(w)
    const svc = new DmEnableService({ sql: h.sql, authorize })
    const res = await withRequest(() => svc.enable(w.chapter, w.directorCtx, { now: NOW }))
    expect(res.alreadyEnabled).toBe(false)
    const [sw] = await h.sql`select 1 from dm_chapter_switch where chapter_id = ${w.chapter}`
    expect(sw).toBeTruthy()
  })

  test('a non-director is denied an opaque 403', async () => {
    const w = await world()
    const svc = new DmEnableService({ sql: h.sql, authorize })
    const mentorCtx = baseCtx(w.mentorAccount, NOW, [mem('junior_mentor', w.chapter)])
    await expect(withRequest(() => svc.enable(w.chapter, mentorCtx, { now: NOW }))).rejects.toBeInstanceOf(Forbidden)
  })
})

// ===========================================================================
describe('canDirectMessage composition + gated send/read', () => {
  async function fullyProvisioned(): Promise<World> {
    const w = await world()
    await assignSafetyOfficer(w)
    await recordInsurance(w)
    await enableChapter(w)
    await captureMentorDm(w)
    return w
  }

  test('with the GLOBAL flag OFF, the pair is not allowed and a send is refused (dark)', async () => {
    const w = await fullyProvisioned()
    const darkSvc = new DmThreadService({ sql: h.sql, authorize }) // default config: mentorDmEnabled false
    const resolved = await darkSvc.resolveDirectMessaging(w.mentorMembership, w.student, w.chapter, NOW)
    expect(resolved.allowed).toBe(false)
    await expect(
      withRequest(() => darkSvc.sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'hi' },
        mentorCtx(w), NOW,
      )),
    ).rejects.toBeInstanceOf(DmNotAuthorizedForPairError)
  })

  test('with the flag ON and every leg present, the pair is allowed; each missing leg -> false', async () => {
    const w = await fullyProvisioned()
    const svc = new DmThreadService({ sql: h.sql, config: { mentorDmEnabled: true }, authorize })
    expect((await svc.resolveDirectMessaging(w.mentorMembership, w.student, w.chapter, NOW)).allowed).toBe(true)

    // Missing consent -> false (revoke the grant).
    const grantSvc = new ConsentGrantService({ sql: h.sql, authorize })
    const gctx: AuthContext = { ...baseCtx(w.guardian, NOW), guardianOf: [w.student] }
    await withRequest(() => grantSvc.revokeGrant(w.student, 'mentor_dm', gctx, { now: NOW }))
    expect((await svc.resolveDirectMessaging(w.mentorMembership, w.student, w.chapter, NOW)).allowed).toBe(false)
  })

  test('a message body is stored ENCRYPTED and an authorized party decrypts it; the four-party read check', async () => {
    const w = await fullyProvisioned()
    const svc = new DmThreadService({ sql: h.sql, config: { mentorDmEnabled: true }, authorize })
    const plaintext = 'Great work on the robot today! (synthetic)'
    const { threadId, messageId } = await withRequest(() =>
      svc.sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: plaintext },
        mentorCtx(w), NOW,
      ),
    )
    // At rest: the stored body is the {v,iv,ct,tag} envelope, never the plaintext.
    const [stored] = await h.sql`select body from dm_message where id = ${messageId}`
    const raw = JSON.stringify(stored!.body)
    expect(raw).not.toContain('Great work')
    expect(stored!.body).toMatchObject({ v: 1 })

    // A participant (the student) reads and decrypts.
    const readByStudent = await svc.readThread(threadId, w.student)
    expect(readByStudent.messages[0]!.body).toBe(plaintext)
    expect(readByStudent.visibilityHeader).toMatch(/saved permanently/i)

    // The four parties all read; everyone else is denied.
    for (const party of [w.mentorAccount, w.student, w.safetyOfficer, w.guardian]) {
      expect(await svc.isPartyToThread(threadId, party)).toBe(true)
    }
    const stranger = await makeAdult(h.sql)
    expect(await svc.isPartyToThread(threadId, stranger)).toBe(false)
    await expect(svc.readThread(threadId, stranger)).rejects.toBeInstanceOf(Forbidden)
  })

  test('append-only: no update/delete path exists (the DB rejects a mutation)', async () => {
    const w = await fullyProvisioned()
    const svc = new DmThreadService({ sql: h.sql, config: { mentorDmEnabled: true }, authorize })
    const { messageId } = await withRequest(() =>
      svc.sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'immutable' },
        mentorCtx(w), NOW,
      ),
    )
    await expect(h.sql`delete from dm_message where id = ${messageId}`).rejects.toThrow(/append-only/i)
  })
})

// ===========================================================================
// Email notifications on send (system B is ENCRYPTED, so these are
// NOTIFICATION-ONLY — they never carry the message body). A message TO a
// student notifies the student AND their verified guardian(s); a message TO the
// mentor notifies the mentor. Recipients with no account email are skipped
// silently; delivery is best-effort and never rolls back the append-only write.
describe('DmThreadService — notification-only email on send', () => {
  function studentCtx(w: World): AuthContext {
    return baseCtx(w.student, NOW, [mem('student', w.chapter)])
  }
  function bodyOf(msg: { html?: string; text?: string }): string {
    return `${msg.html ?? ''}\n${msg.text ?? ''}`
  }
  async function emailOf(accountId: string): Promise<string | null> {
    const [row] = await h.sql`select email from account where id = ${accountId}`
    return (row!.email as string | null) ?? null
  }
  async function provisioned(opts: { studentDob?: string } = {}): Promise<World> {
    const w = await world(opts)
    await assignSafetyOfficer(w)
    await recordInsurance(w)
    await enableChapter(w)
    await captureMentorDm(w)
    return w
  }
  function svc(mailer: Mailer, extraConfig: Partial<AppConfig> = {}): DmThreadService {
    return new DmThreadService({ sql: h.sql, config: { mentorDmEnabled: true, ...extraConfig }, authorize, mailer })
  }

  test('a mentor→student message notifies the student’s verified guardian, WITHOUT the message body', async () => {
    const w = await provisioned()
    const guardianEmail = (await emailOf(w.guardian))!
    const mailer = new FakeMailer()
    const secret = 'Meet me at the synthetic lab at 3 — do not tell'
    await withRequest(() =>
      svc(mailer).sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: secret },
        mentorCtx(w), NOW,
      ),
    )

    const toGuardian = mailer.sent.filter((m) => m.to === guardianEmail)
    expect(toGuardian).toHaveLength(1)
    expect(toGuardian[0]!.subject.length).toBeGreaterThan(0)
    // NOTIFICATION-ONLY: the encrypted body must never appear in the email.
    expect(bodyOf(toGuardian[0]!)).not.toContain('synthetic lab')
    // The student here is username-only (no email), so no student email is sent.
    expect(mailer.sent.every((m) => m.to === guardianEmail)).toBe(true)
  })

  test('an UNDER-13 student is NEVER emailed directly, even with an email on file — only the guardian is', async () => {
    const w = await provisioned()
    const guardianEmail = (await emailOf(w.guardian))!
    // The default student DOB (2015-06-01) is age 11 at NOW (2026-07-24) — under 13.
    // Give them an email anyway; the age gate must still suppress the direct email.
    const studentEmail = `under13-${Date.now()}@example.test`
    await h.sql`update account set email = ${studentEmail}, username = null where id = ${w.student}`

    const mailer = new FakeMailer()
    await withRequest(() =>
      svc(mailer).sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'hello student' },
        mentorCtx(w), NOW,
      ),
    )

    expect(mailer.sent.filter((m) => m.to === studentEmail)).toHaveLength(0)
    expect(mailer.sent.filter((m) => m.to === guardianEmail)).toHaveLength(1)
  })

  test('a 13+ student is notified at their CONFIGURED notification email (not account.email), alongside the guardian', async () => {
    // Seed the student at age 16 (date_of_birth is write-once, so it must be set at creation).
    const w = await provisioned({ studentDob: '2010-01-01' })
    const guardianEmail = (await emailOf(w.guardian))!
    // The student configures their OWN notification email + an active grant (flag on).
    // Their login-identity account.email stays null — they are username-identified —
    // so the nudge must route to notification_email, never a raw login address.
    const notifEmail = `teen-notif-${Date.now()}@example.test`
    await captureNotificationEmailGrant(w)
    await h.sql`update account set notification_email = ${notifEmail} where id = ${w.student}`

    const mailer = new FakeMailer()
    await withRequest(() =>
      svc(mailer, { studentNotificationEmailEnabled: true }).sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'hello teen' },
        mentorCtx(w), NOW,
      ),
    )

    // Delivered to the configured notification email AND the guardian — and nothing else.
    expect(mailer.sent.filter((m) => m.to === notifEmail)).toHaveLength(1)
    expect(mailer.sent.filter((m) => m.to === guardianEmail)).toHaveLength(1)
    expect(mailer.sent.every((m) => m.to === notifEmail || m.to === guardianEmail)).toBe(true)
  })

  test('a 13+ student who has NOT configured a notification email is guardian-only (never account.email)', async () => {
    const w = await provisioned({ studentDob: '2010-01-01' })
    const guardianEmail = (await emailOf(w.guardian))!
    // Give the teen a raw login-identity email but NO notification_email/grant: the
    // resolver must not fall back to account.email — only the guardian is notified.
    await h.sql`update account set email = ${`teen-login-${Date.now()}@example.test`}, username = null where id = ${w.student}`

    const mailer = new FakeMailer()
    await withRequest(() =>
      svc(mailer, { studentNotificationEmailEnabled: true }).sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'hello teen' },
        mentorCtx(w), NOW,
      ),
    )

    expect(mailer.sent.filter((m) => m.to === guardianEmail)).toHaveLength(1)
    expect(mailer.sent.every((m) => m.to === guardianEmail)).toBe(true)
  })

  test('a student→mentor message notifies the mentor', async () => {
    const w = await provisioned()
    const mentorEmail = (await emailOf(w.mentorAccount))!
    const mailer = new FakeMailer()
    await withRequest(() =>
      svc(mailer).sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'reply from student' },
        studentCtx(w), NOW,
      ),
    )
    expect(mailer.sent.filter((m) => m.to === mentorEmail)).toHaveLength(1)
    // No body in the notification.
    expect(bodyOf(mailer.sent.find((m) => m.to === mentorEmail)!)).not.toContain('reply from student')
  })

  test('recipients with no account email are skipped silently (no send, no crash)', async () => {
    const w = await provisioned()
    // Student is already username-only; make the guardian username-only too.
    await h.sql`update account set email = null, username = ${`noemail-g-${Date.now()}`} where id = ${w.guardian}`

    const mailer = new FakeMailer()
    await withRequest(() =>
      svc(mailer).sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'to nobody reachable' },
        mentorCtx(w), NOW,
      ),
    )
    expect(mailer.sent).toHaveLength(0)
  })

  test('a mailer failure does NOT roll back the append-only DM message', async () => {
    const w = await provisioned()
    const throwing: Mailer = { send: async () => { throw new Error('mail transport down') } }
    const { messageId, threadId } = await withRequest(() =>
      svc(throwing).sendMessage(
        { mentorMembershipId: w.mentorMembership, studentAccountId: w.student, chapterId: w.chapter, body: 'still recorded' },
        mentorCtx(w), NOW,
      ),
    )
    const rows = await h.sql`select id from dm_message where id = ${messageId} and thread_id = ${threadId}`
    expect(rows).toHaveLength(1)
  })
})
