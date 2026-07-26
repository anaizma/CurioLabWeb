// -------------------------------------------------------------------------
// LeadService.createLead — the Stage 1 public, unauthenticated, INERT write
// (docs/superpowers/specs/2026-07-22-application-funnel-stage-1-design.md
// §7.2). It creates exactly one `application_lead` carrying a parent email, a
// chapter CODE, an OPTIONAL source, and who filled the form (filler_role); it
// issues the hashed Stage-2 token, stamps `expires_at = created_at + 30d`, and
// creates NO account and NO application. Safe to call with NO AuthContext.
// Deduped on email within a configurable window.
//
// Rate limiting and the bot check are HTTP-layer concerns (deferred).
// Embedded Postgres, synthetic data only.
// -------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeChapter } from './helpers/fixtures.js'
import { LeadService, Stage2Service } from '../src/index.js'

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

async function chapterSlug(id: string): Promise<string> {
  const [row] = await h.sql`select slug from chapter where id = ${id}`
  return row!.slug as string
}
async function countAccounts(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from account`
  return row!.n as number
}
async function countApplications(): Promise<number> {
  const [row] = await h.sql`select count(*)::int as n from application`
  return row!.n as number
}

describe('createLead — the inert Stage 1 lead write', () => {
  test('creates one lead with email/chapter-code/filler_role, an issued token, a 30-day expiry, and NO account or application', async () => {
    const accountsBefore = await countAccounts()
    const appsBefore = await countApplications()

    const result = await service().createLead({
      email: 'Prospect.Parent@Example.Test',
      chapter: 'interested-in-another-school',
      source: 'instagram',
      fillerRole: 'parent',
    })

    expect(result.suppressed).toBe(false)

    const [lead] = await h.sql`
      select email, chapter, chapter_id, source, filler_role, status, token_hash,
             converted_application_id, converted_at, created_at, expires_at
      from application_lead where id = ${result.leadId}
    `
    expect(lead!.status).toBe('new')
    expect(lead!.chapter).toBe('interested-in-another-school')
    // Code maps to no real chapter -> the optional 2C linkage stays null.
    expect(lead!.chapter_id).toBeNull()
    expect(lead!.source).toBe('instagram')
    expect(lead!.filler_role).toBe('parent')
    // The Stage-2 token is issued (hashed) at creation, per design §7.1.
    expect(lead!.token_hash).not.toBeNull()
    expect(typeof lead!.token_hash).toBe('string')
    // Not converted yet.
    expect(lead!.converted_application_id).toBeNull()
    expect(lead!.converted_at).toBeNull()
    // citext preserves case on read; the dedupe test proves the ci comparison.
    expect(lead!.email).toBe('Prospect.Parent@Example.Test')
    // expires_at is exactly created_at + 30 days.
    const days = (new Date(lead!.expires_at).getTime() - new Date(lead!.created_at).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(30)

    // Nothing else was created: no account, no application, no child data.
    expect(await countAccounts()).toBe(accountsBefore)
    expect(await countApplications()).toBe(appsBefore)
  })

  test('source is optional — a lead is captured without it', async () => {
    const result = await service().createLead({
      email: `nosource-${Date.now()}@example.test`,
      chapter: 'case-western-reserve-university',
      fillerRole: 'student',
    })
    const [row] = await h.sql`select source, filler_role from application_lead where id = ${result.leadId}`
    expect(row!.source).toBeNull()
    expect(row!.filler_role).toBe('student')
  })

  test('a chapter code that matches a real chapter slug resolves the optional chapter_id fk', async () => {
    const chapter = await makeChapter(h.sql)
    const code = await chapterSlug(chapter)
    const result = await service().createLead({
      email: `mapped-${Date.now()}@example.test`,
      chapter: code,
      fillerRole: 'parent',
    })
    const [row] = await h.sql`select chapter, chapter_id from application_lead where id = ${result.leadId}`
    expect(row!.chapter).toBe(code)
    expect(row!.chapter_id).toBe(chapter)
  })

  test('a repeat email on an OPEN lead resends: same row, fresh token, advanced last_requested_at, no duplicate', async () => {
    const email = `resend-${Date.now()}@example.test`
    const first = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    const [before] = await h.sql`select token_hash, last_requested_at from application_lead where id = ${first.leadId}`

    const second = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    expect(second.suppressed).toBe(false)
    expect(second.resent).toBe(true)
    expect(second.leadId).toBe(first.leadId)
    expect(second.parentToken).not.toBeNull()
    const [after] = await h.sql`select token_hash, last_requested_at from application_lead where id = ${first.leadId}`
    expect(after!.token_hash).not.toBe(before!.token_hash)
    expect(new Date(after!.last_requested_at).getTime()).toBeGreaterThanOrEqual(new Date(before!.last_requested_at).getTime())
    const [row] = await h.sql`select count(*)::int as n from application_lead where email = ${email}`
    expect(row!.n).toBe(1)
  })

  test('the resent parentToken drives startStage2 (fresh link works); the old token no longer resolves', async () => {
    const email = `resend-token-${Date.now()}@example.test`
    const first = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    const oldToken = first.parentToken!
    const second = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    const newToken = second.parentToken!
    expect(newToken).not.toBe(oldToken)
    const started = await new Stage2Service({ sql: h.sql }).startStage2(newToken)
    expect(started.leadId).toBe(first.leadId)
    await expect(new Stage2Service({ sql: h.sql }).startStage2(oldToken)).rejects.toThrow()
  })

  test('a repeat email whose only prior lead is CONVERTED creates a NEW lead (fresh interest)', async () => {
    const chapter = await makeChapter(h.sql)
    const email = `converted-reapply-${Date.now()}@example.test`
    const first = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    // A real application row to satisfy the converted_application_id fk, then mark converted.
    const [app] = await h.sql`
      insert into application (kind, chapter_id, status, applicant_name, applicant_contact_email)
      values ('student', ${chapter}, 'submitted', 'Test Child', 'student@example.test')
      returning id
    `
    await h.sql`update application_lead set status = 'converted', converted_application_id = ${app!.id}, converted_at = now() where id = ${first.leadId}`

    const second = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    expect(second.resent).toBe(false)
    expect(second.suppressed).toBe(false)
    expect(second.leadId).not.toBe(first.leadId)
    const [row] = await h.sql`select count(*)::int as n from application_lead where email = ${email}`
    expect(row!.n).toBe(2)
  })

  test('re-apply matches the email case-insensitively (citext): same lead, resent', async () => {
    const base = `Case-${Date.now()}@Example.Test`
    const first = await service().createLead({ email: base, chapter: 'c', fillerRole: 'parent' })
    const second = await service().createLead({ email: base.toLowerCase(), chapter: 'c', fillerRole: 'parent' })
    expect(second.resent).toBe(true)
    expect(second.leadId).toBe(first.leadId)
  })

  test('distinct emails are not deduped', async () => {
    const a = await service().createLead({ email: `alpha-${Date.now()}@example.test`, chapter: 'c', fillerRole: 'parent' })
    const b = await service().createLead({ email: `beta-${Date.now()}@example.test`, chapter: 'c', fillerRole: 'parent' })
    expect(a.suppressed).toBe(false)
    expect(b.suppressed).toBe(false)
    expect(b.leadId).not.toBe(a.leadId)
  })

})

// ===========================================================================
// The Stage-2 entry seam: createLead RETURNS the raw Stage-2 token, but ONLY to
// a parent-filler (who receives the response), so a student-filler cannot proceed
// as the parent — the parent gets the token by email later. This is the same
// safety line as the 2A/2B two-token split.
describe('createLead — the returned parentToken (Stage-2 entry seam)', () => {
  test('a parent-filled Stage 1 returns a non-null parentToken that drives startStage2', async () => {
    const result = await service().createLead({
      email: `parent-token-${Date.now()}@example.test`,
      chapter: 'c',
      fillerRole: 'parent',
    })
    expect(result.suppressed).toBe(false)
    expect(result.parentToken).not.toBeNull()
    expect(typeof result.parentToken).toBe('string')

    // The EXACT returned token drives startStage2 and mints a draft bound to the lead.
    const started = await new Stage2Service({ sql: h.sql }).startStage2(result.parentToken!)
    expect(started.leadId).toBe(result.leadId)
    const [draft] = await h.sql`select lead_id from application_draft where id = ${started.draftId}`
    expect(draft!.lead_id).toBe(result.leadId)
  })

  test('a student-filled Stage 1 returns parentToken: null, but the lead still carries a hashed token server-side', async () => {
    const result = await service().createLead({
      email: `student-token-${Date.now()}@example.test`,
      chapter: 'c',
      fillerRole: 'student',
    })
    expect(result.suppressed).toBe(false)
    // The student-filler must not receive the token — the parent gets it by email.
    expect(result.parentToken).toBeNull()

    // But the token still exists server-side (hashed) for the future parent mailer.
    const [lead] = await h.sql`select token_hash from application_lead where id = ${result.leadId}`
    expect(lead!.token_hash).not.toBeNull()
    expect(typeof lead!.token_hash).toBe('string')
  })

  test('a re-apply returns a FRESH non-null parentToken (a new link is minted)', async () => {
    const email = `dupe-token-${Date.now()}@example.test`
    const first = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    const second = await service().createLead({ email, chapter: 'c', fillerRole: 'parent' })
    expect(second.resent).toBe(true)
    expect(second.parentToken).not.toBeNull()
    expect(second.parentToken).not.toBe(first.parentToken)
  })
})
