// -------------------------------------------------------------------------
// LeadService — Stage 1 of the application funnel (docs/superpowers/specs/
// 2026-07-22-application-funnel-stage-1-design.md §7.1/§7.2; compliance-coppa.md
// "Stage 1: lead capture").
//
// The public, unauthenticated, INERT write. It creates exactly one
// `application_lead` carrying ONLY a parent email, a chapter CODE, an OPTIONAL
// "how did you hear" source, and who filled the form (`filler_role`, which
// drives the confirmation copy) — no account, no `application`, no child data.
// It ISSUES the hashed Stage-2 token now (forward-compat: nothing delivers it in
// Phase 1 — a receipt, not a link) and stamps `expires_at = created_at + 30d`,
// the § 312.4(c)(1)(vii) deletion floor the retention sweep reads.
//
// Safe to call with NO AuthContext: it is one of the enumerated actor-less inert
// endpoints (05-api-surface) and creates only a row that carries no authority.
// Deduped on `email` within a configurable window (config.ts). Rate limiting,
// per-IP/per-email throttling, and the bot check are HTTP-layer concerns and are
// intentionally NOT handled here — deferred to the HTTP layer.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { generateSessionToken, hashToken } from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { type Mailer, defaultMailer } from './mail.js'

export interface LeadServiceDeps {
  sql: Sql
  /** Optional overrides for the config-not-code tunables (dedupe/expiry windows). */
  config?: Partial<AppConfig>
  /**
   * The mailer used to send the BACKEND-owned student-filler -> parent Stage-2
   * link email. Defaults to `defaultMailer()` (a ResendMailer when RESEND_API_KEY
   * is set, else a NoopMailer) so the frontend's /api/apply route triggers the
   * email with no wiring change; tests inject a FakeMailer.
   */
  mailer?: Mailer
}

export interface CreateLeadInput {
  /** The parent's email — the only contact datum Stage 1 collects. */
  email: string
  /** The selected chapter CODE (not free text UI copy; may be "another school"). */
  chapter: string
  /** Where the parent heard about CurioLab — optional ("how did you hear"). */
  source?: string | null
  /** Who filled Stage 1 (parent | student); drives the confirmation copy. */
  fillerRole: 'parent' | 'student'
}

export interface CreateLeadResult {
  leadId: string
  /** Retired: always false now (re-apply resends rather than suppressing). Kept for callers. */
  suppressed: boolean
  /** True when a repeat email reused an open lead and re-minted its link. */
  resent: boolean
  /**
   * The raw Stage-2 token, returned ONLY for a parent-filled Stage 1 (the person
   * who submits Stage 1 receives the response). It is `null` for a student-filler
   * (the parent gets the token by email later). This is the seam startStage2
   * consumes to enter the application funnel.
   */
  parentToken: string | null
}

export class LeadService {
  private readonly sql: Sql
  private readonly config: AppConfig
  private readonly mailer: Mailer

  constructor(deps: LeadServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
    this.mailer = deps.mailer ?? defaultMailer(this.config.applyFromEmail)
  }

  /**
   * The unauthenticated, INERT Stage 1 write. A repeat email on an OPEN lead
   * (not converted, not deleted — any age) is a RE-APPLY: it reuses that same
   * row, mints a fresh Stage-2 token (the old link goes stale), refreshes
   * `expires_at`, stamps `last_requested_at = now()`, and carries the fresh
   * token onto any in-progress draft's `parent_token_hash`. Only when no open
   * lead exists (all prior converted/deleted) does it issue a hashed Stage-2
   * token, resolve the optional `chapter_id` fk when the chapter code maps to a
   * real chapter, stamp `expires_at = created_at + 30d`, and insert one fresh
   * `application_lead` in status `new`. Returns `{ leadId, suppressed, resent,
   * parentToken }` — where `parentToken` is the raw Stage-2 token for a
   * parent-filler (so they can proceed straight into Stage 2) and `null` for a
   * student-filler. Creates NO account and NO application. Safe to call with no
   * AuthContext.
   */
  async createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
    const source = input.source ?? null

    // Re-apply: reuse the most recent OPEN (not-yet-converted, not-deleted) lead
    // for this email, regardless of age. A parent who lost the link gets a FRESH
    // one (the old goes stale) without a duplicate row. Only when no open lead
    // exists (all prior converted/deleted) do we create a new lead below.
    const [openLead] = await this.sql`
      select id from application_lead
      where email = ${input.email}
        and deleted_at is null
        and converted_application_id is null
      order by created_at desc
      limit 1
    `
    if (openLead) {
      const leadId = openLead.id as string
      const rawToken = generateSessionToken()
      const tokenHash = hashToken(rawToken)
      const now = new Date()
      const expiresAt = new Date(now.getTime() + this.config.leadExpiryWindowMs)
      await this.sql`
        update application_lead
        set token_hash = ${tokenHash}, expires_at = ${expiresAt}, last_requested_at = ${now}
        where id = ${leadId}
      `
      // If a draft was already started, carry the fresh token onto it so the new
      // link resolves the in-progress draft (answers preserved) and the old dies.
      await this.sql`
        update application_draft set parent_token_hash = ${tokenHash} where lead_id = ${leadId}
      `
      const parentToken = input.fillerRole === 'parent' ? rawToken : null
      if (input.fillerRole === 'student') {
        const link = `${this.config.appUrl}/apply/parent/${rawToken}`
        try {
          await this.mailer.send({
            to: input.email,
            subject: 'Your CurioLab application link',
            text:
              'Here is a fresh link to continue the CurioLab application:\n\n' +
              `${link}\n\n` +
              'This link is personal to you - please do not share it. Any earlier link is now inactive.',
            html:
              '<p>Here is a fresh link to continue the CurioLab application:</p>' +
              `<p><a href="${link}">${link}</a></p>` +
              '<p>This link is personal to you - please do not share it. Any earlier link is now inactive.</p>',
          })
        } catch (err) {
          console.error(`[LeadService] resend Stage-2 link email failed for lead ${leadId}:`, err)
        }
      }
      return { leadId, suppressed: false, resent: true, parentToken }
    }

    // Resolve the optional 2C linkage: a chapter code that matches a chapter slug
    // gets the fk; "interested in another school" (no chapter row) stays null.
    const [mapped] = await this.sql`select id from chapter where slug = ${input.chapter} limit 1`
    const chapterId = (mapped?.id as string | undefined) ?? null

    // Issue the Stage-2 token now (design §7.1). Its hash is stored on the lead;
    // the raw token is captured so it can be surfaced to a PARENT-filler below. For
    // a student-filler the hash is still stored (the parent receives the raw token
    // by email later) but the raw token is NOT returned in the response.
    const rawToken = generateSessionToken()
    const tokenHash = hashToken(rawToken)

    // Set created_at and expires_at from one clock so the +30d invariant is exact.
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.config.leadExpiryWindowMs)

    const [row] = await this.sql`
      insert into application_lead
        (email, chapter, chapter_id, source, filler_role, status, token_hash, created_at, expires_at, last_requested_at)
      values
        (${input.email}, ${input.chapter}, ${chapterId}, ${source}, ${input.fillerRole},
         'new', ${tokenHash}, ${now}, ${expiresAt}, ${now})
      returning id
    `
    // Return the raw token ONLY to a parent-filler: the person who submits Stage 1
    // receives the response, so returning it to a parent lets them continue directly
    // into their 2A section, while a student-filler must not receive it (the parent
    // gets it by email) — preserving "the parent proceeds and submits." This is the
    // same safety line as the two-token 2A/2B split.
    const parentToken = input.fillerRole === 'parent' ? rawToken : null

    // Email 1 (BACKEND-owned): for a STUDENT-filler, the parent never receives the
    // Stage-2 token in the response, so email them the continue link built from the
    // RAW token (available here, before it was hashed above). For a parent-filler we
    // send NOTHING — the frontend owns that continue-link email (it has the token
    // from the response). Best-effort: the lead is already inserted, so a send
    // failure is logged and swallowed — we do NOT roll back the lead (a retry/resend
    // is a future concern).
    if (input.fillerRole === 'student') {
      const link = `${this.config.appUrl}/apply/parent/${rawToken}`
      try {
        await this.mailer.send({
          to: input.email,
          subject: 'Finish your child’s CurioLab application',
          text:
            'Your child started a CurioLab application and asked you to finish it.\n\n' +
            `Continue here to fill in your part and submit:\n${link}\n\n` +
            'This link is personal to you — please do not share it.',
          html:
            '<p>Your child started a CurioLab application and asked you to finish it.</p>' +
            `<p>Continue here to fill in your part and submit:<br><a href="${link}">${link}</a></p>` +
            '<p>This link is personal to you — please do not share it.</p>',
        })
      } catch (err) {
        console.error(`[LeadService] Stage-2 link email failed for lead ${row!.id as string}:`, err)
      }
    }

    return { leadId: row!.id as string, suppressed: false, resent: false, parentToken }
  }
}
