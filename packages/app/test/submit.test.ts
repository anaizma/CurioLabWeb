import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { authorize } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import { ApplicationService } from '../src/index.js'
import { DEDUPE_WINDOW_MS } from '../src/config.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function service() {
  return new ApplicationService({ sql: h.sql, authorize })
}

async function countAccounts(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from account`
  return row!.n as number
}

describe('submitApplication — the inert public write (POST /public/apply)', () => {
  test('creates exactly one submitted application and NO account and NO edge', async () => {
    const chapter = await makeChapter(h.sql)
    const accountsBefore = await countAccounts()

    // The inert write must be safe to call with NO AuthContext.
    const result = await service().submitApplication({
      kind: 'student',
      chapterId: chapter,
      applicantName: 'Zeb Quibblesworth',
      applicantContactEmail: 'zeb.guardian@example.test',
      guardianName: 'Pat Quibblesworth',
      guardianEmail: 'zeb.guardian@example.test',
    })

    expect(result.suppressed).toBe(false)

    const apps = await h.sql`select id, status, kind from application where id = ${result.applicationId}`
    expect(apps).toHaveLength(1)
    expect(apps[0]!.status).toBe('submitted')
    expect(apps[0]!.kind).toBe('student')

    // No account, no membership, no guardianship edge created.
    expect(await countAccounts()).toBe(accountsBefore)
    const memberships = await h.sql`select count(*)::int as n from membership`
    const edges = await h.sql`select count(*)::int as n from guardianship`
    expect(memberships[0]!.n).toBe(0)
    expect(edges[0]!.n).toBe(0)
  })

  test('a duplicate on (guardian_email, applicant_name) within the window is suppressed', async () => {
    const chapter = await makeChapter(h.sql)
    const input = {
      kind: 'student' as const,
      chapterId: chapter,
      applicantName: 'Winnifred Snorkeldink',
      applicantContactEmail: 'snork.guardian@example.test',
      guardianName: 'Ada Snorkeldink',
      guardianEmail: 'snork.guardian@example.test',
    }
    const first = await service().submitApplication(input)
    const second = await service().submitApplication(input)

    expect(first.suppressed).toBe(false)
    expect(second.suppressed).toBe(true)
    expect(second.applicationId).toBe(first.applicationId)

    const rows = await h.sql`
      select count(*)::int as n from application
      where applicant_name = ${input.applicantName} and guardian_email = ${input.guardianEmail}
    `
    expect(rows[0]!.n).toBe(1)
  })

  test('distinct applicants are not suppressed', async () => {
    const chapter = await makeChapter(h.sql)
    const a = await service().submitApplication({
      kind: 'student',
      chapterId: chapter,
      applicantName: 'Bartholomew Fizzlewhistle',
      applicantContactEmail: 'fizz.guardian@example.test',
      guardianName: 'Guardian Fizzlewhistle',
      guardianEmail: 'fizz.guardian@example.test',
    })
    // Same guardian email, different applicant -> a distinct applicant.
    const b = await service().submitApplication({
      kind: 'student',
      chapterId: chapter,
      applicantName: 'Clementine Fizzlewhistle',
      applicantContactEmail: 'fizz.guardian@example.test',
      guardianName: 'Guardian Fizzlewhistle',
      guardianEmail: 'fizz.guardian@example.test',
    })

    expect(a.suppressed).toBe(false)
    expect(b.suppressed).toBe(false)
    expect(b.applicationId).not.toBe(a.applicationId)
  })

  test('a resubmission OUTSIDE the dedupe window is not suppressed (the window is honored)', async () => {
    const chapter = await makeChapter(h.sql)
    const input = {
      kind: 'student' as const,
      chapterId: chapter,
      applicantName: 'Thaddeus Bramblewick',
      applicantContactEmail: 'bramble.guardian@example.test',
      guardianName: 'Guardian Bramblewick',
      guardianEmail: 'bramble.guardian@example.test',
    }
    const first = await service().submitApplication(input)

    // Backdate the first row to just beyond the dedupe window.
    const past = new Date(Date.now() - DEDUPE_WINDOW_MS - 60_000)
    await h.sql`update application set created_at = ${past} where id = ${first.applicationId}`

    const second = await service().submitApplication(input)
    expect(second.suppressed).toBe(false)
    expect(second.applicationId).not.toBe(first.applicationId)
  })
})
