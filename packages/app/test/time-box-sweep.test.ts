// -------------------------------------------------------------------------
// runTimeBoxSweep — §7 time-boxing of volunteer/staff access (admin/director
// backend P5). Embedded Postgres, synthetic data only, deterministic clock.
//
// The sweep transitions a privileged (non-student/alumni) membership whose term
// has ENDED (`term.ends_on < now`) from `active` to `inactive` — the membership
// machine's "window elapsed" edge — clears its pod links, and writes a
// system-actor audit + access_ledger row per revocation (reason `term_ended`).
// A membership whose term is still current, and every STUDENT membership, are
// untouched. Once inactive, `can` denies the student-facing capabilities an
// active mentor is allowed (decision-time expiry via `inForce`).
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { can, type Membership } from '@curiolab/core'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makePod } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import { runTimeBoxSweep } from '../src/index.js'

const NOW = new Date('2026-07-23T12:00:00Z')

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- fixtures --------------------------------------------------------------

async function makeTermWithEnd(chapterId: string, startsOn: string, endsOn: string): Promise<string> {
  const [row] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapterId}, 'Term', ${startsOn}, ${endsOn})
    returning id
  `
  return row!.id as string
}

async function endedTerm(chapterId: string): Promise<string> {
  return makeTermWithEnd(chapterId, '2026-01-01', '2026-06-30') // ends before NOW
}
async function currentTerm(chapterId: string): Promise<string> {
  return makeTermWithEnd(chapterId, '2026-07-01', '2099-12-15') // ends after NOW
}

async function termBoundMembership(args: {
  accountId: string
  chapterId: string
  termId: string
  role: string
  status?: string
  podId?: string | null
}): Promise<string> {
  const [row] = await h.sql`
    insert into membership (account_id, chapter_id, role, status, term_id, pod_id)
    values (
      ${args.accountId}, ${args.chapterId}, ${args.role},
      ${args.status ?? 'active'}, ${args.termId}, ${args.podId ?? null}
    ) returning id
  `
  return row!.id as string
}

async function statusOf(membershipId: string): Promise<string> {
  const [row] = await h.sql`select status from membership where id = ${membershipId}`
  return row!.status as string
}
async function podIdOf(membershipId: string): Promise<string | null> {
  const [row] = await h.sql`select pod_id from membership where id = ${membershipId}`
  return (row!.pod_id as string | null) ?? null
}

function membershipView(chapterId: string, role: Membership['role'], status: Membership['status']): Membership {
  return { chapter_id: chapterId, role, status, pod_id: null, tier: null, active_from: null, active_until: null }
}

// --- the sweep -------------------------------------------------------------

describe('runTimeBoxSweep (§7 term-end expiry)', () => {
  test('a mentor whose term ended is transitioned active -> inactive; a current-term mentor is untouched', async () => {
    const chapter = await makeChapter(h.sql)
    const past = await endedTerm(chapter)
    const present = await currentTerm(chapter)

    const lapsed = await termBoundMembership({
      accountId: await makeAdult(h.sql),
      chapterId: chapter,
      termId: past,
      role: 'lead_instructor',
    })
    const staying = await termBoundMembership({
      accountId: await makeAdult(h.sql),
      chapterId: chapter,
      termId: present,
      role: 'lead_instructor',
    })

    const result = await runTimeBoxSweep({ sql: h.sql }, NOW)

    expect(result.revokedMembershipIds).toContain(lapsed)
    expect(result.revokedMembershipIds).not.toContain(staying)
    expect(await statusOf(lapsed)).toBe('inactive')
    expect(await statusOf(staying)).toBe('active')
  })

  test('after the sweep, a lapsed mentor is denied a student-facing capability an active mentor is allowed', async () => {
    const chapter = await makeChapter(h.sql)
    const past = await endedTerm(chapter)
    const present = await currentTerm(chapter)

    const lapsedAcct = await makeAdult(h.sql)
    const lapsed = await termBoundMembership({
      accountId: lapsedAcct,
      chapterId: chapter,
      termId: past,
      role: 'lead_instructor',
    })
    const activeAcct = await makeAdult(h.sql)
    await termBoundMembership({
      accountId: activeAcct,
      chapterId: chapter,
      termId: present,
      role: 'lead_instructor',
    })

    await runTimeBoxSweep({ sql: h.sql }, NOW)

    // The lapsed mentor's membership status is now what the DB holds; `can` must
    // deny the student record read the active mentor is allowed.
    const lapsedStatus = (await statusOf(lapsed)) as Membership['status']
    const deniedCtx = baseCtx(lapsedAcct, NOW, [membershipView(chapter, 'lead_instructor', lapsedStatus)])
    const denied = can(deniedCtx, 'student.view_record', { chapter_id: chapter })
    expect(denied.allowed).toBe(false)

    const allowedCtx = baseCtx(activeAcct, NOW, [membershipView(chapter, 'lead_instructor', 'active')])
    const allowed = can(allowedCtx, 'student.view_record', { chapter_id: chapter })
    expect(allowed.allowed).toBe(true)
  })

  test('each revocation writes an audit + access_ledger row (reason term_ended); a second run is idempotent', async () => {
    const chapter = await makeChapter(h.sql)
    const past = await endedTerm(chapter)
    const acct = await makeAdult(h.sql)
    const mentor = await termBoundMembership({
      accountId: acct,
      chapterId: chapter,
      termId: past,
      role: 'senior_instructor',
    })

    const first = await runTimeBoxSweep({ sql: h.sql }, NOW)
    expect(first.revokedMembershipIds).toContain(mentor)

    const audit = await h.sql`
      select action, subject_type, subject_id, chapter_id, actor_account_id, detail
      from audit_entry
      where action = 'membership.time_box_revoked' and subject_id = ${mentor}
    `
    expect(audit).toHaveLength(1)
    expect(audit[0]!.subject_type).toBe('membership')
    expect(audit[0]!.chapter_id).toBe(chapter)
    expect(audit[0]!.actor_account_id).toBeNull() // system job, no human actor
    expect((audit[0]!.detail as { reason?: string }).reason).toBe('term_ended')

    const ledger = await h.sql`
      select event, subject_account_id, chapter_id, actor_account_id, detail
      from access_ledger
      where event = 'membership.time_box_revoked' and subject_account_id = ${acct}
    `
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.actor_account_id).toBeNull()
    expect(ledger[0]!.chapter_id).toBe(chapter)
    expect((ledger[0]!.detail as { reason?: string }).reason).toBe('term_ended')

    // Idempotent: a second run finds nothing new and does not double-write.
    const second = await runTimeBoxSweep({ sql: h.sql }, NOW)
    expect(second.revokedMembershipIds).not.toContain(mentor)
    const [auditCount] = await h.sql`
      select count(*)::int as n from audit_entry
      where action = 'membership.time_box_revoked' and subject_id = ${mentor}
    `
    expect(auditCount!.n as number).toBe(1)
    const [ledgerCount] = await h.sql`
      select count(*)::int as n from access_ledger
      where event = 'membership.time_box_revoked' and subject_account_id = ${acct}
    `
    expect(ledgerCount!.n as number).toBe(1)
  })

  test('a STUDENT membership tied to an ended term is NOT time-boxed by the sweep', async () => {
    const chapter = await makeChapter(h.sql)
    const past = await endedTerm(chapter)
    const student = await termBoundMembership({
      accountId: await makeMinor(h.sql),
      chapterId: chapter,
      termId: past,
      role: 'student',
    })

    const result = await runTimeBoxSweep({ sql: h.sql }, NOW)

    expect(result.revokedMembershipIds).not.toContain(student)
    expect(await statusOf(student)).toBe('active')
  })

  test("a lapsed mentor's pod assignment is cleared (pod_assignment removed, membership.pod_id nulled)", async () => {
    const chapter = await makeChapter(h.sql)
    const past = await endedTerm(chapter)
    const pod = await makePod(h.sql, chapter, past)
    const jm = await termBoundMembership({
      accountId: await makeAdult(h.sql),
      chapterId: chapter,
      termId: past,
      role: 'junior_mentor',
      podId: pod,
    })
    await h.sql`
      insert into pod_assignment (membership_id, pod_id, term_id)
      values (${jm}, ${pod}, ${past})
    `

    await runTimeBoxSweep({ sql: h.sql }, NOW)

    expect(await statusOf(jm)).toBe('inactive')
    expect(await podIdOf(jm)).toBeNull()
    const [pa] = await h.sql`select count(*)::int as n from pod_assignment where membership_id = ${jm}`
    expect(pa!.n as number).toBe(0)
  })
})
