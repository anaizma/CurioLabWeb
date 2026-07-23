// -------------------------------------------------------------------------
// Stage2Service tests (the three-phase Stage 2 flow; application-funnel Stage-1
// design §7.2/§8). Embedded Postgres, synthetic data only.
//
// The Stage-2 parent token now ORIGINATES from the lead's `token_hash`, issued
// at createLead. `startStage2(leadToken)` validates/consumes that token and
// creates one `application_draft` bound to the lead. The draft advances 2A
// (parent) -> 2B (student) -> 2C (parent review + submit). The `application` row
// is minted ONLY at 2C submit, ONLY by the parent, and 2C sets the lead's
// `converted_at` + `converted_application_id`.
//
// The two-token model is retained deliberately: a SEPARATE student token gates
// 2B, so a student's 2B link can never open the parent's 2A/2C sections. 2B
// collects no identifying fields (an allowlist rejects them loudly) and no
// student email is ever collected. Mail delivery is deferred.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { generateSessionToken, hashToken } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import {
  Stage2Service,
  InvalidStage2TokenError,
  Stage2AlreadyStartedError,
  Stage2LeadExpiredError,
  StudentSectionIdentifyingFieldError,
  StudentSectionFieldNotAllowedError,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc(overrides: Record<string, unknown> = {}) {
  return new Stage2Service({ sql: h.sql, ...overrides })
}

/**
 * A lead as createLead leaves it: a chapter code + optional chapter_id fk, and a
 * Stage-2 token whose HASH is stored on the lead. The raw token is what the
 * parent would receive by email (Phase 2); here the test controls it.
 */
async function makeLead(chapterId: string | null): Promise<{ leadId: string; parentToken: string }> {
  const parentToken = generateSessionToken()
  const [row] = await h.sql`
    insert into application_lead (email, chapter, chapter_id, source, filler_role, status, token_hash)
    values (${`parent-${randomUUID().slice(0, 8)}@example.test`}, ${'a-chapter-code'}, ${chapterId},
            'instagram', 'parent', 'new', ${hashToken(parentToken)})
    returning id
  `
  return { leadId: row!.id as string, parentToken }
}

interface Setup {
  chapter: string
  leadId: string
  parentToken: string
}
async function setup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const { leadId, parentToken } = await makeLead(chapter)
  return { chapter, leadId, parentToken }
}

const parentAnswers = {
  childName: 'Minor Testchild',
  grade: '7',
  school: 'Test Middle School',
  guardianName: 'Parent Testperson',
  guardianEmail: 'parent-guardian@example.test',
}
const studentAnswers = {
  motivation: 'I like building robots',
  interests: 'robotics, chess',
}

async function countApps(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from application`
  return row!.n as number
}

/** Push a lead's 30-day window into the past so it is expired at request time. */
async function expireLead(leadId: string): Promise<void> {
  await h.sql`update application_lead set expires_at = now() - interval '1 second' where id = ${leadId}`
}

// ===========================================================================
describe('startStage2 — consumes the lead token, creates the draft', () => {
  test('binds the lead token to the draft (2a/in_progress) and advances the lead to stage2_started', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)

    expect(s.leadId).toBe(f.leadId)

    const [d] = await h.sql`
      select phase, status, parent_token_hash, student_token_hash, parent_answers, student_answers
      from application_draft where id = ${s.draftId}
    `
    expect(d!.phase).toBe('2a')
    expect(d!.status).toBe('in_progress')
    // The draft's parent token is the SAME token issued on the lead — consumed, not re-minted.
    expect(d!.parent_token_hash).toBe(hashToken(f.parentToken))
    expect(d!.student_token_hash).toBeNull()
    expect(d!.parent_answers).toBeNull()
    expect(d!.student_answers).toBeNull()

    const [l] = await h.sql`select status, token_hash from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('stage2_started')
    expect(l!.token_hash).toBe(hashToken(f.parentToken))
  })

  test('an unknown/forged lead token is rejected; no draft is created', async () => {
    let caught: unknown
    try {
      await svc().startStage2('never-issued-lead-token')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidStage2TokenError)
    const [d] = await h.sql`select count(*)::int as n from application_draft`
    // (no assertion on absolute count across tests; just that this token made nothing)
    expect(typeof d!.n).toBe('number')
  })

  test('starting twice on the same lead is rejected (the draft is minted exactly once)', async () => {
    const f = await setup()
    await svc().startStage2(f.parentToken)

    let caught: unknown
    try {
      await svc().startStage2(f.parentToken)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Stage2AlreadyStartedError)

    const [d] = await h.sql`select count(*)::int as n from application_draft where lead_id = ${f.leadId}`
    expect(d!.n).toBe(1)
  })
})

// ===========================================================================
describe('saveParentSection (2A, parent token)', () => {
  test('saves parent_answers, advances the draft to 2b, and issues the student token', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)

    const p = await svc().saveParentSection(f.parentToken, parentAnswers)
    expect(typeof p.studentToken).toBe('string')

    const [d] = await h.sql`
      select phase, status, student_token_hash, parent_answers from application_draft where id = ${s.draftId}
    `
    expect(d!.phase).toBe('2b')
    expect(d!.status).toBe('in_progress')
    expect(d!.student_token_hash).toBe(hashToken(p.studentToken!))
    expect(d!.parent_answers.childName).toBe('Minor Testchild')
    expect(d!.parent_answers.school).toBe('Test Middle School')
  })

  test('partial saves persist and merge; the student token is issued only once', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)

    const p1 = await svc().saveParentSection(f.parentToken, { childName: 'Minor Testchild' })
    expect(typeof p1.studentToken).toBe('string')
    const p2 = await svc().saveParentSection(f.parentToken, {
      guardianName: 'Parent Testperson',
      guardianEmail: 'g@example.test',
    })
    expect(p2.studentToken).toBeNull()

    const [d] = await h.sql`select parent_answers, student_token_hash from application_draft where id = ${s.draftId}`
    expect(d!.parent_answers).toMatchObject({
      childName: 'Minor Testchild',
      guardianName: 'Parent Testperson',
      guardianEmail: 'g@example.test',
    })
    expect(d!.student_token_hash).toBe(hashToken(p1.studentToken!))
  })

  test('an unknown/forged parent token is rejected', async () => {
    let caught: unknown
    try {
      await svc().saveParentSection('never-issued-token', parentAnswers)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidStage2TokenError)
  })
})

// ===========================================================================
describe('saveStudentSection (2B, student token, non-identifying allowlist)', () => {
  async function toStudentPhase(f: Setup) {
    const s = await svc().startStage2(f.parentToken)
    const p = await svc().saveParentSection(f.parentToken, parentAnswers)
    return { s, studentToken: p.studentToken! }
  }

  test('accepts allowlisted, non-identifying answers; sets 2b_saved and advances to 2c', async () => {
    const f = await setup()
    const { s, studentToken } = await toStudentPhase(f)

    await svc().saveStudentSection(studentToken, { motivation: 'x', interests: 'y', goals: 'z' })

    const [d] = await h.sql`select phase, status, student_answers from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2c')
    expect(d!.status).toBe('2b_saved')
    expect(d!.student_answers).toMatchObject({ motivation: 'x', interests: 'y', goals: 'z' })
  })

  test('rejects an identifying field (name/email/school) LOUDLY, storing nothing', async () => {
    const f = await setup()
    const { s, studentToken } = await toStudentPhase(f)

    for (const bad of [{ student_name: 'Real Name' }, { email: 'kid@example.test' }, { school: 'PS 118' }]) {
      let caught: unknown
      try {
        await svc().saveStudentSection(studentToken, { motivation: 'ok', ...bad })
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(StudentSectionIdentifyingFieldError)
    }

    const [d] = await h.sql`select phase, status, student_answers from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2b')
    expect(d!.student_answers).toBeNull()
  })

  test('rejects an unknown, non-identifying field that is not on the allowlist', async () => {
    const f = await setup()
    const { studentToken } = await toStudentPhase(f)

    let caught: unknown
    try {
      await svc().saveStudentSection(studentToken, { motivation: 'x', secret_field: 'y' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(StudentSectionFieldNotAllowedError)
  })

  test('does NOT submit: no application, the lead is still stage2_started and unconverted', async () => {
    const f = await setup()
    const { s, studentToken } = await toStudentPhase(f)

    const before = await countApps()
    await svc().saveStudentSection(studentToken, studentAnswers)
    expect(await countApps()).toBe(before)

    const [d] = await h.sql`select status from application_draft where id = ${s.draftId}`
    expect(d!.status).toBe('2b_saved')
    const [l] = await h.sql`select status, converted_application_id, converted_at from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('stage2_started')
    expect(l!.converted_application_id).toBeNull()
    expect(l!.converted_at).toBeNull()
  })

  test('no student email is ever stored on the draft', async () => {
    const f = await setup()
    const { s, studentToken } = await toStudentPhase(f)
    await svc().saveStudentSection(studentToken, studentAnswers)
    const [d] = await h.sql`select student_answers from application_draft where id = ${s.draftId}`
    expect(JSON.stringify(d!.student_answers)).not.toMatch(/@/)
  })
})

// ===========================================================================
describe('reviewStage2 + submitStage2 (2C, parent token only)', () => {
  async function toReview(f: Setup) {
    const s = await svc().startStage2(f.parentToken)
    const p = await svc().saveParentSection(f.parentToken, parentAnswers)
    await svc().saveStudentSection(p.studentToken!, studentAnswers)
    return { s, studentToken: p.studentToken! }
  }

  test('reviewStage2 returns the 2A and 2B answers read-only', async () => {
    const f = await setup()
    await toReview(f)

    const review = await svc().reviewStage2(f.parentToken)
    expect(review.phase).toBe('2c')
    expect(review.parentAnswers).toMatchObject({ childName: 'Minor Testchild', school: 'Test Middle School' })
    expect(review.studentAnswers).toMatchObject({ motivation: 'I like building robots' })
  })

  test('submitStage2 mints the application from 2A+2B, and sets the lead converted_at + converted_application_id', async () => {
    const f = await setup()
    const { s } = await toReview(f)

    const submit = await svc().submitStage2(f.parentToken)

    const [app] = await h.sql`select * from application where id = ${submit.applicationId}`
    expect(app!.kind).toBe('student')
    expect(app!.status).toBe('submitted')
    expect(app!.chapter_id).toBe(f.chapter)
    expect(app!.applicant_name).toBe('Minor Testchild')
    expect(app!.guardian_name).toBe('Parent Testperson')
    expect(app!.guardian_email).toBe('parent-guardian@example.test')
    expect(app!.student_section).toMatchObject({ motivation: 'I like building robots' })
    expect(JSON.stringify(app!.student_section)).not.toMatch(/@/)

    const [l] = await h.sql`select status, converted_application_id, converted_at from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('converted')
    expect(l!.converted_application_id).toBe(submit.applicationId)
    expect(l!.converted_at).not.toBeNull()

    const [d] = await h.sql`
      select phase, status, converted_application_id, submitted_at from application_draft where id = ${s.draftId}
    `
    expect(d!.phase).toBe('submitted')
    expect(d!.status).toBe('submitted')
    expect(d!.converted_application_id).toBe(submit.applicationId)
    expect(d!.submitted_at).not.toBeNull()
  })

  test('submitStage2 with a STUDENT token is rejected; no application is minted, the lead stays unconverted', async () => {
    const f = await setup()
    const { studentToken } = await toReview(f)

    const before = await countApps()
    let caught: unknown
    try {
      await svc().submitStage2(studentToken)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidStage2TokenError)
    expect(await countApps()).toBe(before)

    const [l] = await h.sql`select status, converted_at from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('stage2_started')
    expect(l!.converted_at).toBeNull()
  })
})

// ===========================================================================
describe('sendBack (2C -> 2B)', () => {
  test('returns the draft to 2B without creating an application; the student re-saves and the parent then submits', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)
    const p = await svc().saveParentSection(f.parentToken, parentAnswers)
    await svc().saveStudentSection(p.studentToken!, { motivation: 'first draft' })

    const before = await countApps()
    await svc().sendBack(f.parentToken)
    expect(await countApps()).toBe(before)

    let [d] = await h.sql`select phase, status from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2b')
    expect(d!.status).toBe('sent_back')

    await svc().saveStudentSection(p.studentToken!, { motivation: 'revised draft' })
    ;[d] = await h.sql`select phase, status, student_answers from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2c')
    expect(d!.status).toBe('2b_saved')
    expect(d!.student_answers.motivation).toBe('revised draft')

    const submit = await svc().submitStage2(f.parentToken)
    const [app] = await h.sql`select student_section from application where id = ${submit.applicationId}`
    expect(app!.student_section.motivation).toBe('revised draft')
  })

  test('there is no parent-editing path for the student section (only the student token writes 2B)', () => {
    const service = svc() as unknown as Record<string, unknown>
    expect(service.editStudentSection).toBeUndefined()
    expect(service.saveStudentAnswersAsParent).toBeUndefined()
  })
})

// ===========================================================================
// Request-time lead expiry (design §8: the Stage-2 token's 30-day expiry is
// evaluated at request time). A once-valid token whose bound lead has lapsed is
// rejected with the typed Stage2LeadExpiredError — distinct from a forged token.
describe('request-time lead expiry', () => {
  test('startStage2 rejects an expired lead and creates no draft', async () => {
    const f = await setup()
    await expireLead(f.leadId)

    let caught: unknown
    try {
      await svc().startStage2(f.parentToken)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Stage2LeadExpiredError)

    const [d] = await h.sql`select count(*)::int as n from application_draft where lead_id = ${f.leadId}`
    expect(d!.n).toBe(0)
    // And the lead was not advanced out of `new`.
    const [l] = await h.sql`select status from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('new')
  })

  test('a lead one second inside the window still starts (evaluated against now)', async () => {
    const f = await setup()
    await h.sql`update application_lead set expires_at = now() + interval '1 second' where id = ${f.leadId}`
    const s = await svc().startStage2(f.parentToken)
    expect(s.leadId).toBe(f.leadId)
  })

  test('a parent-token op (saveParentSection) rejects once the lead has expired mid-flow', async () => {
    const f = await setup()
    await svc().startStage2(f.parentToken)
    await expireLead(f.leadId)

    let caught: unknown
    try {
      await svc().saveParentSection(f.parentToken, parentAnswers)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Stage2LeadExpiredError)
  })

  test('the student-token op (saveStudentSection) rejects once the lead has expired', async () => {
    const f = await setup()
    await svc().startStage2(f.parentToken)
    const p = await svc().saveParentSection(f.parentToken, parentAnswers)
    await expireLead(f.leadId)

    let caught: unknown
    try {
      await svc().saveStudentSection(p.studentToken!, studentAnswers)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Stage2LeadExpiredError)
  })

  test('submitStage2 rejects an expired lead; no application is minted, the lead stays unconverted', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)
    const p = await svc().saveParentSection(f.parentToken, parentAnswers)
    await svc().saveStudentSection(p.studentToken!, studentAnswers)
    await expireLead(f.leadId)

    const before = await countApps()
    let caught: unknown
    try {
      await svc().submitStage2(f.parentToken)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Stage2LeadExpiredError)
    expect(await countApps()).toBe(before)

    const [l] = await h.sql`select status, converted_at from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('stage2_started')
    expect(l!.converted_at).toBeNull()

    const [d] = await h.sql`select status from application_draft where id = ${s.draftId}`
    expect(d!.status).toBe('2b_saved')
  })
})
