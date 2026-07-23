// -------------------------------------------------------------------------
// Seed helpers for the Milestone 3.7 HTTP controller tests (profile, projects,
// media, newsletter ops, verification, public reads). Unlike the app-layer
// service tests (which inject a hand-built AuthContext), the HTTP controllers
// resolve the AuthContext from a live session token, so these seeds create real
// DB rows (accounts, memberships with roles/pods, an accepted application +
// enrollment_record so the consent anchor resolves) AND session tokens.
//
// Synthetic data only (obviously fake names/dates per the test-data policy).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { authorize, createSession, withRequest } from '@curiolab/runtime'
import { ConsentService } from '@curiolab/app'
import { baseCtx } from '../../../app/test/helpers/ctx.js'
import { makeAdult, makeChapter, makeMinor, makeMembership, makePod, makeTerm } from './fixtures.js'

export interface M3Seed {
  chapter: string
  term: string
  pod: string
  /** chapter_director, active membership + live session token. */
  director: string
  directorToken: string
  /** lead_instructor in the chapter (project.verify / media.review via chapter scope). */
  instructor: string
  instructorToken: string
  /** A MINOR student in the pod, Explorer tier, with a live session token. */
  student: string
  studentToken: string
  studentMembership: string
  /** The student's guardian account (no DB edge needed for consent seeding). */
  guardian: string
}

/** A live session token for an account (one-hour expiry). */
export async function sessionFor(sql: Sql, accountId: string): Promise<string> {
  const { token } = await createSession(sql, {
    accountId,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return token
}

/** The full M3 cast: a chapter/pod, a director, a pod instructor, a minor student, a guardian. */
export async function seedM3(sql: Sql): Promise<M3Seed> {
  const chapter = await makeChapter(sql)
  const term = await makeTerm(sql, chapter)
  const pod = await makePod(sql, chapter, term)

  const director = await makeAdult(sql)
  await makeMembership(sql, director, chapter, { role: 'chapter_director' })

  // A lead_instructor authorizes project.verify / media.review by CHAPTER scope;
  // the pod-scope check constraint bars a teaching role from carrying a pod_id.
  const instructor = await makeAdult(sql)
  await makeMembership(sql, instructor, chapter, { role: 'lead_instructor' })

  const student = await makeMinor(sql, { dateOfBirth: '2015-06-01' })
  const studentMembership = await makeMembership(sql, student, chapter, {
    role: 'student',
    podId: pod,
    currentTier: 'explorer',
  })
  const guardian = await makeAdult(sql)

  // An accepted application + linked enrollment_record so any consent anchor resolves.
  const [app] = await sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild', 'parent@example.test',
      'Parent Testperson', 'parent@example.test', '2026-06-01T00:00:00Z'
    ) returning id
  `
  await sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id,
      signed_form_ref, guardian_name_on_form, created_by
    ) values (
      ${app!.id}, ${student}, ${chapter}, ${term},
      ${randomUUID()}, 'Parent Testperson', ${director}
    )
  `

  return {
    chapter,
    term,
    pod,
    director,
    directorToken: await sessionFor(sql, director),
    instructor,
    instructorToken: await sessionFor(sql, instructor),
    student,
    studentToken: await sessionFor(sql, student),
    studentMembership,
    guardian,
  }
}

/** A hand-built guardian AuthContext for seeding consents (the grant authorizes on ctx.guardianOf). */
export function guardianCtx(guardianId: string, children: string[]) {
  return { ...baseCtx(guardianId, new Date()), guardianOf: children }
}

/** Grant a consent for `student` as their guardian (used to seed publish/verify gates). */
export async function grantConsent(
  sql: Sql,
  student: string,
  guardian: string,
  type: 'external_publication' | 'public_profile' | 'photo_media',
  opts: { scopeRef?: string } = {},
): Promise<void> {
  const svc = new ConsentService({ sql, authorize })
  await withRequest(() => svc.grantConsent(student, type, guardianCtx(guardian, [student]), opts))
}

/** Insert a project owned by the student's membership in the given status. */
export async function seedProject(
  sql: Sql,
  s: M3Seed,
  status: string,
  title = 'My Robot',
): Promise<string> {
  const verified = !(status === 'draft' || status === 'submitted')
  const [row] = await sql`
    insert into project (chapter_id, owner_membership_id, title, status, verified_by, verified_at)
    values (
      ${s.chapter}, ${s.studentMembership}, ${title}, ${status},
      ${verified ? s.director : null}, ${verified ? sql`now()` : null}
    ) returning id
  `
  return row!.id as string
}
