// -------------------------------------------------------------------------
// LeadService.submitLead — the Stage 1 public, unauthenticated, INERT write
// (milestone-1-application-funnel.md v2, invariant 1). It creates exactly one
// `application_lead` in status `new` carrying only a parent email, a chapter,
// and a referral source: no account, no application, no child data. Safe to
// call with NO AuthContext. Deduped on email within a configurable window.
//
// Rate limiting and the bot check are HTTP-layer concerns (deferred).
// Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import { LeadService } from '../src/index.js'
import { LEAD_DEDUPE_WINDOW_MS } from '../src/config.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function service(overrides: Record<string, unknown> = {}) {
  return new LeadService({ sql: h.sql, ...overrides })
}

async function countAccounts(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from account`
  return row!.n as number
}
async function countApplications(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from application`
  return row!.n as number
}

describe('submitLead — the inert Stage 1 lead write', () => {
  test('creates exactly one application_lead in new with only email/chapter/referral, and NO account or application', async () => {
    const chapter = await makeChapter(h.sql)
    const accountsBefore = await countAccounts()
    const appsBefore = await countApplications()

    const result = await service().submitLead({
      email: 'Prospect.Parent@Example.Test',
      chapterId: chapter,
      referralSource: 'instagram',
    })

    expect(result.suppressed).toBe(false)

    const leads = await h.sql`
      select email, chapter_id, referral_source, status, token_hash, converted_application_id
      from application_lead where id = ${result.leadId}
    `
    expect(leads).toHaveLength(1)
    expect(leads[0]!.status).toBe('new')
    expect(leads[0]!.chapter_id).toBe(chapter)
    expect(leads[0]!.referral_source).toBe('instagram')
    // citext stores the value as given (case preserved on read); the dedupe test
    // below proves the case-insensitive comparison.
    expect(leads[0]!.email).toBe('Prospect.Parent@Example.Test')
    // No Stage 2 token, no application yet — pure inert lead.
    expect(leads[0]!.token_hash).toBeNull()
    expect(leads[0]!.converted_application_id).toBeNull()

    // Nothing else was created: no account, no application, no child data.
    expect(await countAccounts()).toBe(accountsBefore)
    expect(await countApplications()).toBe(appsBefore)
  })

  test('a chapter is optional — a lead can be captured without one', async () => {
    const result = await service().submitLead({
      email: `nochapter-${Date.now()}@example.test`,
      referralSource: 'word of mouth',
    })
    const [row] = await h.sql`select chapter_id, status from application_lead where id = ${result.leadId}`
    expect(row!.chapter_id).toBeNull()
    expect(row!.status).toBe('new')
  })

  test('a duplicate on email within the window is suppressed (no second row)', async () => {
    const chapter = await makeChapter(h.sql)
    const email = `dupe-${Date.now()}@example.test`
    const first = await service().submitLead({ email, chapterId: chapter, referralSource: 'a' })
    const second = await service().submitLead({ email, chapterId: chapter, referralSource: 'b' })

    expect(first.suppressed).toBe(false)
    expect(second.suppressed).toBe(true)
    expect(second.leadId).toBe(first.leadId)

    const [row] = await h.sql`select count(*)::int as n from application_lead where email = ${email}`
    expect(row!.n).toBe(1)
  })

  test('the dedupe is case-insensitive on email (citext)', async () => {
    const base = `Case-${Date.now()}@Example.Test`
    const first = await service().submitLead({ email: base, referralSource: 'a' })
    const second = await service().submitLead({ email: base.toLowerCase(), referralSource: 'b' })
    expect(second.suppressed).toBe(true)
    expect(second.leadId).toBe(first.leadId)
  })

  test('distinct emails are not deduped', async () => {
    const a = await service().submitLead({ email: `alpha-${Date.now()}@example.test`, referralSource: 'x' })
    const b = await service().submitLead({ email: `beta-${Date.now()}@example.test`, referralSource: 'x' })
    expect(a.suppressed).toBe(false)
    expect(b.suppressed).toBe(false)
    expect(b.leadId).not.toBe(a.leadId)
  })

  test('a resubmission OUTSIDE the dedupe window is not suppressed (the window is honored)', async () => {
    const email = `stale-${Date.now()}@example.test`
    const first = await service().submitLead({ email, referralSource: 'x' })

    const past = new Date(Date.now() - LEAD_DEDUPE_WINDOW_MS - 60_000)
    await h.sql`update application_lead set created_at = ${past} where id = ${first.leadId}`

    const second = await service().submitLead({ email, referralSource: 'x' })
    expect(second.suppressed).toBe(false)
    expect(second.leadId).not.toBe(first.leadId)
  })

  test('the dedupe window comes from config: a tighter window stops deduping a backdated lead', async () => {
    const email = `cfg-${Date.now()}@example.test`
    const first = await service().submitLead({ email, referralSource: 'x' })
    // Backdate 2 minutes and use a 1-minute window: the earlier lead is now out of window.
    await h.sql`update application_lead set created_at = ${new Date(Date.now() - 120_000)} where id = ${first.leadId}`
    const second = await service({ config: { leadDedupeWindowMs: 60_000 } }).submitLead({ email, referralSource: 'x' })
    expect(second.suppressed).toBe(false)
    expect(second.leadId).not.toBe(first.leadId)
  })
})
