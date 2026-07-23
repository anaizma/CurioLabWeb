// The full apply-funnel walk over the REAL Next route handlers, embedded
// Postgres, synthetic data only. Stage 1 (/api/apply) is frontend-owned and is
// exercised here (packages/http/test/public-funnel.test.ts covers the
// controllers but deliberately not this route).
import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { setSqlForTesting } from '@curiolab/http'
import { startHarness, type Harness } from '../packages/http/test/helpers/pg.js'
import { POST as apply } from '../app/api/apply/route'
import { POST as start } from '../app/api/public/stage2/start/route'
import { POST as parent } from '../app/api/public/stage2/parent/route'
import { POST as studentLink } from '../app/api/public/stage2/student-link/route'
import { POST as student } from '../app/api/public/stage2/student/route'
import { POST as review } from '../app/api/public/stage2/review/route'
import { POST as submit } from '../app/api/public/stage2/submit/route'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
  setSqlForTesting(h.sql)
}, 240_000)

afterAll(async () => {
  setSqlForTesting(null)
  await h?.end()
})

/**
 * The `chapter` table has NOT-NULL columns beyond (name, slug) — tier, status,
 * timezone (packages/db/src/schema.ts) — and the http package's `makeChapter`
 * fixture (packages/http/test/helpers/fixtures.ts) does not accept a slug
 * parameter, so a known-slug chapter (needed for the lead's chapter code to
 * map) is inserted directly here, mirroring makeChapter's own values.
 */
async function makeChapterWithSlug(slug: string): Promise<void> {
  await h.sql`
    insert into chapter (name, slug, tier, status, timezone)
    values ('Test Chapter', ${slug}, 'active', 'active', 'America/New_York')
  `
}

function req(payload: unknown): Request {
  return new Request('http://test.local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

describe('the apply funnel, end to end over the route handlers', () => {
  test('parent walk: apply -> start -> 2A -> link -> 2B -> review -> submit', async () => {
    // A chapter the lead's slug maps to (submit requires the mapping).
    const slug = `cwru-test-${randomUUID().slice(0, 8)}`
    await makeChapterWithSlug(slug)

    // Stage 1 — parent filler gets the raw parent token back.
    const applyRes = await apply(
      req({ email: 'pat.tester@example.test', chapter: slug, source: 'flow-test', fillerRole: 'parent' }),
    )
    expect(applyRes.status).toBe(201)
    const applyBody = await json(applyRes)
    expect(applyBody.suppressed).toBe(false)
    const parentToken = applyBody.parentToken as string
    expect(typeof parentToken).toBe('string')

    // start consumes the lead token and creates the draft.
    expect((await start(req({ token: parentToken }))).status).toBe(201)

    // 2A parent facts (childName/guardianName/guardianEmail are required at submit).
    const parentSave = await parent(
      req({
        token: parentToken,
        answers: {
          childName: 'Testy Example', childDob: '2013-01-01', gradeEntering: '7',
          schoolName: 'Example Middle School', guardianName: 'Pat Tester',
          guardianEmail: 'pat.tester@example.test', guardianPhone: '555-0100',
          relationship: 'Parent', saturdayAvailability: true,
          commitmentAcknowledged: true, attestedGuardian: true, contactConsent: true,
        },
      }),
    )
    expect(parentSave.status).toBe(200)

    // Mint the 2B link; the student saves NON-IDENTIFYING answers only.
    const linkRes = await studentLink(req({ token: parentToken }))
    expect(linkRes.status).toBe(200)
    const studentToken = (await json(linkRes)).studentToken as string

    const studentSave = await student(
      req({ token: studentToken, answers: { interests: 'building model rockets', motivation: 'i want to make things', goals: 'finish a real project' } }),
    )
    expect(studentSave.status).toBe(200)

    // 2C: review shows both sections read-only; submit mints the application.
    const reviewRes = await review(req({ token: parentToken }))
    expect(reviewRes.status).toBe(200)
    const reviewBody = await json(reviewRes)
    expect((reviewBody.parentAnswers as Record<string, unknown>).childName).toBe('Testy Example')
    expect((reviewBody.studentAnswers as Record<string, unknown>).interests).toBe('building model rockets')

    const submitRes = await submit(req({ token: parentToken }))
    expect(submitRes.status).toBe(201)
    const submitBody = await json(submitRes)
    const apps = await h.sql`select id, status from application where id = ${submitBody.applicationId as string}`
    expect(apps).toHaveLength(1)
    expect(apps[0]!.status).toBe('submitted')
  })

  test('a student filler gets NO token back', async () => {
    const res = await apply(
      req({ email: 'other.parent@example.test', chapter: 'another-school', fillerRole: 'student' }),
    )
    expect(res.status).toBe(201)
    expect((await json(res)).parentToken).toBeNull()
  })

  test('the student token cannot submit and identifying 2B fields are rejected', async () => {
    const slug = `cwru-t2-${randomUUID().slice(0, 8)}`
    await makeChapterWithSlug(slug)
    const applyBody = await json(
      await apply(req({ email: 'second.tester@example.test', chapter: slug, fillerRole: 'parent' })),
    )
    const parentToken = applyBody.parentToken as string
    await start(req({ token: parentToken }))
    await parent(req({ token: parentToken, answers: { childName: 'Kid Example', guardianName: 'Sam Tester', guardianEmail: 'second.tester@example.test' } }))
    const studentToken = (await json(await studentLink(req({ token: parentToken })))).studentToken as string

    // Identifying key -> loud 400.
    expect((await student(req({ token: studentToken, answers: { childSchool: 'Real Name Middle' } }))).status).toBe(400)
    // Student token against a parent-token endpoint -> 401 (opaque).
    expect((await submit(req({ token: studentToken }))).status).toBe(401)
    // Bad token -> 401, never a 500.
    expect((await start(req({ token: 'not-a-real-token' }))).status).toBe(401)
  })
})
