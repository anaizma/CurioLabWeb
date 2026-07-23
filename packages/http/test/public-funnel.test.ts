// -------------------------------------------------------------------------
// Public funnel controller chain (Milestone 1 part A/B). Embedded Postgres,
// synthetic data only.
//
// Proves the framework-agnostic controllers behind the public funnel:
//   - submitLead runs with NO session, creating exactly one inert lead
//     (application_lead, no account, no application);
//   - the Stage 2 chain is token-gated: start (staff), 2A parent, 2B student,
//     2C review + submit mint the application; send-back returns 2C -> 2B;
//   - a bad/missing token is a 4xx (opaque), never a 500;
//   - a 2B save of an identifying field is a 400 (loud), not a 500.
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import {
  submitLead,
  startStage2,
  saveParentSection,
  saveStudentSection,
  reviewStage2,
  submitStage2,
  sendBack,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

/** A director with a chapter_director membership in `chapter`, plus a live session token. */
async function directorSession(chapter: string): Promise<string> {
  const director = await makeAdult(h.sql)
  await h.sql`
    insert into membership (account_id, chapter_id, role, status)
    values (${director}, ${chapter}, 'chapter_director', 'active')
  `
  const { token } = await createSession(h.sql, {
    accountId: director,
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  return token
}

describe('submitLead — the public inert Stage 1 write', () => {
  test('creates one application_lead with no session, no account, no application', async () => {
    const chapter = await makeChapter(h.sql)
    const res = await submitLead({
      sql: h.sql,
      body: { email: 'parent-a@example.test', chapterId: chapter, referralSource: 'friend' },
    })
    expect(res.status).toBe(201)
    expect(res.body.suppressed).toBe(false)
    expect(res.body.leadId).toBeTruthy()

    const [lead] = await h.sql`select * from application_lead where id = ${res.body.leadId}`
    expect(lead!.status).toBe('new')
    expect(lead!.email).toBe('parent-a@example.test')
    // Inert: no application row was created.
    const apps = await h.sql`select 1 from application`
    expect(apps).toHaveLength(0)
  })

  test('missing required fields are a 400, not a 500', async () => {
    const res = await submitLead({ sql: h.sql, body: { referralSource: 'friend' } as never })
    expect(res.status).toBe(400)
  })
})

describe('the Stage 2 three-phase chain against tokens', () => {
  test('start (staff) -> 2A -> 2B -> 2C review -> submit mints the application', async () => {
    const chapter = await makeChapter(h.sql)
    const lead = await submitLead({
      sql: h.sql,
      body: { email: 'parent-b@example.test', chapterId: chapter, referralSource: 'search' },
    })
    const token = await directorSession(chapter)

    // start: staff-gated (lead.invite). Issues the parent token.
    const started = await startStage2({ sql: h.sql, sessionToken: token, params: { leadId: lead.body.leadId } })
    expect(started.status).toBe(201)
    const parentToken = started.body.parentToken
    expect(parentToken).toBeTruthy()

    // 2A: the parent section; issues the student token.
    const parentSaved = await saveParentSection({
      sql: h.sql,
      body: {
        token: parentToken,
        answers: { childName: 'Minor Testchild', guardianName: 'Parent Testperson', guardianEmail: 'parent-b@example.test' },
      },
    })
    expect(parentSaved.status).toBe(200)
    const studentToken = parentSaved.body.studentToken!
    expect(studentToken).toBeTruthy()

    // 2B: the student's non-identifying section (saves, does not submit).
    const studentSaved = await saveStudentSection({
      sql: h.sql,
      body: { token: studentToken, answers: { motivation: 'I like robots', interests: 'robotics' } },
    })
    expect(studentSaved.status).toBe(200)

    // 2C: the parent reviews read-only.
    const review = await reviewStage2({ sql: h.sql, body: { token: parentToken } })
    expect(review.status).toBe(200)
    expect(review.body.parentAnswers).toMatchObject({ childName: 'Minor Testchild' })
    expect(review.body.studentAnswers).toMatchObject({ motivation: 'I like robots' })

    // 2C submit: the ONE place the application is minted, parent token only.
    const submitted = await submitStage2({ sql: h.sql, body: { token: parentToken } })
    expect(submitted.status).toBe(201)
    expect(submitted.body.applicationId).toBeTruthy()

    const [app] = await h.sql`select * from application where id = ${submitted.body.applicationId}`
    expect(app!.status).toBe('submitted')
    expect(app!.applicant_name).toBe('Minor Testchild')
    const [ld] = await h.sql`select status from application_lead where id = ${lead.body.leadId}`
    expect(ld!.status).toBe('converted')
  })

  test('send-back returns the draft from 2C to 2B', async () => {
    const chapter = await makeChapter(h.sql)
    const lead = await submitLead({
      sql: h.sql,
      body: { email: 'parent-c@example.test', chapterId: chapter, referralSource: 'search' },
    })
    const token = await directorSession(chapter)
    const started = await startStage2({ sql: h.sql, sessionToken: token, params: { leadId: lead.body.leadId } })
    const parentToken = started.body.parentToken
    const parentSaved = await saveParentSection({
      sql: h.sql,
      body: { token: parentToken, answers: { childName: 'C', guardianName: 'P', guardianEmail: 'parent-c@example.test' } },
    })
    await saveStudentSection({ sql: h.sql, body: { token: parentSaved.body.studentToken!, answers: { motivation: 'x' } } })

    const back = await sendBack({ sql: h.sql, body: { token: parentToken } })
    expect(back.status).toBe(200)
    const [draft] = await h.sql`select phase, status from application_draft where lead_id = ${lead.body.leadId}`
    expect(draft!.phase).toBe('2b')
    expect(draft!.status).toBe('sent_back')
  })

  test('a forged Stage 2 token is a 401 (opaque), not a 500', async () => {
    const res = await reviewStage2({ sql: h.sql, body: { token: 'not-a-real-token' } })
    expect(res.status).toBe(401)
  })

  test('a 2B save of an identifying field is a 400 (loud), not a 500', async () => {
    const chapter = await makeChapter(h.sql)
    const lead = await submitLead({
      sql: h.sql,
      body: { email: 'parent-d@example.test', chapterId: chapter, referralSource: 'search' },
    })
    const token = await directorSession(chapter)
    const started = await startStage2({ sql: h.sql, sessionToken: token, params: { leadId: lead.body.leadId } })
    const parentSaved = await saveParentSection({
      sql: h.sql,
      body: { token: started.body.parentToken, answers: { childName: 'D', guardianName: 'P', guardianEmail: 'parent-d@example.test' } },
    })
    const res = await saveStudentSection({
      sql: h.sql,
      body: { token: parentSaved.body.studentToken!, answers: { fullName: 'smuggled' } },
    })
    expect(res.status).toBe(400)
  })
})
