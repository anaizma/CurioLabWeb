// -------------------------------------------------------------------------
// Stage2Service tests (Milestone 1 v2, the three-phase Stage 2 flow;
// docs/platform/plans/milestone-1-application-funnel.md). Embedded Postgres,
// synthetic data only.
//
// One draft bound to a lead advances 2A (parent) -> 2B (student) -> 2C (parent
// review + submit). The `application` row is minted ONLY at 2C submit, ONLY by
// the parent. 2B collects no identifying fields (an allowlist rejects them
// loudly) and no student email is ever collected. Mail delivery is deferred:
// the returned parent/student tokens are the seam a future mailer consumes.
//
// startStage2 is the one staff-gated op (lead.invite, chapter_director). The
// four token-gated ops (saveParentSection, saveStudentSection, reviewStage2,
// submitStage2, sendBack) carry no AuthContext — like the invite accept
// endpoints, they are gated by the opaque token alone.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, hashToken, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  Stage2Service,
  InvalidStage2TokenError,
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
  return new Stage2Service({ sql: h.sql, authorize, ...overrides })
}

async function makeLead(chapter: string | null): Promise<string> {
  const [row] = await h.sql`
    insert into application_lead (email, chapter_id, referral_source, status)
    values (${`parent-${randomUUID().slice(0, 8)}@example.test`}, ${chapter}, 'instagram', 'new')
    returning id
  `
  return row!.id as string
}

interface Setup {
  chapter: string
  director: string
  leadId: string
}
async function directorSetup(): Promise<Setup> {
  const chapter = await makeChapter(h.sql)
  const director = await makeAdult(h.sql)
  const leadId = await makeLead(chapter)
  return { chapter, director, leadId }
}
function directorCtx(f: Setup) {
  return baseCtx(f.director, new Date(), [mem('chapter_director', f.chapter)])
}

async function start(f: Setup) {
  let out!: Awaited<ReturnType<Stage2Service['startStage2']>>
  await withRequest(async () => {
    out = await svc().startStage2(f.leadId, directorCtx(f))
  })
  return out
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

// ===========================================================================
describe('startStage2', () => {
  test('issues the parent token, creates the 2a/in_progress draft, advances the lead to stage2_started', async () => {
    const f = await directorSetup()
    const s = await start(f)

    expect(typeof s.parentToken).toBe('string')
    expect(s.parentToken.length).toBeGreaterThan(20)

    const [d] = await h.sql`
      select phase, status, parent_token_hash, student_token_hash, parent_answers, student_answers
      from application_draft where id = ${s.draftId}
    `
    expect(d!.phase).toBe('2a')
    expect(d!.status).toBe('in_progress')
    expect(d!.parent_token_hash).toBe(hashToken(s.parentToken))
    expect(d!.student_token_hash).toBeNull()
    expect(d!.parent_answers).toBeNull()
    expect(d!.student_answers).toBeNull()

    const [l] = await h.sql`select status, token_hash from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('stage2_started')
    expect(l!.token_hash).toBe(hashToken(s.parentToken))
  })

  test('denies a non-staff actor (Forbidden), issuing no token and creating no draft', async () => {
    const f = await directorSetup()
    const strangerId = await makeAdult(h.sql)
    const otherChapter = await makeChapter(h.sql)
    const stranger = baseCtx(strangerId, new Date(), [mem('chapter_director', otherChapter)])

    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().startStage2(f.leadId, stranger)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)

    const [d] = await h.sql`select count(*)::int as n from application_draft where lead_id = ${f.leadId}`
    expect(d!.n).toBe(0)
    const [l] = await h.sql`select status, token_hash from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('new')
    expect(l!.token_hash).toBeNull()
  })
})

// ===========================================================================
describe('saveParentSection (2A, parent token)', () => {
  test('saves parent_answers, advances the draft to 2b, and issues the student token', async () => {
    const f = await directorSetup()
    const s = await start(f)

    const p = await svc().saveParentSection(s.parentToken, parentAnswers)
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
    const f = await directorSetup()
    const s = await start(f)

    const p1 = await svc().saveParentSection(s.parentToken, { childName: 'Minor Testchild' })
    expect(typeof p1.studentToken).toBe('string')
    const p2 = await svc().saveParentSection(s.parentToken, {
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
    // The one issued student token still governs the draft.
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
    const s = await start(f)
    const p = await svc().saveParentSection(s.parentToken, parentAnswers)
    return { s, studentToken: p.studentToken! }
  }

  test('accepts allowlisted, non-identifying answers; sets 2b_saved and advances to 2c', async () => {
    const f = await directorSetup()
    const { s, studentToken } = await toStudentPhase(f)

    await svc().saveStudentSection(studentToken, { motivation: 'x', interests: 'y', goals: 'z' })

    const [d] = await h.sql`select phase, status, student_answers from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2c')
    expect(d!.status).toBe('2b_saved')
    expect(d!.student_answers).toMatchObject({ motivation: 'x', interests: 'y', goals: 'z' })
  })

  test('rejects an identifying field (name/email/school) LOUDLY, storing nothing', async () => {
    const f = await directorSetup()
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

    // Nothing persisted; the draft is untouched at 2b.
    const [d] = await h.sql`select phase, status, student_answers from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2b')
    expect(d!.student_answers).toBeNull()
  })

  test('rejects an unknown, non-identifying field that is not on the allowlist', async () => {
    const f = await directorSetup()
    const { studentToken } = await toStudentPhase(f)

    let caught: unknown
    try {
      await svc().saveStudentSection(studentToken, { motivation: 'x', secret_field: 'y' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(StudentSectionFieldNotAllowedError)
  })

  test('does NOT submit: no application exists and the lead is still stage2_started', async () => {
    const f = await directorSetup()
    const { s, studentToken } = await toStudentPhase(f)

    const before = await countApps()
    await svc().saveStudentSection(studentToken, studentAnswers)
    expect(await countApps()).toBe(before)

    const [d] = await h.sql`select status from application_draft where id = ${s.draftId}`
    expect(d!.status).toBe('2b_saved')
    const [l] = await h.sql`select status, converted_application_id from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('stage2_started')
    expect(l!.converted_application_id).toBeNull()
  })

  test('no student email is ever stored on the draft', async () => {
    const f = await directorSetup()
    const { s, studentToken } = await toStudentPhase(f)
    await svc().saveStudentSection(studentToken, studentAnswers)
    const [d] = await h.sql`select student_answers from application_draft where id = ${s.draftId}`
    expect(JSON.stringify(d!.student_answers)).not.toMatch(/@/)
  })
})

// ===========================================================================
describe('reviewStage2 + submitStage2 (2C, parent token only)', () => {
  async function toReview(f: Setup) {
    const s = await start(f)
    const p = await svc().saveParentSection(s.parentToken, parentAnswers)
    await svc().saveStudentSection(p.studentToken!, studentAnswers)
    return { s, studentToken: p.studentToken! }
  }

  test('reviewStage2 returns the 2A and 2B answers read-only', async () => {
    const f = await directorSetup()
    const { s } = await toReview(f)

    const review = await svc().reviewStage2(s.parentToken)
    expect(review.phase).toBe('2c')
    expect(review.parentAnswers).toMatchObject({ childName: 'Minor Testchild', school: 'Test Middle School' })
    expect(review.studentAnswers).toMatchObject({ motivation: 'I like building robots' })
  })

  test('submitStage2 mints the application from 2A+2B, converts the lead, submits the draft', async () => {
    const f = await directorSetup()
    const { s } = await toReview(f)

    const submit = await svc().submitStage2(s.parentToken)

    const [app] = await h.sql`select * from application where id = ${submit.applicationId}`
    expect(app!.kind).toBe('student')
    expect(app!.status).toBe('submitted')
    expect(app!.chapter_id).toBe(f.chapter)
    expect(app!.applicant_name).toBe('Minor Testchild')
    expect(app!.guardian_name).toBe('Parent Testperson')
    expect(app!.guardian_email).toBe('parent-guardian@example.test')
    // the 2B student section is stored on the application.
    expect(app!.student_section).toMatchObject({ motivation: 'I like building robots' })
    // no student email leaks onto the application student section.
    expect(JSON.stringify(app!.student_section)).not.toMatch(/@/)

    const [l] = await h.sql`select status, converted_application_id from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('converted')
    expect(l!.converted_application_id).toBe(submit.applicationId)

    const [d] = await h.sql`
      select phase, status, converted_application_id, submitted_at from application_draft where id = ${s.draftId}
    `
    expect(d!.phase).toBe('submitted')
    expect(d!.status).toBe('submitted')
    expect(d!.converted_application_id).toBe(submit.applicationId)
    expect(d!.submitted_at).not.toBeNull()
  })

  test('submitStage2 with a STUDENT token is rejected; no application is minted', async () => {
    const f = await directorSetup()
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

    const [l] = await h.sql`select status from application_lead where id = ${f.leadId}`
    expect(l!.status).toBe('stage2_started')
  })
})

// ===========================================================================
describe('sendBack (2C -> 2B)', () => {
  test('returns the draft to 2B without creating an application; the student re-saves and the parent then submits', async () => {
    const f = await directorSetup()
    const s = await start(f)
    const p = await svc().saveParentSection(s.parentToken, parentAnswers)
    await svc().saveStudentSection(p.studentToken!, { motivation: 'first draft' })

    const before = await countApps()
    await svc().sendBack(s.parentToken)
    expect(await countApps()).toBe(before)

    let [d] = await h.sql`select phase, status from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2b')
    expect(d!.status).toBe('sent_back')

    // The student (only the student, via the student token) revises 2B.
    await svc().saveStudentSection(p.studentToken!, { motivation: 'revised draft' })
    ;[d] = await h.sql`select phase, status, student_answers from application_draft where id = ${s.draftId}`
    expect(d!.phase).toBe('2c')
    expect(d!.status).toBe('2b_saved')
    expect(d!.student_answers.motivation).toBe('revised draft')

    // The parent submits the revised draft.
    const submit = await svc().submitStage2(s.parentToken)
    const [app] = await h.sql`select student_section from application where id = ${submit.applicationId}`
    expect(app!.student_section.motivation).toBe('revised draft')
  })

  test('there is no parent-editing path for the student section (only the student token writes 2B)', () => {
    const service = svc() as unknown as Record<string, unknown>
    // The parent cannot edit the student answers: no such method exists on the service.
    expect(service.editStudentSection).toBeUndefined()
    expect(service.saveStudentAnswersAsParent).toBeUndefined()
  })
})
