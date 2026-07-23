// -------------------------------------------------------------------------
// LeadService — Stage 1 of the application funnel (milestone-1-application-
// funnel.md v2, invariant 1; compliance-coppa.md "Stage 1: lead capture").
//
// The public, unauthenticated, INERT write. It creates exactly one
// `application_lead` in status `new` carrying ONLY a parent email, a chapter,
// and a referral source — no account, no `application`, no child data. Because
// it holds only a parent email collected to seek consent, an unconverted lead
// is deleted 30 days later by the retention sweep (retention-sweep.ts).
//
// Safe to call with NO AuthContext: it is one of the enumerated actor-less inert
// endpoints (05-api-surface) and creates only a row that carries no authority.
// Deduped on `email` within a configurable window (config.ts). Rate limiting,
// per-IP/per-email throttling, and the bot check are HTTP-layer concerns and are
// intentionally NOT handled here (see config.ts) — deferred to the HTTP layer.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { type AppConfig, defaultConfig } from './config.js'

export interface LeadServiceDeps {
  sql: Sql
  /** Optional overrides for the config-not-code tunables (the dedupe window). */
  config?: Partial<AppConfig>
}

export interface SubmitLeadInput {
  /** The parent's email — the only contact datum Stage 1 collects. */
  email: string
  /** The chapter the parent is enquiring about, if any. */
  chapterId?: string | null
  /** Where the parent heard about CurioLab (free text). */
  referralSource: string
}

export interface SubmitLeadResult {
  leadId: string
  /** True when an in-window duplicate suppressed the write; no new row created. */
  suppressed: boolean
}

export class LeadService {
  private readonly sql: Sql
  private readonly config: AppConfig

  constructor(deps: LeadServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
  }

  /**
   * POST /public/leads — the unauthenticated, INERT Stage 1 write. Creates
   * exactly one `application_lead` in status `new` (email, chapter, referral),
   * with duplicate suppression on `email` within the configured window. Creates
   * NO account and NO application. Safe to call with no AuthContext.
   */
  async submitLead(input: SubmitLeadInput): Promise<SubmitLeadResult> {
    const chapterId = input.chapterId ?? null

    // Duplicate suppression: the same email (citext, case-insensitive) captured
    // within the window. A soft-deleted lead (deleted_at set) is not a match, so
    // a re-enquiry after deletion starts a fresh lead.
    const cutoff = new Date(Date.now() - this.config.leadDedupeWindowMs)
    const existing = await this.sql`
      select id from application_lead
      where email = ${input.email}
        and deleted_at is null
        and created_at >= ${cutoff}
      order by created_at desc
      limit 1
    `
    if (existing.length > 0) {
      return { leadId: existing[0]!.id as string, suppressed: true }
    }

    const [row] = await this.sql`
      insert into application_lead (email, chapter_id, referral_source, status)
      values (${input.email}, ${chapterId}, ${input.referralSource}, 'new')
      returning id
    `
    return { leadId: row!.id as string, suppressed: false }
  }
}
