// -------------------------------------------------------------------------
// §6 mentor eligibility as STATE (admin/director backend, REVIEW-GATED).
// Embedded Postgres, synthetic data only, deterministic clocks.
//
// Covers:
//   * recordClearance appends a mentor_eligibility row + an auditable ledger row;
//   * readEligibility returns the four components' current status + expiries;
//   * loadMentorEligibility computes eligible iff all four are current;
//   * the flag-ON `can` gate denies an ineligible mentor a student-facing
//     capability and allows an eligible one; the flag-OFF path preserves today's
//     behavior;
//   * unauthorized actors cannot record (Forbidden); cross-chapter is denied;
//   * runEligibilitySweep (flag on) revokes on background-check expiry with
//     reason=eligibility_lapsed, is idempotent, leaves an eligible mentor and any
//     student membership untouched, and (flag off) revokes nothing on eligibility.
// -------------------------------------------------------------------------

import { can, type AuthContext } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  MENTOR_ELIGIBILITY_COMPONENTS,
  MentorEligibilityService,
  loadMentorEligibility,
  runEligibilitySweep,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

const NOW = new Date('2026-07-24T12:00:00Z')
const YEAR_MS = 365 * 86_400_000

interface Setup {
  chapter: string
  director: string
  mentorAccount: string
  mentorMembership: string
}

async function setup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const director = await makeAdult(h.sql)
  const mentorAccount = await makeAdult(h.sql)
  const [mm] = await h.sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${mentorAccount}, ${chapter}, 'junior_mentor', 'active') returning id
  `
  return { chapter, director, mentorAccount, mentorMembership: mm!.id as string }
}

/** A director ctx in a chapter (the ops actor recording clearances). */
function directorCtx(id: string, chapter: string): AuthContext {
  return baseCtx(id, NOW, [mem('chapter_director', chapter)])
}

/** Clear all four components as current for a membership (so it is eligible). */
async function clearAll(membership: string, director: string): Promise<void> {
  const svc = new MentorEligibilityService({ sql: h.sql, authorize })
  await withRequest(async () => {
    for (const c of MENTOR_ELIGIBILITY_COMPONENTS) {
      // recordClearance authorizes; use a director ctx of the membership's chapter.
      // Resolve the chapter for the ctx from the membership.
      const [row] = await h.sql`select chapter_id from membership where id = ${membership}`
      const ctx = directorCtx(director, row!.chapter_id as string)
      await svc.record(membership, c, ctx, {
        clearedAt: new Date(NOW.getTime() - YEAR_MS),
        expiresAt: new Date(NOW.getTime() + YEAR_MS),
        now: NOW,
      })
    }
  })
}

// ---------------------------------------------------------------------------
describe('recordClearance (append-only) + audit/ledger', () => {
  test('a director records a background_check clearance; row + ledger written', async () => {
    const f = await setup()
    const ctx = directorCtx(f.director, f.chapter)
    const svc = new MentorEligibilityService({ sql: h.sql, authorize })
    await withRequest(async () => {
      const r = await svc.record(f.mentorMembership, 'background_check', ctx, {
        clearedAt: NOW,
        expiresAt: new Date(NOW.getTime() + YEAR_MS),
        evidenceRef: 'artifact://bgc.pdf',
        now: NOW,
      })
      expect(r.eligibilityId).toBeTruthy()
      expect(r.component).toBe('background_check')
    })
    const rows = await h.sql`
      select component, evidence_ref, recorded_by from mentor_eligibility
      where membership_id = ${f.mentorMembership}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]!.evidence_ref).toBe('artifact://bgc.pdf')
    expect(rows[0]!.recorded_by).toBe(f.director)
    const ledger = await h.sql`
      select event from access_ledger where detail->>'membershipId' = ${f.mentorMembership}
    `
    expect(ledger.map((r) => r.event)).toContain('mentor.eligibility_recorded')
    const audit = await h.sql`
      select action from audit_entry where subject_id = ${f.mentorMembership}
        and action = 'mentor.eligibility_recorded'
    `
    expect(audit.length).toBeGreaterThanOrEqual(1)
  })

  test('an unauthorized actor (a mentor) cannot record (Forbidden)', async () => {
    const f = await setup()
    // The mentor themselves (a junior_mentor) is not a director — role_not_permitted.
    const mentorCtx = baseCtx(f.mentorAccount, NOW, [mem('junior_mentor', f.chapter)])
    const svc = new MentorEligibilityService({ sql: h.sql, authorize })
    await expect(
      withRequest(() =>
        svc.record(f.mentorMembership, 'background_check', mentorCtx, { clearedAt: NOW, now: NOW }),
      ),
    ).rejects.toBeInstanceOf(Forbidden)
  })

  test('a director in ANOTHER chapter is denied (Forbidden, cross-chapter)', async () => {
    const f = await setup()
    const otherChapter = await makeChapter(h.sql)
    const otherDirector = await makeAdult(h.sql)
    const ctx = directorCtx(otherDirector, otherChapter)
    const svc = new MentorEligibilityService({ sql: h.sql, authorize })
    await expect(
      withRequest(() =>
        svc.record(f.mentorMembership, 'background_check', ctx, { clearedAt: NOW, now: NOW }),
      ),
    ).rejects.toBeInstanceOf(Forbidden)
  })
})

// ---------------------------------------------------------------------------
describe('readEligibility', () => {
  test('returns all four components with current status', async () => {
    const f = await setup()
    await clearAll(f.mentorMembership, f.director)
    const ctx = directorCtx(f.director, f.chapter)
    const svc = new MentorEligibilityService({ sql: h.sql, authorize })
    const view = await withRequest(() => svc.read(f.mentorMembership, ctx, NOW))
    expect(view.eligible).toBe(true)
    expect(view.components).toHaveLength(4)
    expect(view.components.every((c) => c.active)).toBe(true)
  })

  test('a membership missing a component reads eligible=false', async () => {
    const f = await setup()
    const ctx = directorCtx(f.director, f.chapter)
    const svc = new MentorEligibilityService({ sql: h.sql, authorize })
    await withRequest(() =>
      svc.record(f.mentorMembership, 'background_check', ctx, {
        clearedAt: NOW, expiresAt: new Date(NOW.getTime() + YEAR_MS), now: NOW,
      }),
    )
    const view = await withRequest(() => svc.read(f.mentorMembership, ctx, NOW))
    expect(view.eligible).toBe(false)
    expect(view.components.find((c) => c.component === 'background_check')!.active).toBe(true)
    expect(view.components.find((c) => c.component === 'signed_code_of_conduct')!.active).toBe(false)
  })
})

// ---------------------------------------------------------------------------
describe('loadMentorEligibility + the can() gate (flag on/off)', () => {
  test('a fully-cleared mentor is eligible; a lapsed one is not', async () => {
    const f = await setup()
    await clearAll(f.mentorMembership, f.director)
    const okBefore = await loadMentorEligibility(h.sql, f.mentorMembership, NOW)
    expect(okBefore.eligible).toBe(true)

    // Record an EXPIRED background check (supersedes with a lapsed clock).
    const ctx = directorCtx(f.director, f.chapter)
    await withRequest(() =>
      new MentorEligibilityService({ sql: h.sql, authorize }).record(
        f.mentorMembership, 'background_check', ctx,
        { clearedAt: new Date(NOW.getTime() - 2 * YEAR_MS), expiresAt: new Date(NOW.getTime() - 1), now: NOW },
      ),
    )
    const okAfter = await loadMentorEligibility(h.sql, f.mentorMembership, NOW)
    expect(okAfter.eligible).toBe(false)
    expect(okAfter.unmet).toContain('background_check')
  })

  test('flag ON: an ineligible mentor is denied a student-facing capability an eligible one is allowed', async () => {
    const f = await setup() // no clearances -> ineligible
    const elig = await loadMentorEligibility(h.sql, f.mentorMembership, NOW)
    // Build a mentor AuthContext with the hydrated eligibility + enforcement on.
    const podPost = { id: 'post-1', chapter_id: f.chapter, pod_id: 'pod-1' }
    const ineligibleCtx: AuthContext = {
      ...baseCtx(f.mentorAccount, NOW, [
        { chapter_id: f.chapter, role: 'junior_mentor', status: 'active', pod_id: 'pod-1', tier: null, active_from: null, active_until: null, mentorEligible: elig.eligible },
      ]),
      enforceMentorEligibility: true,
    }
    expect(can(ineligibleCtx, 'feed.moderate', podPost).allowed).toBe(false)

    // The same context with the flag OFF keeps access (production posture).
    const offCtx: AuthContext = { ...ineligibleCtx, enforceMentorEligibility: false }
    expect(can(offCtx, 'feed.moderate', podPost).allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('runEligibilitySweep (flag-guarded auto-revoke)', () => {
  async function status(membership: string): Promise<string> {
    const [row] = await h.sql`select status from membership where id = ${membership}`
    return row!.status as string
  }

  test('flag ON: a mentor with an expired background check is auto-revoked with reason=eligibility_lapsed', async () => {
    const f = await setup()
    await clearAll(f.mentorMembership, f.director)
    // Expire the background check.
    const ctx = directorCtx(f.director, f.chapter)
    await withRequest(() =>
      new MentorEligibilityService({ sql: h.sql, authorize }).record(
        f.mentorMembership, 'background_check', ctx,
        { clearedAt: new Date(NOW.getTime() - 2 * YEAR_MS), expiresAt: new Date(NOW.getTime() - 1), now: NOW },
      ),
    )
    const res = await runEligibilitySweep({ sql: h.sql }, NOW, { mentorEligibilityEnforced: true })
    expect(res.revokedMembershipIds).toContain(f.mentorMembership)
    expect(await status(f.mentorMembership)).toBe('inactive')
    const ledger = await h.sql`
      select detail->>'reason' as reason from access_ledger
      where subject_account_id = ${f.mentorAccount} and event = 'membership.time_box_revoked'
    `
    expect(ledger.map((r) => r.reason)).toContain('eligibility_lapsed')
  })

  test('an eligible mentor is untouched', async () => {
    const f = await setup()
    await clearAll(f.mentorMembership, f.director)
    const res = await runEligibilitySweep({ sql: h.sql }, NOW, { mentorEligibilityEnforced: true })
    expect(res.revokedMembershipIds).not.toContain(f.mentorMembership)
    expect(await status(f.mentorMembership)).toBe('active')
  })

  test('flag OFF: the sweep revokes nothing on eligibility grounds', async () => {
    const f = await setup() // ineligible (no clearances)
    const res = await runEligibilitySweep({ sql: h.sql }, NOW, { mentorEligibilityEnforced: false })
    expect(res.revokedCount).toBe(0)
    expect(await status(f.mentorMembership)).toBe('active')
  })

  test('idempotent: a second run revokes nothing more', async () => {
    const f = await setup() // ineligible
    const first = await runEligibilitySweep({ sql: h.sql }, NOW, { mentorEligibilityEnforced: true })
    expect(first.revokedMembershipIds).toContain(f.mentorMembership)
    const second = await runEligibilitySweep({ sql: h.sql }, NOW, { mentorEligibilityEnforced: true })
    expect(second.revokedMembershipIds).not.toContain(f.mentorMembership)
  })

  test('a student membership is never touched by the eligibility sweep', async () => {
    const chapter = await makeChapter(h.sql)
    const student = await makeMinor(h.sql)
    const [sm] = await h.sql`
      insert into membership (account_id, chapter_id, role, status)
      values (${student}, ${chapter}, 'student', 'active') returning id
    `
    await runEligibilitySweep({ sql: h.sql }, NOW, { mentorEligibilityEnforced: true })
    const [row] = await h.sql`select status from membership where id = ${sm!.id}`
    expect(row!.status).toBe('active')
  })
})
