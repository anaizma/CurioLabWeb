// -------------------------------------------------------------------------
// §5 Rule 1 (BEHIND THE FLAG) — the publishing gate on the specific grant.
//
// When CONSENT_GRANT_LEDGER_ENFORCED is TRUE, narrative publish, project
// public_listed, and newsletter inclusion ADDITIONALLY require an active
// `public_publication` grant for the student. When FALSE (the default,
// production posture), the existing consent behavior is unchanged. Both states
// are tested here; the existing project/newsletter/profile suites cover the
// flag-off default independently (this file asserts the flag-off path directly
// too, so the additivity is explicit).
//
// The flag is injected per-service (config.consentGrantLedgerEnforced), not read
// from the environment, so the two states are deterministic in one run.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext, Membership, Role } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeMembership, makePod, makeTerm } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import {
  ConsentService,
  ConsentGrantService,
  NewsletterService,
  ProfileService,
  ProjectService,
  PublicationGrantRequiredError,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function membership(role: Role, chapterId: string, podId: string | null = null): Membership {
  return { chapter_id: chapterId, role, status: 'active', pod_id: podId, tier: null, active_from: null, active_until: null }
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
  pod: string
  director: string
  student: string
  guardian: string
  studentMembership: string
}

async function setup(studentDob = '2010-06-01'): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const pod = await makePod(h.sql, chapter, term)
  const director = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { dateOfBirth: studentDob })
  const guardian = await makeAdult(h.sql)
  const studentMembership = await makeMembership(h.sql, student, chapter, { role: 'student', podId: pod })
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
    ) values (${app!.id}, ${student}, ${chapter}, ${term}, ${randomUUID()}, 'Parent Testperson', ${director})
  `
  return { chapter, term, pod, director, student, guardian, studentMembership }
}

async function seedVerifiedProject(f: Setup): Promise<string> {
  const [row] = await h.sql`
    insert into project (chapter_id, owner_membership_id, title, status, verified_by, verified_at)
    values (${f.chapter}, ${f.studentMembership}, 'My Robot', 'verified', ${f.director}, now())
    returning id
  `
  return row!.id as string
}

/** The old gate: the owner's external_publication consent scoped to the item. */
async function grantExternalPub(f: Setup, scopeRef: string): Promise<void> {
  const gctx = guardianCtx(f.guardian, [f.student])
  await withRequest(async () => {
    await new ConsentService({ sql: h.sql, authorize }).grantConsent(f.student, 'external_publication', gctx, { scopeRef })
  })
}

/** The new gate: an active public_publication grant for the student. */
async function grantPublicPublication(f: Setup): Promise<void> {
  const gctx = guardianCtx(f.guardian, [f.student])
  await withRequest(async () => {
    await new ConsentGrantService({ sql: h.sql, authorize }).captureGrant(f.student, 'public_publication', gctx, { method: 'click' })
  })
}

async function projectStatus(id: string): Promise<string | undefined> {
  const [r] = await h.sql`select status from project where id = ${id}`
  return r?.status as string | undefined
}

// ---------------------------------------------------------------------------
describe('project public_listed gate', () => {
  test('flag OFF: the existing external_publication behavior is unchanged (publishes)', async () => {
    const f = await setup()
    const project = await seedVerifiedProject(f)
    await grantExternalPub(f, project)
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const svc = new ProjectService({ sql: h.sql, authorize }) // default: flag off
    await withRequest(() => svc.publishPublic(project, directorCtx))
    expect(await projectStatus(project)).toBe('public_listed')
  })

  test('flag ON without a public_publication grant: refused, stays verified', async () => {
    const f = await setup()
    const project = await seedVerifiedProject(f)
    await grantExternalPub(f, project) // old gate satisfied
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const svc = new ProjectService({ sql: h.sql, authorize, config: { consentGrantLedgerEnforced: true } })
    await expect(withRequest(() => svc.publishPublic(project, directorCtx))).rejects.toBeInstanceOf(
      PublicationGrantRequiredError,
    )
    expect(await projectStatus(project)).toBe('verified')
  })

  test('flag ON with a public_publication grant: publishes', async () => {
    const f = await setup()
    const project = await seedVerifiedProject(f)
    await grantExternalPub(f, project)
    await grantPublicPublication(f)
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const svc = new ProjectService({ sql: h.sql, authorize, config: { consentGrantLedgerEnforced: true } })
    await withRequest(() => svc.publishPublic(project, directorCtx))
    expect(await projectStatus(project)).toBe('public_listed')
  })
})

// ---------------------------------------------------------------------------
describe('newsletter inclusion gate', () => {
  async function scheduledIssueWithStudentItem(f: Setup): Promise<string> {
    const [issue] = await h.sql`
      insert into newsletter_issue (chapter_id, title, body, status, scheduled_for)
      values (${f.chapter}, 'Issue', 'body', 'scheduled', now() + interval '1 day') returning id
    `
    await h.sql`
      insert into newsletter_item (issue_id, author_student_account_id, body)
      values (${issue!.id}, ${f.student}, 'student work')
    `
    return issue!.id as string
  }
  // The old coupling-E gate wants the item's external_publication scoped to the issue.
  async function grantExternalPubScoped(f: Setup, issueId: string): Promise<void> {
    const gctx = guardianCtx(f.guardian, [f.student])
    await withRequest(async () => {
      await new ConsentService({ sql: h.sql, authorize }).grantConsent(f.student, 'external_publication', gctx, { scopeRef: issueId })
    })
  }

  test('flag ON without a public_publication grant: publish refused', async () => {
    const f = await setup()
    const issue = await scheduledIssueWithStudentItem(f)
    await grantExternalPubScoped(f, issue)
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const svc = new NewsletterService({ sql: h.sql, authorize, config: { consentGrantLedgerEnforced: true } })
    await expect(withRequest(() => svc.publish(issue, directorCtx))).rejects.toBeInstanceOf(
      PublicationGrantRequiredError,
    )
    const [row] = await h.sql`select status from newsletter_issue where id = ${issue}`
    expect(row!.status).toBe('scheduled')
  })

  test('flag ON with a public_publication grant: publishes', async () => {
    const f = await setup()
    const issue = await scheduledIssueWithStudentItem(f)
    await grantExternalPubScoped(f, issue)
    await grantPublicPublication(f)
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const svc = new NewsletterService({ sql: h.sql, authorize, config: { consentGrantLedgerEnforced: true } })
    await withRequest(() => svc.publish(issue, directorCtx))
    const [row] = await h.sql`select status from newsletter_issue where id = ${issue}`
    expect(row!.status).toBe('published')
  })
})

// ---------------------------------------------------------------------------
describe('narrative publish gate (reviewNarrative)', () => {
  async function pendingNarrative(f: Setup): Promise<string> {
    const [row] = await h.sql`
      insert into profile_narrative (account_id, body, status)
      values (${f.student}, 'hello', 'pending_review') returning id
    `
    return row!.id as string
  }

  test('flag OFF: a reviewer clears the narrative to published (unchanged)', async () => {
    const f = await setup()
    const narr = await pendingNarrative(f)
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const svc = new ProfileService({ sql: h.sql, authorize })
    await withRequest(() => svc.reviewNarrative(narr, directorCtx))
    const [row] = await h.sql`select status from profile_narrative where id = ${narr}`
    expect(row!.status).toBe('published')
  })

  test('flag ON without a grant: review refused, stays pending_review', async () => {
    const f = await setup()
    const narr = await pendingNarrative(f)
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const svc = new ProfileService({ sql: h.sql, authorize, config: { consentGrantLedgerEnforced: true } })
    await expect(withRequest(() => svc.reviewNarrative(narr, directorCtx))).rejects.toBeInstanceOf(
      PublicationGrantRequiredError,
    )
    const [row] = await h.sql`select status from profile_narrative where id = ${narr}`
    expect(row!.status).toBe('pending_review')
  })

  test('flag ON with a grant: review publishes', async () => {
    const f = await setup()
    const narr = await pendingNarrative(f)
    await grantPublicPublication(f)
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const svc = new ProfileService({ sql: h.sql, authorize, config: { consentGrantLedgerEnforced: true } })
    await withRequest(() => svc.reviewNarrative(narr, directorCtx))
    const [row] = await h.sql`select status from profile_narrative where id = ${narr}`
    expect(row!.status).toBe('published')
  })
})
