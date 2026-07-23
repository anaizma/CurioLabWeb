// -------------------------------------------------------------------------
// NewsletterService tests (Milestone 3.5) — the newsletter_issue lifecycle
// service and coupling E (publish re-checks each student item's
// external_publication consent, atomically). Embedded Postgres, synthetic data.
//
// Under test (02-data-model newsletter_issue/newsletter_item; 03-authorization
// newsletter.*; 04-state-machines the newsletter machine draft -> in_review ->
// scheduled -> published -> archived, plus blocked, and coupling E):
//
//   - draft (instructor/comms/director) -> submitReview (drafter) -> schedule
//     (director, sets scheduled_for); drafting is WIDE (instructor allowed),
//     publishing is NARROW (comms/instructor DENIED, role_not_permitted);
//   - publish requires each student item's external_publication consent scoped to
//     the ISSUE: absent snapshot -> subject_consent_unknown, revoked/inactive ->
//     subject_consent_missing, active+scoped -> published (published_by/at stamped,
//     send enqueued AFTER commit);
//   - runScheduledNewsletters (the system auto-publish job): a due scheduled issue
//     whose consent now holds -> published; one whose student consent is missing ->
//     blocked (not published) and the notify seam names the student;
//   - a zero-student issue: platform_staff may publish it (platformGrant); a
//     student-item issue they may not (out_of_scope);
//   - unpublish -> archived; a consent-driven unpublish redacts the affected item;
//   - every method is authorization-gated; illegal edges are rejected.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext, Membership, Role } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeTerm } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import {
  NewsletterService,
  ConsentService,
  runScheduledNewsletters,
  REDACTED_NEWSLETTER_ITEM_BODY,
  IllegalNewsletterTransitionError,
  type NewsletterNotification,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function membership(role: Role, chapterId: string): Membership {
  return {
    chapter_id: chapterId,
    role,
    status: 'active',
    pod_id: null,
    tier: null,
    active_from: null,
    active_until: null,
  }
}

function ctxFor(accountId: string, memberships: Membership[]): AuthContext {
  return baseCtx(accountId, new Date(), memberships)
}

function guardianCtx(guardianId: string, children: string[]): AuthContext {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

interface Setup {
  chapter: string
  term: string
  director: string
  comms: string
  instructor: string
  student: string
  guardian: string
  staff: string
  outChapter: string
}

// A chapter with a director, a comms associate, a lead instructor, a minor
// student (with an accepted application + linked enrollment so the consent
// anchor resolves), a guardian, and a DIFFERENT chapter (out of scope).
async function setup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const director = await makeAdult(h.sql)
  const comms = await makeAdult(h.sql)
  const instructor = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  const guardian = await makeAdult(h.sql)
  const staff = await makeAdult(h.sql)
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
  const outChapter = await makeChapter(h.sql)
  return { chapter, term, director, comms, instructor, student, guardian, staff, outChapter }
}

function directorCtx(f: Setup): AuthContext {
  return ctxFor(f.director, [membership('chapter_director', f.chapter)])
}
function commsCtx(f: Setup): AuthContext {
  return ctxFor(f.comms, [membership('comms_associate', f.chapter)])
}
function instructorCtx(f: Setup): AuthContext {
  return ctxFor(f.instructor, [membership('lead_instructor', f.chapter)])
}

async function issueStatus(id: string): Promise<string | undefined> {
  const [r] = await h.sql`select status from newsletter_issue where id = ${id}`
  return r?.status as string | undefined
}

/** Insert an issue in the given status, optionally platform-wide, with items. */
async function seedIssue(
  f: Setup,
  status: string,
  opts: { platformWide?: boolean; scheduledFor?: Date | null; items?: Array<{ student?: string | null }> } = {},
): Promise<string> {
  const chapterId = opts.platformWide ? null : f.chapter
  const [row] = await h.sql`
    insert into newsletter_issue (chapter_id, title, body, status, scheduled_for)
    values (${chapterId}, 'July Digest', 'Body copy', ${status}, ${opts.scheduledFor ?? null})
    returning id
  `
  const id = row!.id as string
  for (const item of opts.items ?? []) {
    await h.sql`
      insert into newsletter_item (issue_id, author_student_account_id, ref, body)
      values (${id}, ${item.student ?? null}, ${randomUUID()}, 'Item body')
    `
  }
  return id
}

async function grantExternalPub(f: Setup, issueId: string): Promise<void> {
  const svc = new ConsentService({ sql: h.sql, authorize })
  const gctx = guardianCtx(f.guardian, [f.student])
  await withRequest(() => svc.grantConsent(f.student, 'external_publication', gctx, { scopeRef: issueId }))
}

async function revokeExternalPub(f: Setup): Promise<void> {
  const svc = new ConsentService({ sql: h.sql, authorize })
  const gctx = guardianCtx(f.guardian, [f.student])
  await withRequest(() => svc.revokeConsent(f.student, 'external_publication', gctx))
}

// ===========================================================================
describe('the lifecycle: draft -> in_review -> scheduled', () => {
  test('comms drafts an issue (status draft), a drafter submits it, a director schedules it', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })

    const created = await withRequest(() =>
      svc.draft({ chapterId: f.chapter, title: 'July Digest', body: 'Hello' }, commsCtx(f)),
    )
    expect(created.status).toBe('draft')

    await withRequest(() => svc.submitReview(created.issueId, commsCtx(f)))
    expect(await issueStatus(created.issueId)).toBe('in_review')

    const when = new Date('2026-08-01T12:00:00Z')
    await withRequest(() => svc.schedule(created.issueId, directorCtx(f), when))
    expect(await issueStatus(created.issueId)).toBe('scheduled')
    const [row] = await h.sql`select scheduled_for from newsletter_issue where id = ${created.issueId}`
    expect(new Date(row!.scheduled_for as string).toISOString()).toBe(when.toISOString())
  })

  test('an instructor may also draft (drafting is wide)', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const created = await withRequest(() =>
      svc.draft({ chapterId: f.chapter, title: 'Instructor draft', body: 'x' }, instructorCtx(f)),
    )
    expect(await issueStatus(created.issueId)).toBe('draft')
  })

  test('publish is DENIED for comms and instructor (role_not_permitted)', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const issue = await seedIssue(f, 'scheduled')

    await expect(withRequest(() => svc.publish(issue, commsCtx(f)))).rejects.toBeInstanceOf(Forbidden)
    await expect(withRequest(() => svc.publish(issue, instructorCtx(f)))).rejects.toBeInstanceOf(Forbidden)
    expect(await issueStatus(issue)).toBe('scheduled')

    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and detail->>'capability' = 'newsletter.publish'
      order by at asc
    `
    expect(denied.length).toBe(2)
    expect(denied[0]!.detail).toMatchObject({ reason: 'role_not_permitted' })
    expect(denied[1]!.detail).toMatchObject({ reason: 'role_not_permitted' })
  })
})

// ===========================================================================
describe('publish gate (coupling E): per-item external_publication scoped to the issue', () => {
  test('absent snapshot -> subject_consent_unknown (fails closed), stays scheduled', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const issue = await seedIssue(f, 'scheduled', { items: [{ student: f.student }] })

    await expect(withRequest(() => svc.publish(issue, directorCtx(f)))).rejects.toBeInstanceOf(Forbidden)
    expect(await issueStatus(issue)).toBe('scheduled')
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${f.director}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'newsletter.publish', reason: 'subject_consent_unknown' })
  })

  test('a revoked (inactive) scoped consent -> subject_consent_missing, stays scheduled', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const issue = await seedIssue(f, 'scheduled', { items: [{ student: f.student }] })
    await grantExternalPub(f, issue)
    await revokeExternalPub(f)

    await expect(withRequest(() => svc.publish(issue, directorCtx(f)))).rejects.toBeInstanceOf(Forbidden)
    expect(await issueStatus(issue)).toBe('scheduled')
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${f.director}
    `
    expect(denied[0]!.detail).toMatchObject({ capability: 'newsletter.publish', reason: 'subject_consent_missing' })
  })

  test('an active scoped consent -> published, stamps published_by/at and enqueues the send after commit', async () => {
    const f = await setup()
    const enqueued: string[] = []
    const svc = new NewsletterService({ sql: h.sql, authorize, enqueueSend: (id) => { enqueued.push(id) } })
    const issue = await seedIssue(f, 'scheduled', { items: [{ student: f.student }] })
    await grantExternalPub(f, issue)

    await withRequest(() => svc.publish(issue, directorCtx(f)))
    expect(await issueStatus(issue)).toBe('published')
    const [row] = await h.sql`select published_by, published_at from newsletter_issue where id = ${issue}`
    expect(row!.published_by).toBe(f.director)
    expect(row!.published_at).not.toBeNull()
    expect(enqueued).toEqual([issue])
  })

  test('a consent scoped to a DIFFERENT issue -> subject_consent_missing', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const issue = await seedIssue(f, 'scheduled', { items: [{ student: f.student }] })
    const otherIssue = await seedIssue(f, 'draft')
    await grantExternalPub(f, otherIssue) // scoped to the wrong issue

    await expect(withRequest(() => svc.publish(issue, directorCtx(f)))).rejects.toBeInstanceOf(Forbidden)
    expect(await issueStatus(issue)).toBe('scheduled')
  })
})

// ===========================================================================
describe('runScheduledNewsletters: the system auto-publish job', () => {
  test('a due scheduled issue whose consent holds -> published', async () => {
    const f = await setup()
    const issue = await seedIssue(f, 'scheduled', {
      scheduledFor: new Date('2026-07-01T00:00:00Z'),
      items: [{ student: f.student }],
    })
    await grantExternalPub(f, issue)

    const enqueued: string[] = []
    const result = await runScheduledNewsletters(
      { sql: h.sql, enqueueSend: (id) => { enqueued.push(id) } },
      new Date('2026-07-23T00:00:00Z'),
    )
    expect(await issueStatus(issue)).toBe('published')
    expect(result.published).toContain(issue)
    expect(enqueued).toEqual([issue])
  })

  test('a due scheduled issue whose student consent is missing -> blocked, naming the student', async () => {
    const f = await setup()
    const issue = await seedIssue(f, 'scheduled', {
      scheduledFor: new Date('2026-07-01T00:00:00Z'),
      items: [{ student: f.student }],
    })
    // no consent granted

    const events: NewsletterNotification[] = []
    const result = await runScheduledNewsletters(
      { sql: h.sql, notifier: (e) => { events.push(e) } },
      new Date('2026-07-23T00:00:00Z'),
    )
    expect(await issueStatus(issue)).toBe('blocked')
    expect(result.published).not.toContain(issue)
    expect(result.blocked).toContainEqual({ issueId: issue, student: f.student })
    expect(events).toContainEqual({ kind: 'issue_blocked', issueId: issue, chapterId: f.chapter, student: f.student })
  })

  test('a not-yet-due scheduled issue is left untouched', async () => {
    const f = await setup()
    const issue = await seedIssue(f, 'scheduled', {
      scheduledFor: new Date('2026-12-01T00:00:00Z'),
      items: [{ student: f.student }],
    })
    await grantExternalPub(f, issue)
    await runScheduledNewsletters({ sql: h.sql }, new Date('2026-07-23T00:00:00Z'))
    expect(await issueStatus(issue)).toBe('scheduled')
  })
})

// ===========================================================================
describe('zero-student issue: platform_staff may publish; a student-item issue they may not', () => {
  function staffCtx(f: Setup): AuthContext {
    return ctxFor(f.staff, [membership('platform_staff', 'platform')])
  }

  test('platform_staff publishes a platform-wide issue with no student items', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const issue = await seedIssue(f, 'scheduled', { platformWide: true })
    await withRequest(() => svc.publish(issue, staffCtx(f)))
    expect(await issueStatus(issue)).toBe('published')
  })

  test('platform_staff may NOT publish an issue with a student item (out_of_scope)', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const issue = await seedIssue(f, 'scheduled', { platformWide: true, items: [{ student: f.student }] })
    await expect(withRequest(() => svc.publish(issue, staffCtx(f)))).rejects.toBeInstanceOf(Forbidden)
    expect(await issueStatus(issue)).toBe('scheduled')
  })
})

// ===========================================================================
describe('unpublish -> archived; a consent-driven unpublish redacts the affected item', () => {
  test('a director unpublishes a published issue (published -> archived)', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const issue = await seedIssue(f, 'published')
    await withRequest(() => svc.unpublish(issue, directorCtx(f)))
    expect(await issueStatus(issue)).toBe('archived')
  })

  test('a consent-driven unpublish redacts the revoked student item body, leaving staff items intact', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const issue = await seedIssue(f, 'published', { items: [{ student: f.student }, { student: null }] })

    await withRequest(() =>
      svc.unpublish(issue, directorCtx(f), { consentRevokedStudentAccountId: f.student }),
    )
    expect(await issueStatus(issue)).toBe('archived')

    const studentItem = await h.sql`
      select body from newsletter_item where issue_id = ${issue} and author_student_account_id = ${f.student}
    `
    expect(studentItem[0]!.body).toBe(REDACTED_NEWSLETTER_ITEM_BODY)
    const staffItem = await h.sql`
      select body from newsletter_item where issue_id = ${issue} and author_student_account_id is null
    `
    expect(staffItem[0]!.body).toBe('Item body')
  })
})

// ===========================================================================
describe('authorization enforced; illegal transitions rejected', () => {
  test('a stranger is denied on every method (Forbidden), nothing moves', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const stranger = await makeAdult(h.sql)
    const strangerCtx = ctxFor(stranger, [])

    const draft = await seedIssue(f, 'draft')
    const inReview = await seedIssue(f, 'in_review')
    const scheduled = await seedIssue(f, 'scheduled')
    const published = await seedIssue(f, 'published')

    await withRequest(async () => {
      await expect(
        svc.draft({ chapterId: f.chapter, title: 'x', body: 'y' }, strangerCtx),
      ).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.submitReview(draft, strangerCtx)).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.returnToDraft(inReview, strangerCtx)).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.schedule(scheduled, strangerCtx, new Date())).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.publish(scheduled, strangerCtx)).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.unpublish(published, strangerCtx)).rejects.toBeInstanceOf(Forbidden)
    })

    expect(await issueStatus(draft)).toBe('draft')
    expect(await issueStatus(inReview)).toBe('in_review')
    expect(await issueStatus(scheduled)).toBe('scheduled')
    expect(await issueStatus(published)).toBe('published')
  })

  test('returnToDraft (in_review -> draft) and unblock (blocked -> scheduled)', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const inReview = await seedIssue(f, 'in_review')
    await withRequest(() => svc.returnToDraft(inReview, directorCtx(f)))
    expect(await issueStatus(inReview)).toBe('draft')

    const blocked = await seedIssue(f, 'blocked')
    await withRequest(() => svc.unblock(blocked, directorCtx(f), 'scheduled', new Date('2026-09-01T00:00:00Z')))
    expect(await issueStatus(blocked)).toBe('scheduled')
  })

  test('an illegal edge is rejected (submitReview on a scheduled issue)', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const scheduled = await seedIssue(f, 'scheduled')
    await expect(withRequest(() => svc.submitReview(scheduled, commsCtx(f)))).rejects.toBeInstanceOf(
      IllegalNewsletterTransitionError,
    )
    expect(await issueStatus(scheduled)).toBe('scheduled')
  })

  test('publishing a draft (never scheduled) is an illegal edge', async () => {
    const f = await setup()
    const svc = new NewsletterService({ sql: h.sql, authorize })
    const draft = await seedIssue(f, 'draft')
    await grantExternalPub(f, draft) // consent is fine; the edge is not
    await expect(withRequest(() => svc.publish(draft, directorCtx(f)))).rejects.toBeInstanceOf(
      IllegalNewsletterTransitionError,
    )
    expect(await issueStatus(draft)).toBe('draft')
  })
})
