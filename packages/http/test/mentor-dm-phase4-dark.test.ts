// -------------------------------------------------------------------------
// Mentor-student direct messaging (Phase 4) — DARK refusal at the HTTP boundary.
// With MENTOR_DM_ENABLED off (the production default), EVERY Phase-4 route refuses
// even for a valid session: the dark gate throws DmNotAuthorizedForPairError, which
// maps to a 409 conflict. This file forces the flag OFF at the very top (before any
// @curiolab import, so config.ts reads it) so it is independent of file ordering.
// -------------------------------------------------------------------------

// Force the feature dark for THIS file's module graph (vitest isolates modules per
// file), regardless of any other file that enabled it.
delete process.env.MENTOR_DM_ENABLED

import { randomUUID } from 'node:crypto'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import {
  listDmThreads,
  getDmOnboarding,
  ackDmOnboarding,
  sendDmMessage,
  readChildDm,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

async function studentSession(): Promise<{ student: string; sessionToken: string; chapter: string }> {
  const chapter = await makeChapter(h.sql)
  const [row] = await h.sql`
    insert into account (username, legal_name, display_name, date_of_birth, dob_provenance, dob_source_ref, credential_owner, status, maturation_state)
    values (${`s-${randomUUID().slice(0, 8)}`}, 'Minor Testchild', 'Minor T.', '2015-06-01', 'enrollment_record', ${randomUUID()}, 'guardian_provisioned', 'active', 'minor')
    returning id
  `
  const student = row!.id as string
  await h.sql`insert into membership (account_id, chapter_id, role, status) values (${student}, ${chapter}, 'student', 'active')`
  const { token } = await createSession(h.sql, { accountId: student, expiresAt: new Date(Date.now() + 3_600_000) })
  return { student, sessionToken: token, chapter }
}

describe('every Phase-4 route refuses with MENTOR_DM_ENABLED off (dark)', () => {
  test('list, onboarding get/ack, send, and guardian read all refuse (409) for a valid session', async () => {
    const s = await studentSession()
    const common = { sql: h.sql, sessionToken: s.sessionToken }

    expect((await listDmThreads(common)).status).toBe(409)
    expect((await getDmOnboarding(common)).status).toBe(409)
    expect((await ackDmOnboarding(common)).status).toBe(409)
    expect(
      (await sendDmMessage({
        ...common,
        body: { mentorMembershipId: randomUUID(), studentAccountId: s.student, chapterId: s.chapter, body: 'x' },
      })).status,
    ).toBe(409)
    expect((await readChildDm({ ...common, params: { id: s.student } })).status).toBe(409)
  })
})
