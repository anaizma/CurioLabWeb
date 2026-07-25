// -------------------------------------------------------------------------
// STUDENT NOTIFICATION-EMAIL SETTINGS — the PRIMARY/SECONDARY self-service model
// (DARK, counsel-gated). Embedded Postgres, synthetic data only, deterministic
// clocks. A refinement of the committed feature: the student-facing settings
// write (set/update/clear the PRIMARY own email) + the read model (primary +
// secondary) the settings screen renders.
//
//   PRIMARY   = the student's OWN notification_email (student-editable, gated).
//   SECONDARY = the LIVE first verified-guardian email (never student-editable).
//
// The write succeeds ONLY when ALL hold: the global flag is on, the student is
// 13+ (age from DOB), an active student_notification_email grant is on file, AND
// the caller is the student acting on their OWN account (scope `own`). Any other
// case is an opaque refusal; with the flag off the whole feature is inert.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, withRequest, Forbidden } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import type { AuthContext } from '@curiolab/core'
import {
  ConsentGrantService,
  StudentNotificationSettingsService,
  InvalidNotificationEmailError,
  StudentNotificationEmailNotAuthorizedError,
  defaultConfig,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const NOW = new Date('2026-07-25T12:00:00Z')
const flagOn = { ...defaultConfig, studentNotificationEmailEnabled: true }
const flagOff = { ...defaultConfig, studentNotificationEmailEnabled: false }

const DOB_15 = '2011-01-01' // 15 at NOW
const DOB_UNDER_13 = '2020-06-01' // ~6 at NOW

const CHAP = 'chapter-synthetic'
const uniqEmail = (p: string) => `${p}-${randomUUID().slice(0, 8)}@example.test`

function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, NOW), guardianOf: children }
}

/** A student acting on their OWN account: an in-force student membership + age. */
function studentCtx(studentId: string, age = 15): AuthContext {
  const c = baseCtx(studentId, NOW, [mem('student', CHAP)])
  return {
    ...c,
    account: { ...c.account, age, maturation_state: age < 18 ? 'minor' : 'self_managed' },
  }
}

/** Insert a VERIFIED guardianship edge (guardian -> student). */
async function verifiedGuardian(studentId: string, email: string): Promise<string> {
  const guardian = await makeAdult(h.sql, { email })
  await h.sql`
    insert into guardianship (
      guardian_account_id, student_account_id, relationship, status,
      verification_method, verified_by, source_ref, verified_at
    ) values (
      ${guardian}, ${studentId}, 'guardian', 'verified',
      'signed_form_match', ${guardian}, ${randomUUID()}, now()
    )
  `
  return guardian
}

/** Capture an active student_notification_email grant for a 13+ student. */
async function captureGrant(studentId: string, guardianId: string) {
  const svc = new ConsentGrantService({ sql: h.sql, authorize })
  await withRequest(async () => {
    await svc.captureGrant(studentId, 'student_notification_email', guardianCtx(guardianId, [studentId]), {
      method: 'signed_form',
      evidenceArtifactRef: 'artifact://synthetic-signed-form',
      now: NOW,
    })
  })
}

async function notifEmail(studentId: string): Promise<string | null> {
  const [row] = await h.sql`select notification_email from account where id = ${studentId}`
  return (row!.notification_email as string | null) ?? null
}

function settingsSvc(config = flagOn) {
  return new StudentNotificationSettingsService({ sql: h.sql, authorize, config })
}

// ---------------------------------------------------------------------------
describe('setPrimaryEmail — the student-facing settings write', () => {
  test('REFUSED when the flag is OFF (even with an active grant + 13+), field stays null', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, uniqEmail('g'))
    await captureGrant(student, guardian)
    await expect(
      withRequest(() => settingsSvc(flagOff).setPrimaryEmail('kid@example.test', studentCtx(student), { now: NOW })),
    ).rejects.toBeInstanceOf(StudentNotificationEmailNotAuthorizedError)
    expect(await notifEmail(student)).toBeNull()
  })

  test('REFUSED for a student UNDER 13 (flag on)', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_UNDER_13 })
    await verifiedGuardian(student, uniqEmail('g'))
    await expect(
      withRequest(() => settingsSvc(flagOn).setPrimaryEmail('kid@example.test', studentCtx(student, 6), { now: NOW })),
    ).rejects.toBeInstanceOf(StudentNotificationEmailNotAuthorizedError)
    expect(await notifEmail(student)).toBeNull()
  })

  test('REFUSED when there is NO active grant (flag on, 13+)', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    await verifiedGuardian(student, uniqEmail('g'))
    await expect(
      withRequest(() => settingsSvc(flagOn).setPrimaryEmail('kid@example.test', studentCtx(student), { now: NOW })),
    ).rejects.toBeInstanceOf(StudentNotificationEmailNotAuthorizedError)
    expect(await notifEmail(student)).toBeNull()
  })

  test('REFUSED for a NON-student actor (not own account → Forbidden 403)', async () => {
    const staff = await makeAdult(h.sql)
    const staffCtx = baseCtx(staff, NOW, [mem('chapter_director', CHAP)])
    await expect(
      withRequest(() => settingsSvc(flagOn).setPrimaryEmail('kid@example.test', staffCtx, { now: NOW })),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('SUCCEEDS for a 13+ OWN student with an active grant + flag on; stores on the account', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, uniqEmail('g'))
    await captureGrant(student, guardian)
    const kid = 'kid@example.test'
    const out = await withRequest(() =>
      settingsSvc(flagOn).setPrimaryEmail(kid, studentCtx(student), { now: NOW }),
    )
    expect(await notifEmail(student)).toBe(kid)
    expect(out.primary.email).toBe(kid)
    expect(out.primary.isOwn).toBe(true)
    // The login identity is untouched: no email, username preserved.
    const [acct] = await h.sql`select email, username from account where id = ${student}`
    expect(acct!.email).toBeNull()
    expect(acct!.username).not.toBeNull()
  })

  test('CLEARING (null) reverts to parent-only', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const gEmail = uniqEmail('g')
    const guardian = await verifiedGuardian(student, gEmail)
    await captureGrant(student, guardian)
    await withRequest(() => settingsSvc(flagOn).setPrimaryEmail('kid@example.test', studentCtx(student), { now: NOW }))
    expect(await notifEmail(student)).toBe('kid@example.test')
    // Now clear it.
    const out = await withRequest(() =>
      settingsSvc(flagOn).setPrimaryEmail(null, studentCtx(student), { now: NOW }),
    )
    expect(await notifEmail(student)).toBeNull()
    expect(out.primary.isOwn).toBe(false)
    expect(out.primary.email).toBe(gEmail)
    expect(out.secondary.email).toBeNull()
  })

  test('a MALFORMED email is refused (400) and the field is unchanged', async () => {
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, uniqEmail('g'))
    await captureGrant(student, guardian)
    await expect(
      withRequest(() => settingsSvc(flagOn).setPrimaryEmail('not-an-email', studentCtx(student), { now: NOW })),
    ).rejects.toBeInstanceOf(InvalidNotificationEmailError)
    expect(await notifEmail(student)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('viewNotificationSettings — the read model for the settings screen', () => {
  test('with an OWN primary set → primary {own, isOwn:true, editable:true}, secondary {guardian, editable:false}', async () => {
    const gEmail = uniqEmail('g')
    const kid = uniqEmail('kid')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, gEmail)
    await captureGrant(student, guardian)
    await h.sql`update account set notification_email = ${kid} where id = ${student}`
    const out = await withRequest(() => settingsSvc(flagOn).viewSettings(studentCtx(student), { now: NOW }))
    expect(out.primary).toEqual({ email: kid, isOwn: true, editable: true })
    expect(out.secondary).toEqual({ email: gEmail, editable: false })
  })

  test('WITHOUT an own primary (eligible, not set) → primary {guardian, isOwn:false, editable:true}, secondary {null}', async () => {
    const gEmail = uniqEmail('g')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, gEmail)
    await captureGrant(student, guardian)
    const out = await withRequest(() => settingsSvc(flagOn).viewSettings(studentCtx(student), { now: NOW }))
    expect(out.primary).toEqual({ email: gEmail, isOwn: false, editable: true })
    expect(out.secondary).toEqual({ email: null, editable: false })
  })

  test('flag OFF → parent-only shape, no own-email path (editable:false)', async () => {
    const gEmail = uniqEmail('g')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_15 })
    const guardian = await verifiedGuardian(student, gEmail)
    await captureGrant(student, guardian)
    // Even a stored email must not surface with the flag off.
    await h.sql`update account set notification_email = ${uniqEmail('kid')} where id = ${student}`
    const out = await withRequest(() => settingsSvc(flagOff).viewSettings(studentCtx(student), { now: NOW }))
    expect(out.primary).toEqual({ email: gEmail, isOwn: false, editable: false })
    expect(out.secondary).toEqual({ email: null, editable: false })
  })

  test('UNDER 13 (flag on) → parent-only shape, no own-email path (editable:false)', async () => {
    const gEmail = uniqEmail('g')
    const student = await makeMinor(h.sql, { dateOfBirth: DOB_UNDER_13 })
    await verifiedGuardian(student, gEmail)
    await h.sql`update account set notification_email = ${uniqEmail('kid')} where id = ${student}`
    const out = await withRequest(() => settingsSvc(flagOn).viewSettings(studentCtx(student, 6), { now: NOW }))
    expect(out.primary).toEqual({ email: gEmail, isOwn: false, editable: false })
    expect(out.secondary).toEqual({ email: null, editable: false })
  })

  test('a NON-student actor is denied (Forbidden 403)', async () => {
    const staff = await makeAdult(h.sql)
    const staffCtx = baseCtx(staff, NOW, [mem('chapter_director', CHAP)])
    await expect(
      withRequest(() => settingsSvc(flagOn).viewSettings(staffCtx, { now: NOW })),
    ).rejects.toBeInstanceOf(Forbidden)
  })
})
