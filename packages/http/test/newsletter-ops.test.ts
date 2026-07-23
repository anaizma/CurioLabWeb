// -------------------------------------------------------------------------
// Newsletter ops controllers (M3.7): draft/edit + the lifecycle actions
// (submit/schedule/publish/unpublish). Embedded Postgres, synthetic data only.
// Tests the CONTROLLERS.
//
// Drafting is WIDE (instructor/comms/director); publishing is NARROW (director,
// coupling E consent gate). A comms drafter may draft but not publish.
// -------------------------------------------------------------------------

import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { seedM3, sessionFor, grantConsent } from './helpers/seed-m3.js'
import { makeAdult, makeMembership } from './helpers/fixtures.js'
import {
  draftNewsletter,
  editNewsletter,
  submitNewsletter,
  scheduleNewsletter,
  publishNewsletter,
  unpublishNewsletter,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function issueStatus(id: string): Promise<string | undefined> {
  const [r] = await h.sql`select status from newsletter_issue where id = ${id}`
  return r?.status as string | undefined
}

// ===========================================================================
describe('a director drafts, edits, and publishes (with the student-item consent)', () => {
  test('draft -> edit -> submit -> schedule -> publish, coupling E consent satisfied', async () => {
    const s = await seedM3(h.sql)

    const draft = await draftNewsletter({
      sql: h.sql,
      sessionToken: s.directorToken,
      body: {
        chapterId: s.chapter,
        title: 'Fall Issue',
        body: 'Intro',
        items: [{ authorStudentAccountId: s.student, body: 'My robot' }],
      },
    })
    expect(draft.status).toBe(201)
    const issueId = draft.body.issueId
    expect(await issueStatus(issueId)).toBe('draft')

    const edited = await editNewsletter({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: issueId },
      body: { title: 'Fall Issue (revised)' },
    })
    expect(edited.status).toBe(200)
    const [row] = await h.sql`select title from newsletter_issue where id = ${issueId}`
    expect(row!.title).toBe('Fall Issue (revised)')

    const submitted = await submitNewsletter({ sql: h.sql, sessionToken: s.directorToken, params: { id: issueId } })
    expect(submitted.status).toBe(200)

    const scheduled = await scheduleNewsletter({
      sql: h.sql,
      sessionToken: s.directorToken,
      params: { id: issueId },
      body: { scheduledFor: '2099-10-01T00:00:00Z' },
    })
    expect(scheduled.status).toBe(200)

    // Coupling E: the student item's external_publication consent, scoped to the issue.
    await grantConsent(h.sql, s.student, s.guardian, 'external_publication', { scopeRef: issueId })

    const published = await publishNewsletter({ sql: h.sql, sessionToken: s.directorToken, params: { id: issueId } })
    expect(published.status).toBe(200)
    expect(await issueStatus(issueId)).toBe('published')

    const unpublished = await unpublishNewsletter({ sql: h.sql, sessionToken: s.directorToken, params: { id: issueId } })
    expect(unpublished.status).toBe(200)
    expect(await issueStatus(issueId)).toBe('archived')
  })
})

// ===========================================================================
describe('a comms associate may draft but not publish', () => {
  test('comms drafts (201); comms publish of a scheduled issue -> opaque 403', async () => {
    const s = await seedM3(h.sql)
    const comms = await makeAdult(h.sql)
    await makeMembership(h.sql, comms, s.chapter, { role: 'comms_associate' })
    const commsToken = await sessionFor(h.sql, comms)

    // Comms drafting is allowed.
    const draft = await draftNewsletter({
      sql: h.sql,
      sessionToken: commsToken,
      body: { chapterId: s.chapter, title: 'Comms Draft', body: 'Body' },
    })
    expect(draft.status).toBe(201)

    // A zero-student issue moved to 'scheduled' directly (seed), then comms publish -> 403.
    const [issue] = await h.sql`
      insert into newsletter_issue (chapter_id, title, body, status)
      values (${s.chapter}, 'Ready', 'Body', 'scheduled') returning id
    `
    const issueId = issue!.id as string
    const res = await publishNewsletter({ sql: h.sql, sessionToken: commsToken, params: { id: issueId } })
    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toMatch(/role_not_permitted|reason/)
    expect(await issueStatus(issueId)).toBe('scheduled')
  })
})
