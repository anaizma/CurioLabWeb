// -------------------------------------------------------------------------
// Onboarding seed helpers for the HTTP controller tests. These drive the real
// service layer (EnrollmentService -> InviteService accept-student ->
// MembershipActivationService) to reach a fully-onboarded student, plus a
// chapter_director with a DB membership AND a live HTTP session token (so the
// controllers resolve a real AuthContext from the token, not an injected ctx).
//
// Mirrors the seeding chains in packages/app/test/{membership-activation,
// deletion-export-fulfillment}.test.ts. Synthetic data only.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import { authorize, createSession, withRequest } from '@curiolab/runtime'
import {
  EnrollmentService,
  InMemoryStorageAdapter,
  InviteService,
  MembershipActivationService,
} from '@curiolab/app'
import { baseCtx, mem } from '../../../app/test/helpers/ctx.js'
import { makeChapter } from './fixtures.js'

/** A chapter_director with a DB membership in `chapter` and a live session token. */
export interface DirectorSeed {
  chapter: string
  term: string
  director: string
  directorToken: string
}

export interface StudentSeed extends DirectorSeed {
  guardianEmail: string
  applicationId: string
  enrollmentRecordId: string
  accountId: string
  membershipId: string
}

/** Build the in-memory director AuthContext the service layer consumes directly. */
export function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}

/** A chapter, a term, a director account+membership, and the director's session token. */
export async function seedDirector(sql: Sql): Promise<DirectorSeed> {
  const chapter = await makeChapter(sql)
  const [term] = await sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const [dir] = await sql`
    insert into account (
      email, legal_name, display_name, date_of_birth, dob_provenance,
      credential_owner, status, maturation_state
    ) values (
      ${`director-${randomUUID().slice(0, 8)}@example.test`}, 'Director Testperson', 'Director T.',
      '1980-01-01', 'staff_entered', 'self_private', 'active', 'self_managed'
    ) returning id
  `
  const director = dir!.id as string
  await sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${director}, ${chapter}, 'chapter_director', 'active')
  `
  const { token } = await createSession(sql, {
    accountId: director,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return { chapter, term: term!.id as string, director, directorToken: token }
}

/** An accepted `student` application in `chapter`, returning its id and guardian email. */
export async function seedAcceptedApplication(
  sql: Sql,
  chapter: string,
): Promise<{ applicationId: string; guardianEmail: string }> {
  const guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`
  const [app] = await sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild',
      ${guardianEmail}, 'Parent Testperson', ${guardianEmail}, '2013-01-01T00:00:00Z'
    ) returning id
  `
  return { applicationId: app!.id as string, guardianEmail }
}

/**
 * The full onboarding chain ending at a PENDING student (membership+account
 * pending, form-sourced consents active) unless `activate` is set, in which case
 * it activates to ACTIVE with the Explorer tier.
 */
export async function onboardStudent(
  sql: Sql,
  opts: { activate?: boolean } = {},
): Promise<StudentSeed> {
  const base = await seedDirector(sql)
  const { applicationId, guardianEmail } = await seedAcceptedApplication(sql, base.chapter)
  const ctx = directorCtx(base.director, base.chapter)

  const enroll = new EnrollmentService({ sql, authorize, storage: new InMemoryStorageAdapter() })
  let enrollmentRecordId!: string
  await withRequest(async () => {
    const r = await enroll.createEnrollment(
      {
        applicationId,
        chapterId: base.chapter,
        termId: base.term,
        dateOfBirth: '2014-04-04',
        guardianNameOnForm: 'Parent Testperson',
        signatureDate: new Date('2014-05-05T00:00:00Z'),
        signedForm: { body: 'synthetic-signed-scan-bytes', contentType: 'application/pdf' },
      },
      ctx,
    )
    enrollmentRecordId = r.enrollmentRecordId
  })

  const invites = new InviteService({ sql, authorize })
  let token!: string
  await withRequest(async () => {
    token = (await invites.issueInvite({ kind: 'student', chapterId: base.chapter, enrollmentRecordId }, ctx)).token
  })
  const { accountId } = await invites.acceptInvite(token, {
    username: `curio-${randomUUID().slice(0, 8)}`,
    password: 'correct horse battery staple',
    legalName: 'Minor Testchild',
    displayName: 'Minor T.',
  })

  // A pod so a guardian's out-of-pod read logs a minor_record.read (the guardian
  // has no pod, so any non-null student pod differs).
  const [pod] = await sql`
    insert into pod (chapter_id, term_id, name) values (${base.chapter}, ${base.term}, 'Pod Alpha') returning id
  `
  const [m] = await sql`
    insert into membership (account_id, chapter_id, role, status, term_id, pod_id)
    values (${accountId}, ${base.chapter}, 'student', 'pending', ${base.term}, ${pod!.id}) returning id
  `
  const membershipId = m!.id as string

  if (opts.activate) {
    await withRequest(async () => {
      await new MembershipActivationService({ sql, authorize }).activateStudent(membershipId, ctx)
    })
  }

  return { ...base, guardianEmail, applicationId, enrollmentRecordId, accountId, membershipId }
}

/**
 * A verified guardian over an onboarded (active) student, with a DB membership-
 * free guardian account that has a live session token. Used by the guardian
 * portal tests.
 */
export async function seedVerifiedGuardian(
  sql: Sql,
  student: StudentSeed,
): Promise<{ guardian: string; guardianToken: string }> {
  const [g] = await sql`
    insert into account (
      email, legal_name, display_name, date_of_birth, dob_provenance,
      credential_owner, status, maturation_state
    ) values (
      ${student.guardianEmail}, 'Parent Testperson', 'Parent T.', '1985-01-01', 'staff_entered',
      'self_private', 'active', 'self_managed'
    ) returning id
  `
  const guardian = g!.id as string
  await sql`
    insert into guardianship (
      guardian_account_id, student_account_id, relationship, status,
      verification_method, verified_by, source_ref, verified_at
    ) values (
      ${guardian}, ${student.accountId}, 'guardian', 'verified',
      'signed_form_match', ${student.director}, ${randomUUID()}, now()
    )
  `
  const { token } = await createSession(sql, {
    accountId: guardian,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return { guardian, guardianToken: token }
}
