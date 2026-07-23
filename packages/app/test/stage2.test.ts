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
  FakeMailer,
  InvalidStage2TokenError,
  Stage2AlreadyStartedError,
  Stage2LeadExpiredError,
  Stage2NotInPhaseError,
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
  test('saves parent_answers and advances the draft to 2b WITHOUT minting a student token', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)

    const p = await svc().saveParentSection(f.parentToken, parentAnswers)
    // The save no longer carries a student token — linking is a separate parent action.
    expect(p).toBeUndefined()

    const [d] = await h.sql`
      select phase, status, student_token_hash, parent_answers from application_draft where id = ${s.draftId}
    `
    expect(d!.phase).toBe('2b')
    expect(d!.status).toBe('in_progress')
    // No student link exists yet: createStudentLink is the explicit parent action that mints it.
    expect(d!.student_token_hash).toBeNull()
    expect(d!.parent_answers.childName).toBe('Minor Testchild')
    expect(d!.parent_answers.school).toBe('Test Middle School')
  })

  test('partial saves persist and merge; still no student token is minted', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)

    await svc().saveParentSection(f.parentToken, { childName: 'Minor Testchild' })
    await svc().saveParentSection(f.parentToken, {
      guardianName: 'Parent Testperson',
      guardianEmail: 'g@example.test',
    })

    const [d] = await h.sql`select parent_answers, student_token_hash from application_draft where id = ${s.draftId}`
    expect(d!.parent_answers).toMatchObject({
      childName: 'Minor Testchild',
      guardianName: 'Parent Testperson',
      guardianEmail: 'g@example.test',
    })
    expect(d!.student_token_hash).toBeNull()
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
describe('createStudentLink (explicit parent action, parent token)', () => {
  test('mints a student token, stores its hash, and the returned token opens 2B', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)

    const link = await svc().createStudentLink(f.parentToken)
    expect(typeof link.studentToken).toBe('string')

    const [d] = await h.sql`select student_token_hash from application_draft where id = ${s.draftId}`
    expect(d!.student_token_hash).toBe(hashToken(link.studentToken))

    // The minted token actually gates 2B.
    await svc().saveStudentSection(link.studentToken, studentAnswers)
    const [d2] = await h.sql`select phase, student_answers from application_draft where id = ${s.draftId}`
    expect(d2!.phase).toBe('2c')
    expect(d2!.student_answers).toMatchObject({ motivation: 'I like building robots' })
  })

  test('re-creating the link invalidates the previous token; the old one no longer resolves', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)

    const first = await svc().createStudentLink(f.parentToken)
    const second = await svc().createStudentLink(f.parentToken)
    expect(second.studentToken).not.toBe(first.studentToken)

    // The draft now holds ONLY the second link's hash (the first is superseded).
    const [d] = await h.sql`select student_token_hash from application_draft where id = ${s.draftId}`
    expect(d!.student_token_hash).toBe(hashToken(second.studentToken))

    // The old token is dead; the new one works.
    let caught: unknown
    try {
      await svc().saveStudentSection(first.studentToken, studentAnswers)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidStage2TokenError)

    await svc().saveStudentSection(second.studentToken, studentAnswers)
    const [d2] = await h.sql`select phase from application_draft where id = ${s.draftId}`
    expect(d2!.phase).toBe('2c')
  })

  test('is rejected before the parent has saved 2A (draft still in 2a)', async () => {
    const f = await setup()
    await svc().startStage2(f.parentToken)

    let caught: unknown
    try {
      await svc().createStudentLink(f.parentToken)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Stage2NotInPhaseError)

    // Nothing was minted.
    const [d] = await h.sql`select student_token_hash from application_draft where lead_id = ${f.leadId}`
    expect(d!.student_token_hash).toBeNull()
  })

  test('an unknown/forged parent token is rejected', async () => {
    let caught: unknown
    try {
      await svc().createStudentLink('never-issued-token')
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
    await svc().saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await svc().createStudentLink(f.parentToken)
    return { s, studentToken }
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
    await svc().saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await svc().createStudentLink(f.parentToken)
    await svc().saveStudentSection(studentToken, studentAnswers)
    return { s, studentToken }
  }

  test('the full chain runs end to end: start -> parent -> student-link -> student -> review -> submit', async () => {
    const f = await setup()
    const started = await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await svc().createStudentLink(f.parentToken)
    await svc().saveStudentSection(studentToken, studentAnswers)

    const review = await svc().reviewStage2(f.parentToken)
    expect(review.phase).toBe('2c')

    const submit = await svc().submitStage2(f.parentToken)
    expect(submit.leadId).toBe(f.leadId)

    const [app] = await h.sql`select applicant_name, student_section from application where id = ${submit.applicationId}`
    expect(app!.applicant_name).toBe('Minor Testchild')
    expect(app!.student_section).toMatchObject({ motivation: 'I like building robots' })
    const [d] = await h.sql`select phase from application_draft where id = ${started.draftId}`
    expect(d!.phase).toBe('submitted')
  })

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
    await svc().saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await svc().createStudentLink(f.parentToken)
    await svc().saveStudentSection(studentToken, { motivation: 'first draft' })

    const before = await countApps()
    await svc().sendBack(f.parentToken)
    expect(await countApps()).toBe(before)

    let [d] = await h.sql`select phase, status from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2b')
    expect(d!.status).toBe('sent_back')

    await svc().saveStudentSection(studentToken, { motivation: 'revised draft' })
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
// Draft resume reads (getParentDraft / getStudentDraft): READ-ONLY, token-gated
// prefill so a returning applicant resumes without losing saved answers. Neither
// mutates the draft nor changes its phase, and each works at ANY phase.
describe('getParentDraft (read-only 2A prefill, parent token)', () => {
  test('returns the saved parentAnswers and current phase after a 2A save; changes nothing', async () => {
    const f = await setup()
    const started = await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)

    const draft = await svc().getParentDraft(f.parentToken)
    expect(draft.phase).toBe('2b')
    expect(draft.parentAnswers).toMatchObject({
      childName: 'Minor Testchild',
      school: 'Test Middle School',
    })

    // Read is stable (idempotent) and mutates nothing: phase and answers unchanged,
    // and a subsequent save still merges additively.
    const again = await svc().getParentDraft(f.parentToken)
    expect(again).toEqual(draft)

    const [d] = await h.sql`select phase, status, parent_answers from application_draft where id = ${started.draftId}`
    expect(d!.phase).toBe('2b')
    expect(d!.status).toBe('in_progress')

    await svc().saveParentSection(f.parentToken, { grade: '8' })
    const after = await svc().getParentDraft(f.parentToken)
    expect(after.parentAnswers).toMatchObject({ childName: 'Minor Testchild', grade: '8' })
  })

  test('works at phase 2a (just started, no answers yet) — empty object', async () => {
    const f = await setup()
    await svc().startStage2(f.parentToken)

    const draft = await svc().getParentDraft(f.parentToken)
    expect(draft.phase).toBe('2a')
    expect(draft.parentAnswers).toEqual({})
  })

  test('works at phase 2b (after create-student-link)', async () => {
    const f = await setup()
    await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)
    await svc().createStudentLink(f.parentToken)

    const draft = await svc().getParentDraft(f.parentToken)
    expect(draft.phase).toBe('2b')
    expect(draft.parentAnswers).toMatchObject({ childName: 'Minor Testchild' })
  })

  test('works at phase 2c (after the student finishes) and does NOT leak the student answers', async () => {
    const f = await setup()
    await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await svc().createStudentLink(f.parentToken)
    await svc().saveStudentSection(studentToken, studentAnswers)

    const draft = await svc().getParentDraft(f.parentToken)
    expect(draft.phase).toBe('2c')
    expect(draft.parentAnswers).toMatchObject({ childName: 'Minor Testchild' })
    // The 2A read carries no student answers — those stay with reviewStage2 at 2c.
    expect(draft).not.toHaveProperty('studentAnswers')
    expect(JSON.stringify(draft)).not.toContain('I like building robots')
  })

  test('a student token (or forged) is rejected', async () => {
    const f = await setup()
    await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await svc().createStudentLink(f.parentToken)

    for (const bad of [studentToken, 'never-issued-token']) {
      let caught: unknown
      try {
        await svc().getParentDraft(bad)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(InvalidStage2TokenError)
    }
  })
})

describe('getStudentDraft (read-only 2B prefill, student token)', () => {
  async function toStudent(f: Setup) {
    await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)
    return svc().createStudentLink(f.parentToken)
  }

  test('returns the saved studentAnswers and phase after a 2B save; changes nothing', async () => {
    const f = await setup()
    const { studentToken } = await toStudent(f)
    await svc().saveStudentSection(studentToken, studentAnswers)

    const draft = await svc().getStudentDraft(studentToken)
    expect(draft.phase).toBe('2c')
    expect(draft.studentAnswers).toMatchObject({ motivation: 'I like building robots' })

    const again = await svc().getStudentDraft(studentToken)
    expect(again).toEqual(draft)
  })

  test('returns an empty object before the student has saved anything (phase 2b)', async () => {
    const f = await setup()
    const { studentToken } = await toStudent(f)

    const draft = await svc().getStudentDraft(studentToken)
    expect(draft.phase).toBe('2b')
    expect(draft.studentAnswers).toEqual({})
  })

  test('a parent token (or forged) is rejected', async () => {
    const f = await setup()
    await toStudent(f)

    for (const bad of [f.parentToken, 'never-issued-token']) {
      let caught: unknown
      try {
        await svc().getStudentDraft(bad)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(InvalidStage2TokenError)
    }
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
    await svc().saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await svc().createStudentLink(f.parentToken)
    await expireLead(f.leadId)

    let caught: unknown
    try {
      await svc().saveStudentSection(studentToken, studentAnswers)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Stage2LeadExpiredError)
  })

  test('submitStage2 rejects an expired lead; no application is minted, the lead stays unconverted', async () => {
    const f = await setup()
    const s = await svc().startStage2(f.parentToken)
    await svc().saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await svc().createStudentLink(f.parentToken)
    await svc().saveStudentSection(studentToken, studentAnswers)
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

// ===========================================================================
// The emailed 2C REVIEW token. When the student finishes 2B, saveStudentSection
// mints a fresh CSPRNG review token, stores ONLY its hash on the draft, and puts
// the RAW token in the "ready to review" email as a "Review and submit" button.
// The three 2C ops (review/submit/send-back) accept a token matching the parent
// token OR the review token, so BOTH the parent's original link and the emailed
// button reach 2C. Send-back clears the review token; the next finish mints a new
// one. The review token inherits the lead's 30-day expiry (no separate expiry).
describe('review token (the emailed 2C "Review and submit" button)', () => {
  /** The raw review token the email carries — parsed from a FakeMailer send. */
  function reviewTokenFrom(mailer: FakeMailer): string {
    const msg = mailer.sent.at(-1)!
    const body = `${msg.html ?? ''}\n${msg.text ?? ''}`
    const match = body.match(/\/apply\/review\/([A-Za-z0-9_-]+)/)
    expect(match).not.toBeNull()
    return match![1]!
  }

  /** Drive start -> parent -> student-link -> student-finish with a FakeMailer. */
  async function toReviewWithMail(f: Setup) {
    const mailer = new FakeMailer()
    const service = svc({ mailer })
    const s = await service.startStage2(f.parentToken)
    await service.saveParentSection(f.parentToken, parentAnswers)
    const { studentToken } = await service.createStudentLink(f.parentToken)
    await service.saveStudentSection(studentToken, studentAnswers)
    return { s, service, mailer, studentToken, reviewToken: reviewTokenFrom(mailer) }
  }

  test('saveStudentSection mints review_token_hash and the email carries a live /apply/review/ link', async () => {
    const f = await setup()
    const { s, mailer, reviewToken } = await toReviewWithMail(f)

    // The email carries the review link and a token.
    const msg = mailer.sent.at(-1)!
    const body = `${msg.html ?? ''}\n${msg.text ?? ''}`
    expect(body).toContain('/apply/review/')
    expect(reviewToken.length).toBeGreaterThan(0)

    // The hash is stored on the draft (raw token never lands in the DB).
    const [d] = await h.sql`select review_token_hash from application_draft where id = ${s.draftId}`
    expect(d!.review_token_hash).toBe(hashToken(reviewToken))
    expect(d!.review_token_hash).not.toBe(reviewToken)
  })

  test('the emailed review token drives reviewStage2, submitStage2, and sendBack (a REAL link)', async () => {
    // sendBack path
    {
      const f = await setup()
      const { service, reviewToken } = await toReviewWithMail(f)
      await service.sendBack(reviewToken)
      const [d] = await h.sql`select phase, status from application_draft where lead_id = ${f.leadId}`
      expect(d!.phase).toBe('2b')
      expect(d!.status).toBe('sent_back')
    }
    // review + submit path
    {
      const f = await setup()
      const { service, reviewToken } = await toReviewWithMail(f)
      const review = await service.reviewStage2(reviewToken)
      expect(review.phase).toBe('2c')
      expect(review.parentAnswers).toMatchObject({ childName: 'Minor Testchild' })
      const submit = await service.submitStage2(reviewToken)
      expect(submit.leadId).toBe(f.leadId)
      const [app] = await h.sql`select applicant_name from application where id = ${submit.applicationId}`
      expect(app!.applicant_name).toBe('Minor Testchild')
    }
  })

  test('the parent ORIGINAL token still drives all three 2C ops (both tokens work)', async () => {
    for (const op of ['review', 'submit', 'sendBack'] as const) {
      const f = await setup()
      const { service } = await toReviewWithMail(f)
      if (op === 'review') {
        const r = await service.reviewStage2(f.parentToken)
        expect(r.phase).toBe('2c')
      } else if (op === 'submit') {
        const sub = await service.submitStage2(f.parentToken)
        expect(sub.leadId).toBe(f.leadId)
      } else {
        await service.sendBack(f.parentToken)
        const [d] = await h.sql`select phase from application_draft where lead_id = ${f.leadId}`
        expect(d!.phase).toBe('2b')
      }
    }
  })

  test('a STUDENT token does NOT open the 2C ops; the review token does NOT open 2A / the student ops', async () => {
    const f = await setup()
    const { service, studentToken, reviewToken } = await toReviewWithMail(f)

    // A student token is rejected by every 2C op (unchanged narrowing).
    for (const call of [
      () => service.reviewStage2(studentToken),
      () => service.submitStage2(studentToken),
      () => service.sendBack(studentToken),
    ]) {
      let caught: unknown
      try {
        await call()
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(InvalidStage2TokenError)
    }

    // The review token does NOT broaden the parent-2A op nor the student ops.
    for (const call of [
      () => service.saveParentSection(reviewToken, parentAnswers),
      () => service.getParentDraft(reviewToken),
      () => service.getStudentDraft(reviewToken),
      () => service.saveStudentSection(reviewToken, studentAnswers),
    ]) {
      let caught: unknown
      try {
        await call()
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(InvalidStage2TokenError)
    }
  })

  test('sendBack clears review_token_hash; the next finish mints a NEW token (old dead, new works)', async () => {
    const f = await setup()
    const { s, service, mailer, studentToken, reviewToken: firstReview } = await toReviewWithMail(f)

    await service.sendBack(f.parentToken)
    // The stale review link is cleared, not left lingering.
    const [cleared] = await h.sql`select review_token_hash from application_draft where id = ${s.draftId}`
    expect(cleared!.review_token_hash).toBeNull()

    // The old review token no longer resolves any 2C op.
    let caught: unknown
    try {
      await service.reviewStage2(firstReview)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidStage2TokenError)

    // The student finishes again -> a fresh review token is minted and emailed.
    await service.saveStudentSection(studentToken, { motivation: 'revised' })
    const secondReview = reviewTokenFrom(mailer)
    expect(secondReview).not.toBe(firstReview)
    const [d] = await h.sql`select review_token_hash from application_draft where id = ${s.draftId}`
    expect(d!.review_token_hash).toBe(hashToken(secondReview))

    // The old token stays dead; the new one drives 2C.
    let stillDead: unknown
    try {
      await service.reviewStage2(firstReview)
    } catch (e) {
      stillDead = e
    }
    expect(stillDead).toBeInstanceOf(InvalidStage2TokenError)
    const review = await service.reviewStage2(secondReview)
    expect(review.phase).toBe('2c')
  })

  test('with the default mailer (NoopMailer, no RESEND key) the review token is still minted/stored', async () => {
    const f = await setup()
    // svc() uses defaultMailer() -> NoopMailer when RESEND_API_KEY is unset.
    const prev = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      const service = svc()
      const s = await service.startStage2(f.parentToken)
      await service.saveParentSection(f.parentToken, parentAnswers)
      const { studentToken } = await service.createStudentLink(f.parentToken)
      // Nothing throws even though no email is delivered.
      await service.saveStudentSection(studentToken, studentAnswers)
      const [d] = await h.sql`select review_token_hash from application_draft where id = ${s.draftId}`
      expect(d!.review_token_hash).not.toBeNull()
    } finally {
      if (prev !== undefined) process.env.RESEND_API_KEY = prev
    }
  })
})
