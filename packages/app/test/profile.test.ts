// -------------------------------------------------------------------------
// ProfileService tests (Milestone 3.3) — the student profile: compose the
// verified record + published narrative with honest zero-state sections, the
// narrative lifecycle (draft/pending_review/published/removed), and the
// outside-pod minor_record.read audit obligation. Embedded Postgres, synthetic
// data only.
//
// Under test (02-data-model profile_narrative / timeline_entry; 03-authorization
// student.view_record / profile.view / profile.edit_narrative / narrative.review;
// 04-state-machines the narrative machine and the empty-state-in-the-model rule):
//
//   - view composes active membership + current_tier, the subject's
//     verified/public_listed projects (titles + dates), timeline entries, a
//     mentor-hours zero placeholder, PLUS the published narrative; a brand-new
//     Explorer reads as COMPLETE (sections present, honest zeros), never empty;
//   - a MINOR's editNarrative lands pending_review (NOT published, not returned);
//     reviewNarrative publishes it; an ADULT self-edit publishes directly;
//   - an outside-pod read of a minor's profile writes exactly one
//     minor_record.read audit row (the logsRead obligation, in one transaction);
//   - removeNarrative moves a narrative to removed (moderation).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext, Membership, Role } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeTerm, makePod, makeMembership } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import { ProfileService, IllegalNarrativeTransitionError } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function membership(role: Role, chapterId: string, podId: string | null = null): Membership {
  return {
    chapter_id: chapterId,
    role,
    status: 'active',
    pod_id: podId,
    tier: null,
    active_from: null,
    active_until: null,
  }
}

/** A student/staff ctx of a given age (age drives the minor/adult narrative split). */
function ctxAged(accountId: string, age: number, memberships: Membership[]): AuthContext {
  const base = baseCtx(accountId, new Date(), memberships)
  return { ...base, account: { ...base.account, age } }
}

interface Setup {
  chapter: string
  term: string
  pod: string
  otherPod: string
  director: string
  podInstructor: string
  otherPodInstructor: string
  student: string
  studentMembership: string
}

// A chapter with two pods, a director, a pod instructor, an out-of-pod
// instructor (same chapter), and a MINOR Explorer student in pod 1 with an
// accepted application + linked enrollment (so any consent anchor resolves).
async function setup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const pod = await makePod(h.sql, chapter, term)
  const otherPod = await makePod(h.sql, chapter, term)
  const director = await makeAdult(h.sql)
  const podInstructor = await makeAdult(h.sql)
  const otherPodInstructor = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  const studentMembership = await makeMembership(h.sql, student, chapter, {
    role: 'student',
    podId: pod,
    currentTier: 'explorer',
  })
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild', 'parent@example.test',
      'Parent Testperson', 'parent@example.test', '2026-06-01T00:00:00Z'
    ) returning id
  `
  await h.sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${student}, ${chapter}, ${term},
      ${randomUUID()}, 'Parent Testperson', ${director}
    )
  `
  return { chapter, term, pod, otherPod, director, podInstructor, otherPodInstructor, student, studentMembership }
}

async function seedProject(f: Setup, title: string, status: string): Promise<string> {
  const [row] = await h.sql`
    insert into project (chapter_id, owner_membership_id, title, status, verified_by, verified_at)
    values (
      ${f.chapter}, ${f.studentMembership}, ${title}, ${status},
      ${status === 'draft' || status === 'submitted' ? null : f.director},
      ${status === 'draft' || status === 'submitted' ? null : h.sql`now()`}
    ) returning id
  `
  return row!.id as string
}

// ===========================================================================
describe('view composes the verified record + published narrative', () => {
  test('a brand-new Explorer reads as COMPLETE: sections present, honest zeros', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    // The student views their OWN profile (profile.view, own scope).
    const selfCtx = ctxAged(f.student, 15, [membership('student', f.chapter, f.pod)])

    const view = await withRequest(() => svc.view(f.student, selfCtx))

    expect(view).toBeDefined()
    expect(view!.tier).toBe('explorer')
    expect(view!.membership).not.toBeNull()
    expect(view!.membership!.currentTier).toBe('explorer')
    // Honest zero-states: the sections are PRESENT (arrays/zeros), not omitted.
    expect(view!.projects).toEqual([])
    expect(view!.timeline).toEqual([])
    expect(view!.mentorHours).toBe(0)
    expect(view!.narrative).toBeNull()
  })

  test('verified/public_listed projects, timeline, and the published narrative appear', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    await seedProject(f, 'My Robot', 'verified')
    await seedProject(f, 'Draft Idea', 'draft') // must NOT appear (not verified)
    await seedProject(f, 'Showcased', 'public_listed')
    await h.sql`
      insert into timeline_entry (account_id, kind, occurred_at, ref)
      values (${f.student}, 'joined', now(), ${null})
    `
    await h.sql`
      insert into profile_narrative (account_id, body, status)
      values (${f.student}, 'I build robots.', 'published')
    `
    // ...plus a removed narrative that must NEVER surface.
    await h.sql`
      insert into profile_narrative (account_id, body, status)
      values (${f.student}, 'old draft', 'removed')
    `

    const staffCtx = ctxAged(f.podInstructor, 40, [membership('lead_instructor', f.chapter, f.pod)])
    const view = await withRequest(() => svc.view(f.student, staffCtx))

    expect(view!.projects.map((p) => p.title).sort()).toEqual(['My Robot', 'Showcased'])
    expect(view!.projects.find((p) => p.title === 'My Robot')!.verifiedAt).not.toBeNull()
    expect(view!.timeline.map((t) => t.kind)).toEqual(['joined'])
    expect(view!.narrative).not.toBeNull()
    expect(view!.narrative!.body).toBe('I build robots.')
    expect(typeof view!.narrative!.narrativeId).toBe('string')
  })
})

// ===========================================================================
describe('the narrative lifecycle: minor pending_review -> published; adult direct', () => {
  test("a minor's edit lands pending_review and is NOT returned as published", async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    const minorCtx = ctxAged(f.student, 15, [membership('student', f.chapter, f.pod)])

    const edited = await withRequest(() => svc.editNarrative(f.student, 'My WIP bio', minorCtx))
    expect(edited.status).toBe('pending_review')

    // A view does not surface a not-yet-published narrative.
    const view = await withRequest(() => svc.view(f.student, minorCtx))
    expect(view!.narrative).toBeNull()

    const [row] = await h.sql`select status from profile_narrative where id = ${edited.narrativeId}`
    expect(row!.status).toBe('pending_review')
  })

  test('reviewNarrative clears a pending_review narrative to published', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    const minorCtx = ctxAged(f.student, 15, [membership('student', f.chapter, f.pod)])
    const directorCtx = ctxAged(f.director, 40, [membership('chapter_director', f.chapter, null)])

    const edited = await withRequest(() => svc.editNarrative(f.student, 'My WIP bio', minorCtx))
    await withRequest(() => svc.reviewNarrative(edited.narrativeId, directorCtx))

    const view = await withRequest(() => svc.view(f.student, minorCtx))
    expect(view!.narrative).not.toBeNull()
    expect(view!.narrative!.body).toBe('My WIP bio')
  })

  test('an adult self-edit publishes directly', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    // An adult (18+) account holding a student membership editing their OWN
    // narrative. An active student membership requires enrollment-sourced DOB
    // provenance (Decision-4 trigger), so seed it that way.
    const adult = await makeAdult(h.sql, { dobProvenance: 'enrollment_record', dobSourceRef: randomUUID() })
    await makeMembership(h.sql, adult, f.chapter, { role: 'student', podId: f.pod, currentTier: 'explorer' })
    const adultCtx = ctxAged(adult, 19, [membership('student', f.chapter, f.pod)])

    const edited = await withRequest(() => svc.editNarrative(adult, 'Adult bio', adultCtx))
    expect(edited.status).toBe('published')

    const view = await withRequest(() => svc.view(adult, adultCtx))
    expect(view!.narrative!.body).toBe('Adult bio')
  })

  test('reviewNarrative on a non-pending narrative is an illegal transition', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    const directorCtx = ctxAged(f.director, 40, [membership('chapter_director', f.chapter, null)])
    const [row] = await h.sql`
      insert into profile_narrative (account_id, body, status)
      values (${f.student}, 'already published', 'published') returning id
    `
    await expect(
      withRequest(() => svc.reviewNarrative(row!.id as string, directorCtx)),
    ).rejects.toBeInstanceOf(IllegalNarrativeTransitionError)
  })

  test('a guardian never authors: editNarrative for a child is denied (own scope only)', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    const guardian = await makeAdult(h.sql)
    const guardianCtx: AuthContext = { ...baseCtx(guardian, new Date()), guardianOf: [f.student] }

    await expect(
      withRequest(() => svc.editNarrative(f.student, 'parent-written', guardianCtx)),
    ).rejects.toBeInstanceOf(Forbidden)
    const rows = await h.sql`select id from profile_narrative where account_id = ${f.student}`
    expect(rows).toHaveLength(0)
  })

  test('removeNarrative moves a narrative to removed (moderation)', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    const directorCtx = ctxAged(f.director, 40, [membership('chapter_director', f.chapter, null)])
    const [row] = await h.sql`
      insert into profile_narrative (account_id, body, status)
      values (${f.student}, 'to be removed', 'published') returning id
    `
    await withRequest(() => svc.removeNarrative(row!.id as string, directorCtx))
    const [after] = await h.sql`select status from profile_narrative where id = ${row!.id}`
    expect(after!.status).toBe('removed')
  })
})

// ===========================================================================
describe('outside-pod read of a minor writes exactly one minor_record.read', () => {
  test('an in-pod staff read logs nothing; an out-of-pod staff read logs once', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })

    // In-pod instructor: no read log.
    const inPodCtx = ctxAged(f.podInstructor, 40, [membership('lead_instructor', f.chapter, f.pod)])
    await withRequest(() => svc.view(f.student, inPodCtx))
    const inPodLogs = await h.sql`
      select count(*)::int as n from audit_entry
      where action = 'minor_record.read' and subject_id = ${f.student} and actor_account_id = ${f.podInstructor}
    `
    expect(inPodLogs[0]!.n).toBe(0)

    // Out-of-pod instructor (same chapter, different pod): exactly one read log.
    const outCtx = ctxAged(f.otherPodInstructor, 40, [membership('lead_instructor', f.chapter, f.otherPod)])
    await withRequest(() => svc.view(f.student, outCtx))
    const outLogs = await h.sql`
      select count(*)::int as n from audit_entry
      where action = 'minor_record.read' and subject_id = ${f.student} and actor_account_id = ${f.otherPodInstructor}
    `
    expect(outLogs[0]!.n).toBe(1)
  })

  test('a stranger cannot view a profile (Forbidden + one permission.denied)', async () => {
    const f = await setup()
    const svc = new ProfileService({ sql: h.sql, authorize })
    const stranger = await makeAdult(h.sql)
    const strangerCtx = ctxAged(stranger, 40, [])

    await expect(withRequest(() => svc.view(f.student, strangerCtx))).rejects.toBeInstanceOf(Forbidden)
    const denied = await h.sql`
      select count(*)::int as n from audit_entry
      where action = 'permission.denied' and actor_account_id = ${stranger}
    `
    expect(denied[0]!.n).toBe(1)
  })
})
