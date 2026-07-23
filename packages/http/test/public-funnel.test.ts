// -------------------------------------------------------------------------
// Public funnel controller chain (the Stage 2 token-gated chain). Embedded
// Postgres, synthetic data only.
//
// Stage 1 (the lead write, POST /api/apply) is owned by the web/frontend (design
// §7.3), so it is NOT exercised here; the test seeds a lead the way createLead
// leaves it (a chapter code + a Stage-2 token whose hash is on the lead). It then
// proves the framework-agnostic Stage 2 controllers:
//   - start consumes the lead token and creates the draft (token-gated, no session);
//   - 2A parent, 2B student, 2C review + submit mint the application and set the
//     lead's converted_at; send-back returns 2C -> 2B;
//   - a bad/missing token is a 4xx (opaque), never a 500;
//   - a 2B save of an identifying field is a 400 (loud), not a 500.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { generateSessionToken, hashToken } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import {
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

/** A lead as createLead leaves it: chapter code + chapter_id fk + issued token. */
async function seedLead(chapterId: string): Promise<{ leadId: string; token: string }> {
  const token = generateSessionToken()
  const [row] = await h.sql`
    insert into application_lead (email, chapter, chapter_id, source, filler_role, status, token_hash)
    values (${`parent-${randomUUID().slice(0, 8)}@example.test`}, 'a-chapter-code', ${chapterId},
            'friend', 'parent', 'new', ${hashToken(token)})
    returning id
  `
  return { leadId: row!.id as string, token }
}

describe('startStage2 — the token-gated Stage 2 start', () => {
  test('consumes the lead token, creates a draft, no session required', async () => {
    const chapter = await makeChapter(h.sql)
    const { leadId, token } = await seedLead(chapter)

    const started = await startStage2({ sql: h.sql, body: { token } })
    expect(started.status).toBe(201)
    expect(started.body.leadId).toBe(leadId)
    expect(started.body.draftId).toBeTruthy()

    const [l] = await h.sql`select status from application_lead where id = ${leadId}`
    expect(l!.status).toBe('stage2_started')
  })

  test('a missing token is a 400, not a 500', async () => {
    const res = await startStage2({ sql: h.sql, body: {} })
    expect(res.status).toBe(400)
  })

  test('a forged lead token is a 401 (opaque), not a 500', async () => {
    const res = await startStage2({ sql: h.sql, body: { token: 'not-a-real-token' } })
    expect(res.status).toBe(401)
  })
})

describe('the Stage 2 three-phase chain against tokens', () => {
  test('start -> 2A -> 2B -> 2C review -> submit mints the application and converts the lead', async () => {
    const chapter = await makeChapter(h.sql)
    const { leadId, token: parentToken } = await seedLead(chapter)

    const started = await startStage2({ sql: h.sql, body: { token: parentToken } })
    expect(started.status).toBe(201)

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
    const [ld] = await h.sql`select status, converted_at from application_lead where id = ${leadId}`
    expect(ld!.status).toBe('converted')
    expect(ld!.converted_at).not.toBeNull()
  })

  test('send-back returns the draft from 2C to 2B', async () => {
    const chapter = await makeChapter(h.sql)
    const { leadId, token: parentToken } = await seedLead(chapter)
    await startStage2({ sql: h.sql, body: { token: parentToken } })
    const parentSaved = await saveParentSection({
      sql: h.sql,
      body: { token: parentToken, answers: { childName: 'C', guardianName: 'P', guardianEmail: 'parent-c@example.test' } },
    })
    await saveStudentSection({ sql: h.sql, body: { token: parentSaved.body.studentToken!, answers: { motivation: 'x' } } })

    const back = await sendBack({ sql: h.sql, body: { token: parentToken } })
    expect(back.status).toBe(200)
    const [draft] = await h.sql`select phase, status from application_draft where lead_id = ${leadId}`
    expect(draft!.phase).toBe('2b')
    expect(draft!.status).toBe('sent_back')
  })

  test('a forged Stage 2 token is a 401 (opaque), not a 500', async () => {
    const res = await reviewStage2({ sql: h.sql, body: { token: 'not-a-real-token' } })
    expect(res.status).toBe(401)
  })

  test('a 2B save of an identifying field is a 400 (loud), not a 500', async () => {
    const chapter = await makeChapter(h.sql)
    const { token: parentToken } = await seedLead(chapter)
    await startStage2({ sql: h.sql, body: { token: parentToken } })
    const parentSaved = await saveParentSection({
      sql: h.sql,
      body: { token: parentToken, answers: { childName: 'D', guardianName: 'P', guardianEmail: 'parent-d@example.test' } },
    })
    const res = await saveStudentSection({
      sql: h.sql,
      body: { token: parentSaved.body.studentToken!, answers: { fullName: 'smuggled' } },
    })
    expect(res.status).toBe(400)
  })
})
