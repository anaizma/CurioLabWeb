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

export interface LeadServiceDeps {
  sql: Sql
  /** Optional overrides for the config-not-code tunables (dedupe/expiry windows). */
  config?: Partial<AppConfig>
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
   * The unauthenticated, INERT Stage 1 write. Dedupes on `email` within the
   * configured window; on a fresh lead it issues a hashed Stage-2 token, resolves
   * the optional `chapter_id` fk when the chapter code maps to a real chapter,
   * stamps `expires_at = created_at + 30d`, inserts one `application_lead` in
   * status `new`, and returns `{ leadId, suppressed }`. Creates NO account and NO
   * application. Safe to call with no AuthContext.
   */
  async createLead(input: CreateLeadInput): Promise<CreateLeadResult> {
    const source = input.source ?? null

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

    // Resolve the optional 2C linkage: a chapter code that matches a chapter slug
    // gets the fk; "interested in another school" (no chapter row) stays null.
    const [mapped] = await this.sql`select id from chapter where slug = ${input.chapter} limit 1`
    const chapterId = (mapped?.id as string | undefined) ?? null

    // Issue the Stage-2 token now (design §7.1). Only its hash is stored; the raw
    // token is the Phase-2 mailer's seam and is not surfaced by this inert write.
    const tokenHash = hashToken(generateSessionToken())

    // Set created_at and expires_at from one clock so the +30d invariant is exact.
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.config.leadExpiryWindowMs)

    const [row] = await this.sql`
      insert into application_lead
        (email, chapter, chapter_id, source, filler_role, status, token_hash, created_at, expires_at)
      values
        (${input.email}, ${input.chapter}, ${chapterId}, ${source}, ${input.fillerRole},
         'new', ${tokenHash}, ${now}, ${expiresAt})
      returning id
    `
    return { leadId: row!.id as string, suppressed: false }
  }
}
