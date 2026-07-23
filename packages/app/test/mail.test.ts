// -------------------------------------------------------------------------
// Mailer wiring for the two BACKEND-owned application-funnel emails
// (milestone-1 application funnel). The frontend owns the parent-filler
// continue-link email; the backend owns the two emails whose tokens live
// server-side:
//
//   1. Student-filler -> parent link email (from LeadService.createLead when
//      fillerRole === 'student'): the parent never receives the Stage-2 token in
//      the API response, so the backend emails them the Stage-2 continue link,
//      built from the RAW token captured before it is hashed.
//   2. "Your child finished, ready to review" email (from
//      Stage2Service.saveStudentSection): the parent gets a working "Review and
//      submit" button. saveStudentSection mints a fresh review token, stores its
//      HASH on the draft, and puts the RAW token in the email link, so the button
//      drives the 2C ops directly (the parent no longer needs the link they hold).
//
// Embedded Postgres, synthetic data only, with a FakeMailer (no real send).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { generateSessionToken, hashToken } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import { LeadService, Stage2Service, FakeMailer, NoopMailer, defaultMailer, type Mailer } from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function bodyOf(msg: { html?: string; text?: string }): string {
  return `${msg.html ?? ''}\n${msg.text ?? ''}`
}

// ===========================================================================
describe('createLead — email 1: the student-filler -> parent Stage-2 link', () => {
  test('a student-filler records exactly one email to the parent whose link drives startStage2', async () => {
    const mailer = new FakeMailer()
    const email = `student-mail-${randomUUID().slice(0, 8)}@example.test`

    const result = await new LeadService({ sql: h.sql, mailer }).createLead({
      email,
      chapter: 'c',
      fillerRole: 'student',
    })
    expect(result.suppressed).toBe(false)

    // Exactly one email, addressed to the parent's email.
    expect(mailer.sent).toHaveLength(1)
    const msg = mailer.sent[0]!
    expect(msg.to).toBe(email)

    // The body carries the Stage-2 continue link and a token.
    const body = bodyOf(msg)
    expect(body).toContain('/apply/parent/')
    const match = body.match(/\/apply\/parent\/([A-Za-z0-9_-]+)/)
    expect(match).not.toBeNull()
    const token = match![1]!

    // The link is REAL, not a dead string: the token drives startStage2.
    const started = await new Stage2Service({ sql: h.sql, mailer: new FakeMailer() }).startStage2(token)
    expect(started.leadId).toBe(result.leadId)
  })

  test('a parent-filler records NO email (the frontend owns it) and still returns the parentToken', async () => {
    const mailer = new FakeMailer()
    const email = `parent-mail-${randomUUID().slice(0, 8)}@example.test`

    const result = await new LeadService({ sql: h.sql, mailer }).createLead({
      email,
      chapter: 'c',
      fillerRole: 'parent',
    })

    expect(mailer.sent).toHaveLength(0)
    expect(result.parentToken).not.toBeNull()
    expect(typeof result.parentToken).toBe('string')
  })

  test('a send failure does NOT roll back the lead (best-effort delivery)', async () => {
    const throwing: Mailer = {
      send: async () => {
        throw new Error('mail transport down')
      },
    }
    const email = `throw-mail-${randomUUID().slice(0, 8)}@example.test`

    const result = await new LeadService({ sql: h.sql, mailer: throwing }).createLead({
      email,
      chapter: 'c',
      fillerRole: 'student',
    })

    // The lead was created and NOT rolled back despite the failed send.
    expect(result.suppressed).toBe(false)
    const [lead] = await h.sql`select id from application_lead where id = ${result.leadId}`
    expect(lead).toBeDefined()
    expect(lead!.id).toBe(result.leadId)
  })
})

// ===========================================================================
describe('saveStudentSection — email 2: the ready-to-review parent email carries a working review button', () => {
  test('records one email to the parent whose /apply/review/ link drives reviewStage2', async () => {
    const mailer = new FakeMailer()
    const svc = new Stage2Service({ sql: h.sql, mailer })

    const chapter = await makeChapter(h.sql)
    const parentToken = generateSessionToken()
    const parentEmail = `parent-notify-${randomUUID().slice(0, 8)}@example.test`
    await h.sql`
      insert into application_lead (email, chapter, chapter_id, source, filler_role, status, token_hash)
      values (${parentEmail}, 'a-code', ${chapter}, 'instagram', 'parent', 'new', ${hashToken(parentToken)})
    `

    await svc.startStage2(parentToken)
    await svc.saveParentSection(parentToken, {
      childName: 'Minor Testchild',
      guardianName: 'Parent Testperson',
      guardianEmail: 'guardian@example.test',
    })
    const { studentToken } = await svc.createStudentLink(parentToken)

    // Only saveStudentSection sends: start / saveParent / createStudentLink do not.
    expect(mailer.sent).toHaveLength(0)

    await svc.saveStudentSection(studentToken, { motivation: 'I like building robots' })

    expect(mailer.sent).toHaveLength(1)
    const msg = mailer.sent[0]!
    expect(msg.to).toBe(parentEmail)
    expect(msg.subject.length).toBeGreaterThan(0)

    // The body carries the 2C review link and a token.
    const body = bodyOf(msg)
    expect(body).toContain('/apply/review/')
    const match = body.match(/\/apply\/review\/([A-Za-z0-9_-]+)/)
    expect(match).not.toBeNull()
    const reviewToken = match![1]!

    // The link is REAL, not a dead string: the token drives the 2C review op.
    const review = await svc.reviewStage2(reviewToken)
    expect(review.phase).toBe('2c')
    expect(review.parentAnswers).toMatchObject({ childName: 'Minor Testchild' })
  })
})

// ===========================================================================
describe('defaultMailer — runs fine with no Resend key', () => {
  test('with RESEND_API_KEY unset it is a NoopMailer and nothing throws', async () => {
    const prev = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY
    try {
      const mailer = defaultMailer()
      expect(mailer).toBeInstanceOf(NoopMailer)
      await expect(mailer.send({ to: 'nobody@example.test', subject: 's', text: 't' })).resolves.toBeUndefined()
    } finally {
      if (prev !== undefined) process.env.RESEND_API_KEY = prev
    }
  })
})
