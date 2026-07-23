// -------------------------------------------------------------------------
// ProjectService tests (Milestone 3.2) — the project lifecycle service and the
// C2 consent-revoke coupling. Embedded Postgres, synthetic data only.
//
// Under test (02-data-model project; 03-authorization project.*; 04-state-machines
// the project machine draft -> submitted -> verified -> public_listed and coupling
// C2 external_publication revoke -> de-list):
//
//   - create (student or instructor) -> submit (owner student) -> verify
//     (pod instructor or director, stamping verified_by / verified_at); a verified
//     project is eligible as a tier_transition evidence_ref;
//   - publishPublic requires an active external_publication consent for the OWNER
//     student scoped to the project: absent snapshot -> subject_consent_unknown,
//     revoked/mismatched -> subject_consent_missing, active+scoped -> public_listed;
//   - coupling C2: revoking the scoped external_publication consent reverts the
//     project public_listed -> verified in the SAME transaction as the revoke
//     (a failure injected after the de-list rolls back BOTH);
//   - verify by an out-of-scope instructor is denied, by the pod's instructor or a
//     director allowed; illegal edges are rejected;
//   - every method is authorization-gated: a stranger denies with a reason-less
//     Forbidden and one permission.denied row, and nothing persists.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { AuthContext, Membership, Role } from '@curiolab/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter, makeMinor, makeTerm, makePod, makeMembership } from './helpers/fixtures.js'
import { baseCtx } from './helpers/ctx.js'
import {
  ProjectService,
  ConsentService,
  projectExternalPublicationRevokeCascade,
  IllegalProjectTransitionError,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

// A pod/chapter-aware membership (the app ctx `mem` helper is chapter-wide only).
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
  instructor: string
  student: string
  guardian: string
  studentMembership: string
  outInstructor: string
  outChapter: string
}

// A chapter with a pod, a director, a pod instructor, an owning student (minor,
// with an accepted application + linked enrollment so the consent anchor
// resolves), a guardian, and an instructor in a DIFFERENT chapter (out of scope
// for this project's pod).
async function setup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const term = await makeTerm(h.sql, chapter)
  const pod = await makePod(h.sql, chapter, term)
  const director = await makeAdult(h.sql)
  const instructor = await makeAdult(h.sql)
  const student = await makeMinor(h.sql, { dateOfBirth: '2015-06-01' })
  const guardian = await makeAdult(h.sql)
  const studentMembership = await makeMembership(h.sql, student, chapter, {
    role: 'student',
    podId: pod,
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
  const outChapter = await makeChapter(h.sql)
  const outInstructor = await makeAdult(h.sql)
  return {
    chapter,
    term,
    pod,
    director,
    instructor,
    student,
    guardian,
    studentMembership,
    outInstructor,
    outChapter,
  }
}

async function projectStatus(id: string): Promise<string | undefined> {
  const [r] = await h.sql`select status from project where id = ${id}`
  return r?.status as string | undefined
}

/** Insert a project already in the given status, owned by the student membership. */
async function seedProject(f: Setup, status: string): Promise<string> {
  const [row] = await h.sql`
    insert into project (chapter_id, owner_membership_id, title, status, verified_by, verified_at)
    values (
      ${f.chapter}, ${f.studentMembership}, 'My Robot', ${status},
      ${status === 'draft' || status === 'submitted' ? null : f.director},
      ${status === 'draft' || status === 'submitted' ? null : h.sql`now()`}
    ) returning id
  `
  return row!.id as string
}

async function grantExternalPub(
  f: Setup,
  scopeRef: string,
  svc = new ConsentService({ sql: h.sql, authorize }),
): Promise<void> {
  const gctx = guardianCtx(f.guardian, [f.student])
  await withRequest(async () => {
    await svc.grantConsent(f.student, 'external_publication', gctx, { scopeRef })
  })
}

// ===========================================================================
describe('the lifecycle: create -> submit -> verify', () => {
  test('a student creates a draft project owned by their membership', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const studentCtx = ctxFor(f.student, [membership('student', f.chapter, f.pod)])

    const created = await withRequest(() =>
      svc.create(
        { chapterId: f.chapter, ownerMembershipId: f.studentMembership, title: 'My Robot' },
        studentCtx,
      ),
    )

    expect(created.status).toBe('draft')
    const [row] = await h.sql`select status, owner_membership_id from project where id = ${created.projectId}`
    expect(row!.status).toBe('draft')
    expect(row!.owner_membership_id).toBe(f.studentMembership)
  })

  test('an instructor may also create a project (student or instructor)', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const instructorCtx = ctxFor(f.instructor, [membership('lead_instructor', f.chapter, f.pod)])

    const created = await withRequest(() =>
      svc.create(
        { chapterId: f.chapter, ownerMembershipId: f.studentMembership, title: 'Mentor-seeded' },
        instructorCtx,
      ),
    )
    expect(await projectStatus(created.projectId)).toBe('draft')
  })

  test('the owner student submits (draft -> submitted), then verify stamps verified_by/verified_at', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const studentCtx = ctxFor(f.student, [membership('student', f.chapter, f.pod)])
    const instructorCtx = ctxFor(f.instructor, [membership('lead_instructor', f.chapter, f.pod)])

    const created = await withRequest(() =>
      svc.create({ chapterId: f.chapter, ownerMembershipId: f.studentMembership, title: 'My Robot' }, studentCtx),
    )
    await withRequest(() => svc.submit(created.projectId, studentCtx))
    expect(await projectStatus(created.projectId)).toBe('submitted')

    await withRequest(() => svc.verify(created.projectId, instructorCtx))

    const [row] = await h.sql`select status, verified_by, verified_at from project where id = ${created.projectId}`
    expect(row!.status).toBe('verified')
    expect(row!.verified_by).toBe(f.instructor)
    expect(row!.verified_at).not.toBeNull()
  })

  test('a verified project is eligible as a tier_transition evidence_ref', async () => {
    const f = await setup()
    const project = await seedProject(f, 'verified')

    // A verified project id used as the evidence for a tier grant; the sync
    // trigger promotes the membership's current_tier.
    const [tt] = await h.sql`
      insert into tier_transition (membership_id, from_tier, to_tier, granted_by, evidence_ref, note)
      values (${f.studentMembership}, ${null}, 'builder', ${f.director}, ${project}, 'first verified project')
      returning id
    `
    expect(tt!.id).toBeTruthy()
    const [m] = await h.sql`select current_tier from membership where id = ${f.studentMembership}`
    expect(m!.current_tier).toBe('builder')
  })

  test('an illegal edge is rejected (verify on a draft)', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const project = await seedProject(f, 'draft')
    const instructorCtx = ctxFor(f.instructor, [membership('lead_instructor', f.chapter, f.pod)])

    await expect(withRequest(() => svc.verify(project, instructorCtx))).rejects.toBeInstanceOf(
      IllegalProjectTransitionError,
    )
    expect(await projectStatus(project)).toBe('draft')
  })
})

// ===========================================================================
describe('verify authorization: own pod / director allowed, out of scope denied', () => {
  test("the pod's instructor may verify", async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const project = await seedProject(f, 'submitted')
    const instructorCtx = ctxFor(f.instructor, [membership('lead_instructor', f.chapter, f.pod)])
    await withRequest(() => svc.verify(project, instructorCtx))
    expect(await projectStatus(project)).toBe('verified')
  })

  test('a chapter director may verify', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const project = await seedProject(f, 'submitted')
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    await withRequest(() => svc.verify(project, directorCtx))
    expect(await projectStatus(project)).toBe('verified')
  })

  test('an instructor with no scope over the project (different chapter/pod) is denied', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const project = await seedProject(f, 'submitted')
    const outCtx = ctxFor(f.outInstructor, [membership('lead_instructor', f.outChapter, null)])

    await expect(withRequest(() => svc.verify(project, outCtx))).rejects.toBeInstanceOf(Forbidden)
    expect(await projectStatus(project)).toBe('submitted')
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${f.outInstructor}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'project.verify', reason: 'out_of_scope' })
  })
})

// ===========================================================================
describe('publishPublic requires the owner student external_publication consent scoped to the project', () => {
  test('absent snapshot -> subject_consent_unknown (fails closed), stays verified', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const project = await seedProject(f, 'verified')
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])

    await expect(withRequest(() => svc.publishPublic(project, directorCtx))).rejects.toBeInstanceOf(Forbidden)
    expect(await projectStatus(project)).toBe('verified')
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${f.director}
    `
    expect(denied).toHaveLength(1)
    expect(denied[0]!.detail).toMatchObject({ capability: 'project.publish_public', reason: 'subject_consent_unknown' })
  })

  test('a revoked (inactive) scoped consent -> subject_consent_missing, stays verified', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const project = await seedProject(f, 'verified')
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    const consentSvc = new ConsentService({ sql: h.sql, authorize })
    const gctx = guardianCtx(f.guardian, [f.student])

    await withRequest(async () => {
      await consentSvc.grantConsent(f.student, 'external_publication', gctx, { scopeRef: project })
      await consentSvc.revokeConsent(f.student, 'external_publication', gctx)
    })

    await expect(withRequest(() => svc.publishPublic(project, directorCtx))).rejects.toBeInstanceOf(Forbidden)
    expect(await projectStatus(project)).toBe('verified')
    const denied = await h.sql`
      select detail from audit_entry where action = 'permission.denied' and actor_account_id = ${f.director}
    `
    expect(denied[0]!.detail).toMatchObject({ capability: 'project.publish_public', reason: 'subject_consent_missing' })
  })

  test('an active scoped consent -> public_listed', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const project = await seedProject(f, 'verified')
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    await grantExternalPub(f, project)

    await withRequest(() => svc.publishPublic(project, directorCtx))
    expect(await projectStatus(project)).toBe('public_listed')
  })
})

// ===========================================================================
describe('coupling C2: revoking the scoped consent reverts public_listed -> verified atomically', () => {
  async function publish(f: Setup, project: string): Promise<void> {
    const svc = new ProjectService({ sql: h.sql, authorize })
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])
    await grantExternalPub(f, project)
    await withRequest(() => svc.publishPublic(project, directorCtx))
  }

  test('the revoke de-lists the project and flips consent_current, together', async () => {
    const f = await setup()
    const project = await seedProject(f, 'verified')
    await publish(f, project)
    expect(await projectStatus(project)).toBe('public_listed')

    const consentSvc = new ConsentService({
      sql: h.sql,
      authorize,
      onRevoke: projectExternalPublicationRevokeCascade,
    })
    const gctx = guardianCtx(f.guardian, [f.student])
    await withRequest(() => consentSvc.revokeConsent(f.student, 'external_publication', gctx))

    expect(await projectStatus(project)).toBe('verified')
    const [cur] = await h.sql`
      select active from consent_current where student_account_id = ${f.student} and type = 'external_publication'
    `
    expect(cur!.active).toBe(false)
  })

  test('a failure injected after the de-list rolls BOTH back (nothing persisted)', async () => {
    const f = await setup()
    const project = await seedProject(f, 'verified')
    await publish(f, project)

    // Wrap the real cascade so it performs the de-list and then throws, inside the
    // revoke transaction: the de-list and the revoke row must roll back together.
    const failingCascade = async (
      tx: Parameters<typeof projectExternalPublicationRevokeCascade>[0],
      args: Parameters<typeof projectExternalPublicationRevokeCascade>[1],
    ): Promise<void> => {
      await projectExternalPublicationRevokeCascade(tx, args)
      throw new Error('injected failure after de-list')
    }
    const consentSvc = new ConsentService({ sql: h.sql, authorize, onRevoke: failingCascade })
    const gctx = guardianCtx(f.guardian, [f.student])

    await expect(
      withRequest(() => consentSvc.revokeConsent(f.student, 'external_publication', gctx)),
    ).rejects.toThrow(/injected failure/)

    // Neither the de-list nor the revoke persisted.
    expect(await projectStatus(project)).toBe('public_listed')
    const [cur] = await h.sql`
      select active from consent_current where student_account_id = ${f.student} and type = 'external_publication'
    `
    expect(cur!.active).toBe(true)
  })
})

// ===========================================================================
describe('every method is authorization-gated (a stranger is denied)', () => {
  test('create / submit / verify / publishPublic / unpublish deny a stranger with a permission.denied row', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const stranger = await makeAdult(h.sql)
    const strangerCtx = ctxFor(stranger, []) // no memberships anywhere

    const draft = await seedProject(f, 'draft')
    const submitted = await seedProject(f, 'submitted')
    const verified = await seedProject(f, 'verified')
    const listed = await seedProject(f, 'public_listed')

    await withRequest(async () => {
      await expect(
        svc.create({ chapterId: f.chapter, ownerMembershipId: f.studentMembership, title: 'x' }, strangerCtx),
      ).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.submit(draft, strangerCtx)).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.verify(submitted, strangerCtx)).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.publishPublic(verified, strangerCtx)).rejects.toBeInstanceOf(Forbidden)
      await expect(svc.unpublish(listed, strangerCtx)).rejects.toBeInstanceOf(Forbidden)
    })

    // Nothing moved.
    expect(await projectStatus(draft)).toBe('draft')
    expect(await projectStatus(submitted)).toBe('submitted')
    expect(await projectStatus(verified)).toBe('verified')
    expect(await projectStatus(listed)).toBe('public_listed')

    const denied = await h.sql`
      select count(*)::int as n from audit_entry
      where action = 'permission.denied' and actor_account_id = ${stranger}
    `
    expect(denied[0]!.n).toBe(5)
  })

  test('a director may unpublish (public_listed -> verified)', async () => {
    const f = await setup()
    const svc = new ProjectService({ sql: h.sql, authorize })
    const listed = await seedProject(f, 'public_listed')
    const directorCtx = ctxFor(f.director, [membership('chapter_director', f.chapter, null)])

    await withRequest(() => svc.unpublish(listed, directorCtx))
    expect(await projectStatus(listed)).toBe('verified')
  })
})
