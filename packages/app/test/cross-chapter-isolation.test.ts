// -------------------------------------------------------------------------
// Milestone 4 — the second-chapter multi-tenancy isolation proof.
//
// This is the "onboarding a second chapter as the multi-chapter proof"
// (08-build-phasing.md M4): a comprehensive cross-chapter isolation suite that
// proves the membership/authorization model (03-authorization.md; decision-log
// "role lives on a membership, not the account") holds across TWO chapters, C1
// and C2, each with its own students, staff, pods, and content.
//
// It exercises the REAL code paths — the app services over the runtime
// `authorize` wrapper, and the pure `can` for the resolution crux and the
// platform override — plus Mechanism B (RLS) at the database floor. Every
// cross-chapter access must be refused by the FIRST line of defence (the
// application decision): a member of C1 acting on a C2 resource is denied
// `out_of_scope`; a membership whose role is wrong for the capability is denied
// `role_not_permitted`. The database RLS floor is asserted last.
//
// The crux (decision-log "why the second chapter proves it"): ONE account may
// hold an active membership in BOTH chapters, and "the resource, not a column,
// chooses which membership answers" (03-authorization). A person who is
// `chapter_director` in C1 but only `student` in C2 gets director powers on C1
// resources and only student powers on C2 resources — proven independently per
// resource.
//
// No production code is changed by this file: it is a verification suite over
// the M0-M4 code already committed. Each DENIAL assertion checks BOTH the opaque
// Forbidden AND the specific structured reason written to audit, so a test can
// only pass when the real authorization boundary fired (an error for any other
// reason writes no `permission.denied` row with that capability+reason). Positive
// controls prove the same fixtures DO allow same-chapter access, so a blanket
// "everything denies" defect could not hide.
//
// Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { can, type AuthContext, type Membership, type Role } from '@curiolab/core'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeTerm, makePod, makeMembership } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import {
  PostService,
  CommentService,
  FeedService,
  ProjectService,
  NewsletterService,
  ModerationService,
  ProfileService,
  GuardianPortalService,
  ConsentService,
} from '../src/index.js'

let h: Harness

// --- ctx builders ----------------------------------------------------------

/** A pod/chapter-aware in-force membership (the app `mem` helper is chapter-wide only). */
function membership(role: Role, chapterId: string, podId: string | null = null): Membership {
  return { chapter_id: chapterId, role, status: 'active', pod_id: podId, tier: null, active_from: null, active_until: null }
}

function ctxFor(accountId: string, memberships: Membership[]): AuthContext {
  return baseCtx(accountId, new Date(), memberships)
}

function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

// --- the two-chapter world -------------------------------------------------

interface Chapter {
  id: string
  term: string
  pod: string
  director: string
  instructor: string
  student: string
  studentMembership: string
  guardian: string
  /** A published post (in the chapter's pod), authored by the instructor. */
  post: string
  /** A submitted project owned by the student (for verify/publish attempts). */
  submittedProject: string
  /** A verified project owned by the student (for publish attempts). */
  verifiedProject: string
  /** A scheduled, zero-student newsletter issue. */
  issue: string
  /** A filed ordinary moderation report against `post`. */
  report: string
}

let C1: Chapter
let C2: Chapter

/** Seed a fully-populated chapter: staff, a pod student with enrollment, content. */
async function seedChapter(): Promise<Chapter> {
  const sql = h.sql
  const id = await makeChapter(sql)
  const term = await makeTerm(sql, id)
  const pod = await makePod(sql, id, term)

  const director = await makeAdult(sql)
  const instructor = await makeAdult(sql)
  const student = await makeMinor(sql, { dateOfBirth: '2015-06-01' })
  const guardian = await makeAdult(sql)

  await makeMembership(sql, director, id, { role: 'chapter_director' })
  // Instructor/director memberships are chapter-wide (the membership_pod_scope
  // constraint only permits a pod on student / junior_mentor roles); the pod
  // lives on the content, not on the teaching membership.
  const instructorMembership = await makeMembership(sql, instructor, id, { role: 'senior_instructor' })
  const studentMembership = await makeMembership(sql, student, id, { role: 'student', podId: pod })

  // An accepted application + linked enrollment so the consent anchor / record
  // reads resolve (a returning-shape enrollment carries the student account).
  const [app] = await sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${id}, 'accepted', 'Minor Testchild', 'parent@example.test',
      'Parent Testperson', 'parent@example.test', '2026-06-01T00:00:00Z'
    ) returning id
  `
  await sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${student}, ${id}, ${term}, ${randomUUID()}, 'Parent Testperson', ${director}
    )
  `

  const [post] = await sql`
    insert into post (chapter_id, pod_id, author_membership_id, type, body)
    values (${id}, ${pod}, ${instructorMembership}, 'wip', 'Hello Lab')
    returning id
  `
  const [submittedProject] = await sql`
    insert into project (chapter_id, owner_membership_id, title, status)
    values (${id}, ${studentMembership}, 'My Robot', 'submitted')
    returning id
  `
  const [verifiedProject] = await sql`
    insert into project (chapter_id, owner_membership_id, title, status, verified_by, verified_at)
    values (${id}, ${studentMembership}, 'My Verified Robot', 'verified', ${director}, now())
    returning id
  `
  const [issue] = await sql`
    insert into newsletter_issue (chapter_id, title, body, status, scheduled_for)
    values (${id}, 'Chapter Digest', 'body', 'scheduled', now())
    returning id
  `
  const [report] = await sql`
    insert into moderation_report (target_type, target_id, reporter_account_id, chapter_id, class, reason)
    values ('post', ${post!.id}, ${director}, ${id}, 'ordinary', 'harmful')
    returning id
  `

  return {
    id,
    term,
    pod,
    director,
    instructor,
    student,
    studentMembership,
    guardian,
    post: post!.id as string,
    submittedProject: submittedProject!.id as string,
    verifiedProject: verifiedProject!.id as string,
    issue: issue!.id as string,
    report: report!.id as string,
  }
}

beforeAll(async () => {
  h = await startHarness()
  C1 = await seedChapter()
  C2 = await seedChapter()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// --- assertion helpers -----------------------------------------------------

/** The most recent permission.denied detail for (actor, capability), or undefined. */
async function lastDenied(actor: string, capability: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await h.sql`
    select detail from audit_entry
    where action = 'permission.denied' and actor_account_id = ${actor}
      and detail->>'capability' = ${capability}
    order by at desc limit 1
  `
  return row?.detail as Record<string, unknown> | undefined
}

/**
 * Run `op` (a gated service call) under a fresh request, assert it threw an
 * opaque Forbidden that leaks no reason, and that audit recorded the EXACT
 * capability + structured reason. This is the cross-chapter-denial contract.
 */
async function expectDenied(
  actor: string,
  capability: string,
  reason: string,
  op: () => Promise<unknown>,
): Promise<void> {
  let caught: unknown
  await withRequest(async () => {
    try {
      await op()
    } catch (e) {
      caught = e
    }
  })
  expect(caught, `${capability} should be Forbidden`).toBeInstanceOf(Forbidden)
  // The opaque client error must not leak the internal reason.
  expect(JSON.stringify(caught)).not.toMatch(new RegExp(reason))
  const detail = await lastDenied(actor, capability)
  expect(detail, `no permission.denied row for ${actor} / ${capability}`).toBeDefined()
  expect(detail).toMatchObject({ capability, reason })
}

// service factories bound to the real runtime `authorize`
const posts = (): PostService => new PostService({ sql: h.sql, authorize: authorize as never })
const comments = (): CommentService => new CommentService({ sql: h.sql, authorize: authorize as never })
const feed = (): FeedService => new FeedService({ sql: h.sql, authorize: authorize as never })
const projects = (): ProjectService => new ProjectService({ sql: h.sql, authorize: authorize as never })
const newsletters = (): NewsletterService => new NewsletterService({ sql: h.sql, authorize: authorize as never })
const moderation = (): ModerationService => new ModerationService({ sql: h.sql, authorize: authorize as never })
const profiles = (): ProfileService => new ProfileService({ sql: h.sql, authorize: authorize as never })
const guardianPortal = (): GuardianPortalService => new GuardianPortalService({ sql: h.sql, authorize: authorize as never })
const consents = (): ConsentService => new ConsentService({ sql: h.sql, authorize: authorize as never })

// ===========================================================================
// FEED
// ===========================================================================
describe('Feed: a C1 member cannot touch C2 content', () => {
  test('a C1 instructor cannot feed.view the C2 feed (out_of_scope)', async () => {
    const ctx = ctxFor(C1.instructor, [membership('senior_instructor', C1.id, C1.pod)])
    await expectDenied(C1.instructor, 'feed.view', 'out_of_scope', () =>
      feed().view(ctx, { chapterId: C2.id }),
    )
  })

  test('a C1 student cannot feed.post into C2 (out_of_scope), no row', async () => {
    const ctx = ctxFor(C1.student, [membership('student', C1.id, C1.pod)])
    await expectDenied(C1.student, 'feed.post', 'out_of_scope', () =>
      posts().create({ chapterId: C2.id, type: 'wip', body: 'intruder' }, ctx),
    )
    const [c] = await h.sql`select count(*)::int as n from post where chapter_id = ${C2.id} and body = 'intruder'`
    expect(c!.n).toBe(0)
  })

  test('a C1 student cannot feed.comment on a C2 post (out_of_scope)', async () => {
    const ctx = ctxFor(C1.student, [membership('student', C1.id, C1.pod)])
    await expectDenied(C1.student, 'feed.comment', 'out_of_scope', () =>
      comments().create(C2.post, { body: 'intruder' }, ctx),
    )
  })

  test('a C1 instructor cannot feed.moderate (hide) a C2 post (out_of_scope), nothing hidden', async () => {
    const ctx = ctxFor(C1.instructor, [membership('senior_instructor', C1.id, C1.pod)])
    await expectDenied(C1.instructor, 'feed.moderate', 'out_of_scope', () =>
      posts().hide(C2.post, ctx),
    )
    const [row] = await h.sql`select status from post where id = ${C2.post}`
    expect(row!.status).toBe('published')
  })

  test('a C1 instructor cannot feed.hide_safety a C2 post (out_of_scope)', async () => {
    // feed.hide_safety is chapter-scoped (any teaching membership in the chapter),
    // so the only thing barring the C1 instructor is the chapter boundary itself.
    const ctx = ctxFor(C1.instructor, [membership('senior_instructor', C1.id, C1.pod)])
    await expectDenied(C1.instructor, 'feed.hide_safety', 'out_of_scope', () =>
      posts().hideSafety(C2.post, ctx),
    )
    const [row] = await h.sql`select status from post where id = ${C2.post}`
    expect(row!.status).toBe('published')
  })
})

// ===========================================================================
// PROJECTS
// ===========================================================================
describe('Projects: C1 staff/students cannot reach C2 projects', () => {
  test('a C1 director cannot verify a C2 project (out_of_scope)', async () => {
    const ctx = ctxFor(C1.director, [membership('chapter_director', C1.id)])
    await expectDenied(C1.director, 'project.verify', 'out_of_scope', () =>
      projects().verify(C2.submittedProject, ctx),
    )
    const [row] = await h.sql`select status from project where id = ${C2.submittedProject}`
    expect(row!.status).toBe('submitted')
  })

  test('a C1 director cannot publish a C2 project (out_of_scope)', async () => {
    const ctx = ctxFor(C1.director, [membership('chapter_director', C1.id)])
    await expectDenied(C1.director, 'project.publish_public', 'out_of_scope', () =>
      projects().publishPublic(C2.verifiedProject, ctx),
    )
    const [row] = await h.sql`select status from project where id = ${C2.verifiedProject}`
    expect(row!.status).toBe('verified')
  })

  test('a C1 student cannot create a project against C2 (out_of_scope)', async () => {
    const ctx = ctxFor(C1.student, [membership('student', C1.id, C1.pod)])
    await expectDenied(C1.student, 'project.create', 'out_of_scope', () =>
      projects().create(
        { chapterId: C2.id, ownerMembershipId: C1.studentMembership, title: 'intruder project' },
        ctx,
      ),
    )
    const [c] = await h.sql`select count(*)::int as n from project where chapter_id = ${C2.id} and title = 'intruder project'`
    expect(c!.n).toBe(0)
  })
})

// ===========================================================================
// RECORDS / CONSENT
// ===========================================================================
describe('Records/consent: a C1 director cannot read a C2 student record', () => {
  test('a C1 director cannot student.view_record a C2 student (out_of_scope), no read logged', async () => {
    const ctx = ctxFor(C1.director, [membership('chapter_director', C1.id)])
    await expectDenied(C1.director, 'student.view_record', 'out_of_scope', () =>
      profiles().view(C2.student, ctx),
    )
    // The logsRead obligation never runs on a denial.
    const [c] = await h.sql`
      select count(*)::int as n from audit_entry
      where action = 'minor_record.read' and actor_account_id = ${C1.director}
    `
    expect(c!.n).toBe(0)
  })
})

// ===========================================================================
// GUARDIAN
// ===========================================================================
describe('Guardian: a guardian verified for a C1 child cannot reach a C2 child', () => {
  test('viewChildRecord of a C2 child is denied out_of_scope', async () => {
    const ctx = guardianCtx(C1.guardian, [C1.student]) // verified over C1's child only
    await expectDenied(C1.guardian, 'guardian.view_child_record', 'out_of_scope', () =>
      guardianPortal().viewChildRecord(C2.student, ctx),
    )
  })

  test("a C1 guardian cannot grant consent for a C2 student (out_of_scope), no consent row", async () => {
    const ctx = guardianCtx(C1.guardian, [C1.student])
    await expectDenied(C1.guardian, 'consent.grant', 'out_of_scope', () =>
      consents().grantConsent(C2.student, 'public_profile', ctx),
    )
    const [c] = await h.sql`
      select count(*)::int as n from consent
      where student_account_id = ${C2.student} and granted_by = ${C1.guardian}
    `
    expect(c!.n).toBe(0)
  })
})

// ===========================================================================
// MODERATION
// ===========================================================================
describe('Moderation: a C1 moderator cannot act on a C2 report', () => {
  test('acknowledge of a C2 report is denied out_of_scope', async () => {
    const ctx = ctxFor(C1.instructor, [membership('senior_instructor', C1.id, C1.pod)])
    await expectDenied(C1.instructor, 'feed.moderate', 'out_of_scope', () =>
      moderation().acknowledge(C2.report, ctx),
    )
    const [row] = await h.sql`select acknowledged_at from moderation_report where id = ${C2.report}`
    expect(row!.acknowledged_at).toBeNull()
  })

  test('resolve of a C2 report is denied out_of_scope', async () => {
    const ctx = ctxFor(C1.director, [membership('chapter_director', C1.id)])
    await expectDenied(C1.director, 'moderation.resolve', 'out_of_scope', () =>
      moderation().resolve(C2.report, ctx, 'dismissed'),
    )
    const [row] = await h.sql`select resolved_at from moderation_report where id = ${C2.report}`
    expect(row!.resolved_at).toBeNull()
  })
})

// ===========================================================================
// NEWSLETTER
// ===========================================================================
describe('Newsletter: a C1 director cannot publish a C2 issue', () => {
  test('publish of a C2 issue is denied out_of_scope, the issue stays scheduled', async () => {
    const ctx = ctxFor(C1.director, [membership('chapter_director', C1.id)])
    await expectDenied(C1.director, 'newsletter.publish', 'out_of_scope', () =>
      newsletters().publish(C2.issue, ctx),
    )
    const [row] = await h.sql`select status from newsletter_issue where id = ${C2.issue}`
    expect(row!.status).toBe('scheduled')
  })
})

// ===========================================================================
// POSITIVE CONTROLS — the same fixtures DO allow same-chapter access, so the
// denials above are proving the boundary, not a broken harness.
// ===========================================================================
describe('Positive controls: same-chapter access is allowed', () => {
  test('a C1 instructor CAN moderate (hide) a C1 post', async () => {
    // Use a throwaway C1 post so the shared fixture post is untouched.
    const [p] = await h.sql`
      insert into post (chapter_id, pod_id, author_membership_id, type, body)
      values (${C1.id}, ${C1.pod}, (select id from membership where account_id = ${C1.instructor} and chapter_id = ${C1.id}), 'wip', 'to hide')
      returning id
    `
    const ctx = ctxFor(C1.instructor, [membership('senior_instructor', C1.id, C1.pod)])
    await withRequest(async () => {
      await posts().hide(p!.id as string, ctx)
    })
    const [row] = await h.sql`select status from post where id = ${p!.id}`
    expect(row!.status).toBe('hidden')
  })

  test('a C1 director CAN verify a C1 project', async () => {
    const [proj] = await h.sql`
      insert into project (chapter_id, owner_membership_id, title, status)
      values (${C1.id}, ${C1.studentMembership}, 'C1 to verify', 'submitted') returning id
    `
    const ctx = ctxFor(C1.director, [membership('chapter_director', C1.id)])
    await withRequest(async () => {
      await projects().verify(proj!.id as string, ctx)
    })
    const [row] = await h.sql`select status from project where id = ${proj!.id}`
    expect(row!.status).toBe('verified')
  })

  test('a C1 guardian CAN view their own C1 child record', async () => {
    const ctx = guardianCtx(C1.guardian, [C1.student])
    let record: unknown
    await withRequest(async () => {
      record = await guardianPortal().viewChildRecord(C1.student, ctx)
    })
    expect(record).toBeDefined()
  })

  test('a C1 director CAN publish a C1 zero-student issue', async () => {
    const [issue] = await h.sql`
      insert into newsletter_issue (chapter_id, title, body, status, scheduled_for)
      values (${C1.id}, 'C1 publishable', 'body', 'scheduled', now()) returning id
    `
    const ctx = ctxFor(C1.director, [membership('chapter_director', C1.id)])
    await withRequest(async () => {
      await newsletters().publish(issue!.id as string, ctx)
    })
    const [row] = await h.sql`select status from newsletter_issue where id = ${issue!.id}`
    expect(row!.status).toBe('published')
  })
})

// ===========================================================================
// THE MULTI-MEMBERSHIP RESOLUTION CRUX
// One account: chapter_director in C1, but ONLY student in C2. "The resource,
// not a column, chooses which membership answers." Director powers on C1
// resources; only student powers on C2 resources; neither role leaks across.
// ===========================================================================
describe('Multi-membership resolution: director in C1, student in C2', () => {
  function advisorCtx(accountId: string): AuthContext {
    return ctxFor(accountId, [membership('chapter_director', C1.id), membership('student', C2.id)])
  }

  test('(can) project.verify: allowed on a C1 resource, role_not_permitted on a C2 resource', () => {
    const ctx = advisorCtx(randomUUID())
    const onC1 = can(ctx, 'project.verify', { chapter_id: C1.id, pod_id: null })
    const onC2 = can(ctx, 'project.verify', { chapter_id: C2.id, pod_id: null })
    expect(onC1.allowed).toBe(true)
    expect(onC2.allowed).toBe(false)
    if (!onC2.allowed) expect(onC2.reason).toBe('role_not_permitted') // the C2 membership is student, not TEACHING
  })

  test('(can) project.create: allowed on C2 (the student power the C2 membership grants)', () => {
    const ctx = advisorCtx(randomUUID())
    const onC2 = can(ctx, 'project.create', { chapter_id: C2.id })
    expect(onC2.allowed).toBe(true) // student is a permitted creator role
  })

  test('(can) project.publish_public: allowed on C1 (director), role_not_permitted on C2 (student)', () => {
    const ctx = advisorCtx(randomUUID())
    const onC1 = can(ctx, 'project.publish_public', { chapter_id: C1.id, studentAuthoredItems: [] })
    const onC2 = can(ctx, 'project.publish_public', { chapter_id: C2.id, studentAuthoredItems: [] })
    expect(onC1.allowed).toBe(true)
    expect(onC2.allowed).toBe(false)
    if (!onC2.allowed) expect(onC2.reason).toBe('role_not_permitted')
  })

  test('(can) feed.moderate: allowed on C1, role_not_permitted on C2', () => {
    const ctx = advisorCtx(randomUUID())
    expect(can(ctx, 'feed.moderate', { chapter_id: C1.id, pod_id: null }).allowed).toBe(true)
    const onC2 = can(ctx, 'feed.moderate', { chapter_id: C2.id, pod_id: null })
    expect(onC2.allowed).toBe(false)
    if (!onC2.allowed) expect(onC2.reason).toBe('role_not_permitted')
  })

  test('(service) the SAME account verifies a C1 project but is refused (role_not_permitted) on a C2 project', async () => {
    const advisor = await makeAdult(h.sql)
    // A submitted project in each chapter (owned by that chapter's own student).
    const [p1] = await h.sql`
      insert into project (chapter_id, owner_membership_id, title, status)
      values (${C1.id}, ${C1.studentMembership}, 'advisor C1 target', 'submitted') returning id
    `
    // C1 resource: the director membership answers -> allowed, the project verifies.
    await withRequest(async () => {
      await projects().verify(p1!.id as string, advisorCtx(advisor))
    })
    const [r1] = await h.sql`select status, verified_by from project where id = ${p1!.id}`
    expect(r1!.status).toBe('verified')
    expect(r1!.verified_by).toBe(advisor)

    // C2 resource: the student membership answers -> role_not_permitted. The C1
    // director role does NOT reach across into C2.
    await expectDenied(advisor, 'project.verify', 'role_not_permitted', () =>
      projects().verify(C2.submittedProject, advisorCtx(advisor)),
    )
    const [r2] = await h.sql`select status from project where id = ${C2.submittedProject}`
    expect(r2!.status).toBe('submitted')
  })
})

// ===========================================================================
// PLATFORM OVERRIDE — platform_admin reaches BOTH chapters; platform_staff
// reads BOTH but cannot write cross-chapter beyond its defined grants.
// ===========================================================================
describe('Platform override: reach across chapters', () => {
  function platformCtx(role: 'platform_admin' | 'platform_staff'): AuthContext {
    // A platform actor holds one platform-role membership. Its chapter is
    // irrelevant to the override (which keys on the role, not the resource); it
    // is deliberately NEITHER C1 nor C2, so any write that falls through to
    // ordinary scope resolution (platform_staff on a writing capability) denies
    // out_of_scope in both chapters rather than matching a coincidental membership.
    return ctxFor(randomUUID(), [membership(role, randomUUID())])
  }

  test('platform_admin is allowed to write in BOTH chapters (feed.post, project.verify)', () => {
    const ctx = platformCtx('platform_admin')
    expect(can(ctx, 'feed.post', { chapter_id: C1.id, pod_id: null }).allowed).toBe(true)
    expect(can(ctx, 'feed.post', { chapter_id: C2.id, pod_id: null }).allowed).toBe(true)
    expect(can(ctx, 'project.verify', { chapter_id: C1.id, pod_id: null }).allowed).toBe(true)
    expect(can(ctx, 'project.verify', { chapter_id: C2.id, pod_id: null }).allowed).toBe(true)
  })

  test('platform_admin can publish a zero-student issue in BOTH chapters (override satisfies scope+role)', () => {
    const ctx = platformCtx('platform_admin')
    expect(can(ctx, 'newsletter.publish', { chapter_id: C1.id, studentAuthoredItems: [] }).allowed).toBe(true)
    expect(can(ctx, 'newsletter.publish', { chapter_id: C2.id, studentAuthoredItems: [] }).allowed).toBe(true)
  })

  test('platform_admin override NEVER clears consent: a C2 issue with an unconsented student item is denied', () => {
    const ctx = platformCtx('platform_admin')
    const d = can(ctx, 'newsletter.publish', {
      id: 'issue-x',
      chapter_id: C2.id,
      // A student item whose external_publication snapshot is absent -> fail closed.
      studentAuthoredItems: [{ student: C2.student }],
    })
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.reason).toBe('subject_consent_unknown')
  })

  test('platform_staff READS across both chapters (feed.view allowed in C1 and C2)', () => {
    const ctx = platformCtx('platform_staff')
    expect(can(ctx, 'feed.view', { chapter_id: C1.id, pod_id: null }).allowed).toBe(true)
    expect(can(ctx, 'feed.view', { chapter_id: C2.id, pod_id: null }).allowed).toBe(true)
  })

  test('platform_staff CANNOT write cross-chapter: feed.post and project.verify denied out_of_scope in both', () => {
    const ctx = platformCtx('platform_staff')
    for (const chapter of [C1.id, C2.id]) {
      const post = can(ctx, 'feed.post', { chapter_id: chapter, pod_id: null })
      expect(post.allowed).toBe(false)
      if (!post.allowed) expect(post.reason).toBe('out_of_scope')
      const verify = can(ctx, 'project.verify', { chapter_id: chapter, pod_id: null })
      expect(verify.allowed).toBe(false)
    }
  })

  test('platform_staff MAY publish a zero-student issue (its one write grant) but NOT one with student items', () => {
    const ctx = platformCtx('platform_staff')
    // Its defined write grant: the zero-student newsletter issue, in either chapter.
    expect(can(ctx, 'newsletter.publish', { chapter_id: C2.id, studentAuthoredItems: [] }).allowed).toBe(true)
    // With a student item it has no grant and no C2 membership -> out_of_scope.
    const withItem = can(ctx, 'newsletter.publish', {
      chapter_id: C2.id,
      studentAuthoredItems: [{ student: C2.student }],
    })
    expect(withItem.allowed).toBe(false)
    if (!withItem.allowed) expect(withItem.reason).toBe('out_of_scope')
  })
})

// ===========================================================================
// MECHANISM B — RLS (the database floor). Connecting as the restricted
// `curiolab_rls` role: a C1 staffer sees C1 rows, never C2; a platform actor
// sees both. This is defence-in-depth beneath the application decision above.
// ===========================================================================
describe('Mechanism B (RLS): cross-chapter row isolation at the database floor', () => {
  let rls: Sql

  beforeAll(() => {
    rls = h.connectAs('curiolab_rls', 'rls_pw')
  })

  async function membershipAccounts(ctx: { account?: string; platform?: boolean }): Promise<string[]> {
    return rls.begin(async (tx) => {
      if (ctx.account != null) await tx`select set_config('app.current_account_id', ${ctx.account}, true)`
      if (ctx.platform) await tx`select set_config('app.actor_is_platform', 'on', true)`
      const rows = await tx`select account_id from membership`
      return rows.map((r) => r.account_id as string)
    }) as Promise<string[]>
  }

  test('a C1 director sees C1 memberships but NOT C2 memberships', async () => {
    const seen = await membershipAccounts({ account: C1.director })
    expect(seen).toEqual(expect.arrayContaining([C1.director, C1.student, C1.instructor]))
    expect(seen).not.toContain(C2.student)
    expect(seen).not.toContain(C2.director)
  })

  test('a C2 director sees C2 memberships but NOT C1 memberships', async () => {
    const seen = await membershipAccounts({ account: C2.director })
    expect(seen).toEqual(expect.arrayContaining([C2.director, C2.student]))
    expect(seen).not.toContain(C1.student)
    expect(seen).not.toContain(C1.director)
  })

  test('a platform actor sees memberships in BOTH chapters', async () => {
    const seen = await membershipAccounts({ platform: true })
    expect(seen).toEqual(expect.arrayContaining([C1.director, C1.student, C2.director, C2.student]))
  })
})
