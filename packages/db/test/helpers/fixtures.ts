// Small insert helpers that return generated ids. Names and dates are
// obviously synthetic (per the test-data policy) so a real record showing up
// in a test database is an immediately visible incident.

import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'

/** Default only when the override is absent; an explicit null is preserved. */
function def<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value
}

export async function makeChapter(sql: Sql): Promise<string> {
  const [row] = await sql`
    insert into chapter (name, slug, tier, status, timezone)
    values ('Test Chapter', ${'chapter-' + randomUUID()}, 'active', 'active', 'America/New_York')
    returning id
  `
  return row!.id as string
}

export async function makeTerm(sql: Sql, chapterId: string): Promise<string> {
  const [row] = await sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapterId}, 'Fall Term 2099', '2099-09-01', '2099-12-15')
    returning id
  `
  return row!.id as string
}

export async function makePod(sql: Sql, chapterId: string, termId: string): Promise<string> {
  const [row] = await sql`
    insert into pod (chapter_id, term_id, name)
    values (${chapterId}, ${termId}, 'Pod Alpha')
    returning id
  `
  return row!.id as string
}

interface AccountOverrides {
  email?: string | null
  username?: string | null
  dateOfBirth?: string
  dobProvenance?: 'enrollment_record' | 'self_reported' | 'staff_entered'
  dobSourceRef?: string | null
  credentialOwner?: 'guardian_provisioned' | 'self_private'
  status?: 'invited' | 'pending' | 'active' | 'suspended' | 'closed'
  maturationState?: 'minor' | 'maturation_pending' | 'self_managed'
}

/** An adult, email-identified account (no DOB-provenance obligation). */
export async function makeAdult(sql: Sql, o: AccountOverrides = {}): Promise<string> {
  const [row] = await sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${def(o.email, `adult-${randomUUID()}@example.test`)}, ${def(o.username, null)},
      'Adult Testperson', 'Adult T.', ${o.dateOfBirth ?? '1990-01-01'},
      ${o.dobProvenance ?? 'staff_entered'}, ${def(o.dobSourceRef, null)},
      ${o.credentialOwner ?? 'self_private'}, ${o.status ?? 'active'},
      ${o.maturationState ?? 'self_managed'}
    ) returning id
  `
  return row!.id as string
}

/** A minor, username-identified student account. */
export async function makeMinor(sql: Sql, o: AccountOverrides = {}): Promise<string> {
  const [row] = await sql`
    insert into account (
      email, username, legal_name, display_name, date_of_birth,
      dob_provenance, dob_source_ref, credential_owner, status, maturation_state
    ) values (
      ${def(o.email, null)}, ${def(o.username, `student-${randomUUID().slice(0, 8)}`)},
      'Minor Testchild', 'Minor T.', ${o.dateOfBirth ?? '2015-06-01'},
      ${o.dobProvenance ?? 'enrollment_record'}, ${def(o.dobSourceRef, randomUUID())},
      ${o.credentialOwner ?? 'guardian_provisioned'}, ${o.status ?? 'active'},
      ${o.maturationState ?? 'minor'}
    ) returning id
  `
  return row!.id as string
}

export async function makeMembership(
  sql: Sql,
  accountId: string,
  chapterId: string,
  overrides: {
    role?: string
    status?: string
    podId?: string | null
    currentTier?: string | null
  } = {},
): Promise<string> {
  const [row] = await sql`
    insert into membership (account_id, chapter_id, role, status, pod_id, current_tier)
    values (
      ${accountId}, ${chapterId}, ${overrides.role ?? 'student'},
      ${overrides.status ?? 'active'}, ${overrides.podId ?? null},
      ${overrides.currentTier ?? null}
    ) returning id
  `
  return row!.id as string
}

export async function makeApplication(
  sql: Sql,
  chapterId: string,
  guardianEmail: string,
): Promise<string> {
  const [row] = await sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email
    ) values (
      'student', ${chapterId}, 'submitted', 'Minor Testchild',
      ${guardianEmail}, 'Parent Testperson', ${guardianEmail}
    ) returning id
  `
  return row!.id as string
}

export async function makeEnrollment(
  sql: Sql,
  args: {
    applicationId: string
    chapterId: string
    termId: string
    createdBy: string
    /** Present for a returning student's enrollment; absent = a seeding one. */
    studentAccountId?: string | null
    /**
     * The form's DOB. Defaults to a seeding value so the NOT-NULL-when-seeding
     * check is satisfied; pass null explicitly for a returning enrollment (which
     * carries an account and no second DOB copy).
     */
    dateOfBirth?: string | null
  },
): Promise<string> {
  const studentAccountId = def(args.studentAccountId, null)
  // Seeding enrollment (no account yet) must carry the DOB; a returning one
  // (account present) leaves it null. Default to the seeding shape.
  const dateOfBirth = def(
    args.dateOfBirth,
    studentAccountId === null ? '2015-06-01' : null,
  )
  const [row] = await sql`
    insert into enrollment_record (
      application_id, student_account_id, chapter_id, term_id, signed_form_ref,
      guardian_name_on_form, date_of_birth, created_by
    ) values (
      ${args.applicationId}, ${studentAccountId}, ${args.chapterId}, ${args.termId}, ${randomUUID()},
      'Parent Testperson', ${dateOfBirth}, ${args.createdBy}
    ) returning id
  `
  return row!.id as string
}
