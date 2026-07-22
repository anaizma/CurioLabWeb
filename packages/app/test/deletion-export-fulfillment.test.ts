// -------------------------------------------------------------------------
// DeletionFulfillmentService + ExportFulfillmentService tests (Milestone 1 the
// ops compliance side: deletion review + tiered fulfillment, and export
// fulfillment). Embedded Postgres, synthetic data only.
//
// Grounded in compliance-coppa.md 1.6 (§ 312.6: the parent's deletion right
// wins; § 312.6(c) permits terminating participation) and Part 3 (tiered
// deletion: full erase removes the verification skeleton, redaction preserves an
// anonymized skeleton), 04-state-machines.md (deletion_request lifecycle; the
// offboard bundle coupling B), and 02-data-model.md (audit detail holds
// references, never erased PII; the refused-needs-a-reason DB CHECK).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  EnrollmentService,
  InviteService,
  InMemoryStorageAdapter,
  MembershipActivationService,
  DeletionFulfillmentService,
  ExportFulfillmentService,
  DeletionReasonRequiredError,
  IllegalDeletionTransitionError,
  type DeletionFulfillmentAuthorizeFn,
  type ExportFulfillmentAuthorizeFn,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}

interface SeededStudent {
  chapter: string
  director: string
  accountId: string
  membershipId: string
  enrollmentRecordId: string
  sessionId: string
}

// The full seeding chain ending at an ACTIVE student (membership active, account
// active, Explorer tier granted, form-sourced consents active), plus a live
// session so its revocation is observable. Mirrors membership-activation.test.ts.
async function seededActiveStudent(): Promise<SeededStudent> {
  const chapter = await makeChapter(h.sql)
  const [term] = await h.sql`
    insert into term (chapter_id, name, starts_on, ends_on)
    values (${chapter}, 'Fall Term 2099', '2099-09-01', '2099-12-15') returning id
  `
  const [dir] = await h.sql`
    insert into account (
      email, legal_name, display_name, date_of_birth, dob_provenance,
      credential_owner, status, maturation_state
    ) values (
      ${`director-${randomUUID().slice(0, 8)}@example.test`}, 'Director Testperson', 'Director T.',
      '1980-01-01', 'staff_entered', 'self_private', 'active', 'self_managed'
    ) returning id
  `
  const director = dir!.id as string
  const guardianEmail = `parent-${randomUUID().slice(0, 8)}@example.test`
  const [app] = await h.sql`
    insert into application (
      kind, chapter_id, status, applicant_name, applicant_contact_email,
      guardian_name, guardian_email, created_at
    ) values (
      'student', ${chapter}, 'accepted', 'Minor Testchild',
      ${guardianEmail}, 'Parent Testperson', ${guardianEmail}, '2013-01-01T00:00:00Z'
    ) returning id
  `
  const ctx = directorCtx(director, chapter)

  const enroll = new EnrollmentService({ sql: h.sql, authorize, storage: new InMemoryStorageAdapter() })
  let enrollmentRecordId!: string
  await withRequest(async () => {
    const r = await enroll.createEnrollment(
      {
        applicationId: app!.id as string,
        chapterId: chapter,
        termId: term!.id as string,
        dateOfBirth: '2014-04-04',
        guardianNameOnForm: 'Parent Testperson',
        signatureDate: new Date('2014-05-05T00:00:00Z'),
        signedForm: { body: 'synthetic-signed-scan-bytes', contentType: 'application/pdf' },
      },
      ctx,
    )
    enrollmentRecordId = r.enrollmentRecordId
  })

  const invites = new InviteService({ sql: h.sql, authorize })
  let token!: string
  await withRequest(async () => {
    token = (await invites.issueInvite({ kind: 'student', chapterId: chapter, enrollmentRecordId }, ctx)).token
  })
  const username = `curio-${randomUUID().slice(0, 8)}`
  const { accountId } = await invites.acceptInvite(token, {
    username,
    password: 'correct horse battery staple',
    legalName: 'Minor Testchild',
    displayName: 'Minor T.',
  })

  const [m] = await h.sql`
    insert into membership (account_id, chapter_id, role, status, term_id)
    values (${accountId}, ${chapter}, 'student', 'pending', ${term!.id}) returning id
  `
  const membershipId = m!.id as string

  await withRequest(async () => {
    await new MembershipActivationService({ sql: h.sql, authorize }).activateStudent(membershipId, ctx)
  })

  const [sess] = await h.sql`
    insert into session (token_hash, account_id, mode, expires_at)
    values (${randomUUID()}, ${accountId}, 'full', now() + interval '1 day') returning id
  `

  return { chapter, director, accountId, membershipId, enrollmentRecordId, sessionId: sess!.id as string }
}

async function fileDeletionRequest(
  subjectAccountId: string,
  requestedBy: string,
  scope: 'full' | 'redaction',
): Promise<string> {
  const [row] = await h.sql`
    insert into deletion_request (subject_account_id, requested_by, scope_requested, status)
    values (${subjectAccountId}, ${requestedBy}, ${scope}, 'requested') returning id
  `
  return row!.id as string
}

async function accountRow(accountId: string) {
  const [a] = await h.sql`
    select status, legal_name, display_name, username, email, date_of_birth
    from account where id = ${accountId}
  `
  return a!
}

async function membershipRow(membershipId: string) {
  const [m] = await h.sql`select status, current_tier from membership where id = ${membershipId}`
  return m!
}

async function tierCount(membershipId: string): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from tier_transition where membership_id = ${membershipId}`
  return row!.n as number
}

function deletionSvc(authorizeFn = authorize as unknown as DeletionFulfillmentAuthorizeFn) {
  return new DeletionFulfillmentService({ sql: h.sql, authorize: authorizeFn })
}
function exportSvc(authorizeFn = authorize as unknown as ExportFulfillmentAuthorizeFn) {
  return new ExportFulfillmentService({ sql: h.sql, authorize: authorizeFn })
}

// ===========================================================================
describe('reviewDeletion', () => {
  test('moves a requested deletion to under_review', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')
    const ctx = directorCtx(f.director, f.chapter)

    let result!: Awaited<ReturnType<DeletionFulfillmentService['reviewDeletion']>>
    await withRequest(async () => {
      result = await deletionSvc().reviewDeletion(requestId, ctx)
    })

    expect(result.status).toBe('under_review')
    const [dr] = await h.sql`select status from deletion_request where id = ${requestId}`
    expect(dr!.status).toBe('under_review')
  })
})

// ===========================================================================
describe('fulfillDeletion — full erase (§ 312.6(c): terminate first, then erase)', () => {
  test('terminates participation, erases PII and the skeleton, sets fulfilled_full, audits by reference only', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')
    const ctx = directorCtx(f.director, f.chapter)

    // Pre-state: active student, real PII, an Explorer tier grant, a live session.
    const before = await accountRow(f.accountId)
    expect(before.status).toBe('active')
    expect(before.legal_name).toBe('Minor Testchild')
    const ttBefore = await tierCount(f.membershipId)
    expect(ttBefore).toBeGreaterThan(0)

    let result!: Awaited<ReturnType<DeletionFulfillmentService['fulfillDeletion']>>
    await withRequest(async () => {
      await deletionSvc().reviewDeletion(requestId, ctx)
      result = await deletionSvc().fulfillDeletion(requestId, ctx, { decision: 'full' })
    })

    // The decision-4 DOB trigger did NOT block the erase (fulfill returned).
    expect(result.status).toBe('fulfilled_full')
    expect(result.participationTerminated).toBe(true)
    expect(result.skeletonRemoved).toBe(true)

    // Participation terminated: membership offboarded, account closed, session revoked.
    expect((await membershipRow(f.membershipId)).status).toBe('offboarded')
    const acct = await accountRow(f.accountId)
    expect(acct.status).toBe('closed')
    const [sess] = await h.sql`select revoked_at from session where id = ${f.sessionId}`
    expect(sess!.revoked_at).not.toBeNull()

    // PII erased: name, DOB tombstoned; the username identifier tombstoned.
    expect(acct.legal_name).toBe('[redacted]')
    expect(acct.display_name).toBe('[redacted]')
    expect(new Date(acct.date_of_birth as string).getUTCFullYear()).toBe(1900)
    expect(acct.username as string).toMatch(/^redacted-/)

    // Guardian details and DOB on the enrollment record tombstoned too.
    const [enr] = await h.sql`
      select guardian_name_on_form, date_of_birth from enrollment_record where id = ${f.enrollmentRecordId}
    `
    expect(enr!.guardian_name_on_form).toBe('[redacted]')
    expect(new Date(enr!.date_of_birth as string).getUTCFullYear()).toBe(1900)

    // The verification skeleton removed: tier history gone, current_tier cleared.
    const ttAfter = await tierCount(f.membershipId)
    expect(ttAfter).toBe(0)
    expect((await membershipRow(f.membershipId)).current_tier).toBeNull()

    // deletion_request decision recorded.
    const [dr] = await h.sql`select status, reviewed_by, decided_at from deletion_request where id = ${requestId}`
    expect(dr!.status).toBe('fulfilled_full')
    expect(dr!.reviewed_by).toBe(f.director)
    expect(dr!.decided_at).not.toBeNull()

    // Audit written by REFERENCE only — never the erased PII in `detail`.
    const audits = await h.sql`
      select detail from audit_entry where action = 'deletion.fulfilled' and subject_id = ${f.accountId}
    `
    expect(audits).toHaveLength(1)
    const detailJson = JSON.stringify(audits[0]!.detail)
    expect(detailJson).not.toContain('Minor Testchild')
    expect(detailJson).not.toContain('2014-04-04')
    expect(detailJson).toContain(requestId)
  })
})

// ===========================================================================
describe('fulfillDeletion — redaction (preserve the anonymized skeleton)', () => {
  test('strips PII but keeps tier reached / tier history; sets fulfilled_redaction', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'redaction')
    const ctx = directorCtx(f.director, f.chapter)

    let result!: Awaited<ReturnType<DeletionFulfillmentService['fulfillDeletion']>>
    await withRequest(async () => {
      await deletionSvc().reviewDeletion(requestId, ctx)
      result = await deletionSvc().fulfillDeletion(requestId, ctx, { decision: 'redaction' })
    })

    expect(result.status).toBe('fulfilled_redaction')
    expect(result.skeletonRemoved).toBe(false)

    // PII stripped.
    const acct = await accountRow(f.accountId)
    expect(acct.legal_name).toBe('[redacted]')
    expect(new Date(acct.date_of_birth as string).getUTCFullYear()).toBe(1900)

    // The anonymized verification skeleton PRESERVED: tier reached + tier history.
    const m = await membershipRow(f.membershipId)
    expect(m.status).toBe('offboarded')
    expect(m.current_tier).toBe('explorer')
    const ttAfter = await tierCount(f.membershipId)
    expect(ttAfter).toBeGreaterThan(0)
  })
})

// ===========================================================================
describe('fulfillDeletion — refusal (§ 312.6: a refusal carries a documented reason)', () => {
  test('a refusal without a reason is rejected by the DB CHECK; nothing changes', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')
    const ctx = directorCtx(f.director, f.chapter)

    let caught: unknown
    await withRequest(async () => {
      await deletionSvc().reviewDeletion(requestId, ctx)
      try {
        await deletionSvc().fulfillDeletion(requestId, ctx, { decision: 'refused' })
      } catch (e) {
        caught = e
      }
    })
    expect((caught as Error).message).toMatch(/deletion_request_refusal_reason|check|reason/i)

    // No data change: still active, PII intact, request still under_review.
    const acct = await accountRow(f.accountId)
    expect(acct.status).toBe('active')
    expect(acct.legal_name).toBe('Minor Testchild')
    const [dr] = await h.sql`select status from deletion_request where id = ${requestId}`
    expect(dr!.status).toBe('under_review')
  })

  test('a refusal with a documented reason sets refused and changes no child data', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')
    const ctx = directorCtx(f.director, f.chapter)

    await withRequest(async () => {
      await deletionSvc().reviewDeletion(requestId, ctx)
      await deletionSvc().fulfillDeletion(requestId, ctx, {
        decision: 'refused',
        decisionReason: 'retained for an open safeguarding review',
      })
    })

    const [dr] = await h.sql`select status, decision_reason from deletion_request where id = ${requestId}`
    expect(dr!.status).toBe('refused')
    expect(dr!.decision_reason).toMatch(/safeguarding/)

    // Refusal is not a deletion: the child's data and participation are untouched.
    const acct = await accountRow(f.accountId)
    expect(acct.status).toBe('active')
    expect(acct.legal_name).toBe('Minor Testchild')
    expect((await membershipRow(f.membershipId)).status).toBe('active')

    const audits = await h.sql`
      select count(*)::int as n from audit_entry where action = 'deletion.refused' and subject_id = ${f.accountId}
    `
    expect(audits[0]!.n).toBe(1)
  })
})

// ===========================================================================
describe('fulfillDeletion — partial requires a documented reason', () => {
  test('partial without a reason is rejected before any mutation', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'redaction')
    const ctx = directorCtx(f.director, f.chapter)

    let caught: unknown
    await withRequest(async () => {
      await deletionSvc().reviewDeletion(requestId, ctx)
      try {
        // @ts-expect-error — partial requires a decisionReason at the type level
        await deletionSvc().fulfillDeletion(requestId, ctx, { decision: 'partial' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(DeletionReasonRequiredError)
    expect((await accountRow(f.accountId)).status).toBe('active')
  })
})

// ===========================================================================
describe('fulfillDeletion — the fulfillment edge legality', () => {
  test('fulfilling a request that was never reviewed (still requested) is rejected', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')
    const ctx = directorCtx(f.director, f.chapter)

    let caught: unknown
    await withRequest(async () => {
      try {
        await deletionSvc().fulfillDeletion(requestId, ctx, { decision: 'full' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(IllegalDeletionTransitionError)
    expect((await accountRow(f.accountId)).status).toBe('active')
  })
})

// ===========================================================================
describe('fulfillDeletion — the retention bypass is the ONLY way a DOB is erased', () => {
  test('after a service erase, an ordinary UPDATE of the DOB is still blocked', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')
    const ctx = directorCtx(f.director, f.chapter)

    await withRequest(async () => {
      await deletionSvc().reviewDeletion(requestId, ctx)
      await deletionSvc().fulfillDeletion(requestId, ctx, { decision: 'full' })
    })

    // The service tombstoned the DOB via the transaction-local retention flag;
    // an ordinary write path remains blocked by the write-once trigger.
    await expect(
      h.sql`update account set date_of_birth = '2000-01-01' where id = ${f.accountId}`,
    ).rejects.toThrow(/write.?once|date_of_birth|dob/i)
  })
})

// ===========================================================================
describe('fulfillDeletion — atomicity', () => {
  test('a failure mid-fulfillment rolls back everything (no partial erase, participation intact)', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')

    // Review with the real director, then fulfill under a GHOST director whose
    // account does not exist: the terminal audit insert (actor FK) fails AFTER
    // the erase, so the whole transaction must roll back.
    await withRequest(async () => {
      await deletionSvc().reviewDeletion(requestId, directorCtx(f.director, f.chapter))
    })
    const ghost = randomUUID()
    const ghostCtx = baseCtx(ghost, new Date(), [mem('chapter_director', f.chapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await deletionSvc().fulfillDeletion(requestId, ghostCtx, { decision: 'full' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Error)

    // Nothing changed: still active, PII intact, tier history intact, request under_review.
    const acct = await accountRow(f.accountId)
    expect(acct.status).toBe('active')
    expect(acct.legal_name).toBe('Minor Testchild')
    expect((await membershipRow(f.membershipId)).status).toBe('active')
    const ttAfter = await tierCount(f.membershipId)
    expect(ttAfter).toBeGreaterThan(0)
    const [dr] = await h.sql`select status from deletion_request where id = ${requestId}`
    expect(dr!.status).toBe('under_review')
  })
})

// ===========================================================================
describe('fulfillDeletion — authorization', () => {
  test('a non-director is denied: opaque Forbidden, one permission.denied row, nothing flips', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')
    await withRequest(async () => {
      await deletionSvc().reviewDeletion(requestId, directorCtx(f.director, f.chapter))
    })

    // A director in a DIFFERENT chapter -> out_of_scope for this subject's chapter.
    const otherChapter = await makeChapter(h.sql)
    const stranger = baseCtx(f.director, new Date(), [mem('chapter_director', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await deletionSvc().fulfillDeletion(requestId, stranger, { decision: 'full' })
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    expect(JSON.stringify(caught)).not.toMatch(/out_of_scope/)

    const denied = await h.sql`
      select detail from audit_entry
      where action = 'permission.denied' and actor_account_id = ${f.director}
        and detail->>'capability' = 'deletion.fulfill'
    `
    expect(denied).toHaveLength(1)
    expect((await accountRow(f.accountId)).status).toBe('active')
  })

  test('reviewDeletion denies a non-director too', async () => {
    const f = await seededActiveStudent()
    const requestId = await fileDeletionRequest(f.accountId, f.director, 'full')
    const otherChapter = await makeChapter(h.sql)
    const stranger = baseCtx(f.director, new Date(), [mem('chapter_director', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await deletionSvc().reviewDeletion(requestId, stranger)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const [dr] = await h.sql`select status from deletion_request where id = ${requestId}`
    expect(dr!.status).toBe('requested')
  })
})

// ===========================================================================
describe('ExportFulfillmentService.fulfillExport', () => {
  test('returns the structured bundle and marks the export_request fulfilled', async () => {
    const f = await seededActiveStudent()
    const [er] = await h.sql`
      insert into export_request (subject_account_id, requested_by, status)
      values (${f.accountId}, ${f.director}, 'requested') returning id
    `
    const requestId = er!.id as string
    const ctx = directorCtx(f.director, f.chapter)

    let result!: Awaited<ReturnType<ExportFulfillmentService['fulfillExport']>>
    await withRequest(async () => {
      result = await exportSvc().fulfillExport(requestId, ctx)
    })

    expect(result.status).toBe('fulfilled')
    expect(result.bundle.subjectAccountId).toBe(f.accountId)
    // The bundle carries the review-right record: membership, tier history, consents.
    expect(result.bundle.memberships.length).toBeGreaterThan(0)
    expect(result.bundle.tierHistory.length).toBeGreaterThan(0)
    expect(result.bundle.consents.enrollment).toBe(true)

    const [row] = await h.sql`select status, fulfilled_at from export_request where id = ${requestId}`
    expect(row!.status).toBe('fulfilled')
    expect(row!.fulfilled_at).not.toBeNull()
  })

  test('a non-director is denied export.fulfill: Forbidden, request stays requested', async () => {
    const f = await seededActiveStudent()
    const [er] = await h.sql`
      insert into export_request (subject_account_id, requested_by, status)
      values (${f.accountId}, ${f.director}, 'requested') returning id
    `
    const requestId = er!.id as string
    const otherChapter = await makeChapter(h.sql)
    const stranger = baseCtx(f.director, new Date(), [mem('chapter_director', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await exportSvc().fulfillExport(requestId, stranger)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const [row] = await h.sql`select status from export_request where id = ${requestId}`
    expect(row!.status).toBe('requested')
  })
})
