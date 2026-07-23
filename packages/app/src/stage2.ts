// -------------------------------------------------------------------------
// Stage2Service — the three-phase Stage 2 of the application funnel
// (application-funnel Stage-1 design §7.2/§8). One `application_draft` bound to a
// lead advances through three phases against TWO tokens:
//
//   2A  parent section   — saveParentSection: the parent fills the child facts
//                          (name, grade, school) and guardian details. Identifying
//                          child facts are fine HERE: the PARENT provides them.
//                          Advances to 2b. The student link is NOT minted here:
//                          createStudentLink is a separate explicit parent action
//                          (re-callable, superseding the prior link) once in 2b.
//   2B  student section   — saveStudentSection: the student answers their own,
//                          NON-IDENTIFYING section. An allowlist (config.ts)
//                          rejects any name/email/school-like key LOUDLY. No
//                          student email is ever collected. This SAVES and
//                          notifies the parent; it does NOT submit and creates NO
//                          application. Advances to 2c.
//   2C  parent review     — reviewStage2 (read-only 2A+2B), sendBack (2c -> 2b for
//                          the student to revise; the parent cannot edit the
//                          student's answers), and submitStage2 (parent token ONLY)
//                          — the ONE place the `application` row is minted, from
//                          the 2A facts + the 2B student section. Submit also sets
//                          the lead's `converted_at` + `converted_application_id`.
//
// The Stage-2 PARENT token ORIGINATES from the lead's `token_hash`, issued at
// createLead (design §7.1). startStage2 validates/consumes that lead token and
// creates the draft — it does NOT mint a fresh parent token. A SEPARATE student
// token gates 2B (the two-token model is retained deliberately: a single shared
// token would let the student's 2B link open the parent's 2A/2C sections).
//
// Every op is UNAUTHENTICATED and token-gated — like the invite accept endpoints,
// gated by the opaque parent/student token alone (only the SHA-256 hash stored,
// timing-safe compare). Mail delivery is deferred: the tokens are the mailer seam.
// -------------------------------------------------------------------------

import { timingSafeEqual } from 'node:crypto'
import type { Sql, JSONValue } from 'postgres'
import { generateSessionToken, hashToken } from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import {
  InvalidStage2TokenError,
  Stage2AlreadyStartedError,
  Stage2LeadChapterRequiredError,
  Stage2LeadExpiredError,
  Stage2NotInPhaseError,
  Stage2ParentFactsIncompleteError,
  StudentSectionFieldNotAllowedError,
  StudentSectionIdentifyingFieldError,
} from './errors.js'

export interface Stage2ServiceDeps {
  sql: Sql
  /** Optional overrides for the config-not-code tunables (the 2B allowlist). */
  config?: Partial<AppConfig>
}

/** A free-form answers blob (parent-provided 2A facts, or student 2B answers). */
export type Answers = Record<string, unknown>

export interface StartStage2Result {
  draftId: string
  leadId: string
}

export interface CreateStudentLinkResult {
  /**
   * The opaque student token, minted fresh on each call. Returned raw ONCE — this
   * is the seam the frontend/mailer uses to show or send the 2B link to the child.
   * A later call regenerates it, superseding (and so invalidating) this one.
   */
  studentToken: string
}

export interface ReviewStage2Result {
  phase: string
  status: string
  /** The 2A parent-provided facts, read-only. */
  parentAnswers: Answers | null
  /** The 2B student answers, read-only (the parent cannot edit them). */
  studentAnswers: Answers | null
}

export interface SubmitStage2Result {
  applicationId: string
  leadId: string
}

/** The columns a token lookup needs; the draft joined to its lead. */
interface DraftRow {
  id: string
  lead_id: string
  parent_token_hash: string
  student_token_hash: string | null
  phase: string
  status: string
  parent_answers: Answers | null
  student_answers: Answers | null
  lead_chapter_id: string | null
  lead_status: string
  lead_expires_at: Date
}

/** True when the lead's 30-day window has closed as of `now` (request time). */
function leadExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime()
}

export class Stage2Service {
  private readonly sql: Sql
  private readonly config: AppConfig

  constructor(deps: Stage2ServiceDeps) {
    this.sql = deps.sql
    this.config = { ...defaultConfig, ...deps.config }
  }

  // ---- start (parent token issued at createLead, UNAUTHENTICATED) ----------
  /**
   * Validate/CONSUME the lead's Stage-2 token (issued at createLead) and create
   * the `application_draft` (phase `2a`, status `in_progress`) bound to that lead,
   * advancing the lead `new -> stage2_started`, all atomically. The parent token
   * is NOT re-minted here: the draft's `parent_token_hash` is the lead's own
   * `token_hash`, so the token the parent already holds carries straight into 2A.
   * A token that resolves no lead is an opaque InvalidStage2TokenError; a lead
   * that is not `new` (already started / converted) is Stage2AlreadyStartedError.
   */
  async startStage2(parentToken: string): Promise<StartStage2Result> {
    const parentHash = hashToken(parentToken)
    const [lead] = await this.sql`
      select id, status, token_hash, expires_at from application_lead where token_hash = ${parentHash}
    `
    // Reveal nothing: an unknown token and a hash mismatch look identical.
    if (lead === undefined || !hashesEqual(lead.token_hash as string, parentHash)) {
      throw new InvalidStage2TokenError()
    }
    const leadId = lead.id as string
    // The 30-day window is evaluated at REQUEST time (design §8): a lapsed lead
    // is rejected even though its token still resolves.
    if (leadExpired(lead.expires_at as Date, new Date())) throw new Stage2LeadExpiredError(leadId)
    if (lead.status !== 'new') throw new Stage2AlreadyStartedError(leadId)

    const draftId = await this.sql.begin(async (tx) => {
      // Advance the lead only if still `new` (guards a concurrent double-start).
      const advanced = await tx`
        update application_lead set status = 'stage2_started'
        where id = ${leadId} and status = 'new'
        returning id
      `
      if (advanced.length === 0) throw new Stage2AlreadyStartedError(leadId)
      const [row] = await tx`
        insert into application_draft (lead_id, parent_token_hash, phase, status)
        values (${leadId}, ${parentHash}, '2a', 'in_progress')
        returning id
      `
      return row!.id as string
    })

    return { draftId, leadId }
  }

  // ---- 2A save (parent token, UNAUTHENTICATED) -----------------------------
  /**
   * Save the parent-provided 2A facts (merged, so partial saves persist) and advance
   * the draft to `2b`. This NO LONGER mints the student token: creating the link to
   * the child is a SEPARATE, explicit parent action (`createStudentLink`), so the
   * parent chooses when to generate and send it. The save returns nothing.
   */
  async saveParentSection(parentToken: string, answers: Answers): Promise<void> {
    const draft = await this.loadDraftByParentToken(parentToken)
    this.assertPhase(draft, ['2a', '2b'])

    await this.sql`
      update application_draft set
        parent_answers = coalesce(parent_answers, '{}'::jsonb) || ${this.sql.json(answers as unknown as JSONValue)},
        phase = '2b'
      where id = ${draft.id}
    `
  }

  // ---- create/re-create the student link (parent token, UNAUTHENTICATED) ---
  /**
   * Mint a fresh student token for 2B and store its hash on the draft, returning the
   * raw token ONCE (the seam the frontend/mailer uses to show or send the link to
   * the child). Available once the draft has reached `2b` — i.e. after the parent
   * saved their 2A section. Each call regenerates the token, superseding any prior
   * hash, so re-creating the link INVALIDATES the previous one (the old token stops
   * resolving) and only the newest link opens 2B.
   */
  async createStudentLink(parentToken: string): Promise<CreateStudentLinkResult> {
    const draft = await this.loadDraftByParentToken(parentToken)
    this.assertPhase(draft, ['2b'])

    const studentToken = generateSessionToken()
    const studentHash = hashToken(studentToken)
    await this.sql`
      update application_draft set student_token_hash = ${studentHash} where id = ${draft.id}
    `
    return { studentToken }
  }

  // ---- 2B save (student token, UNAUTHENTICATED) ----------------------------
  /**
   * Save the student's own 2B answers under the NON-IDENTIFYING ALLOWLIST: any key
   * that is not allowlisted, or that looks identifying (name/email/school/…), is
   * REJECTED — not silently stripped — so a tampered form fails loudly. Sets status
   * `2b_saved` and advances to `2c` (parent review). This SAVES and notifies the
   * parent; it does NOT submit and creates NO `application`.
   */
  async saveStudentSection(studentToken: string, answers: Answers): Promise<void> {
    const draft = await this.loadDraftByStudentToken(studentToken)
    this.assertPhase(draft, ['2b'])
    this.assertNonIdentifying(answers)

    await this.sql`
      update application_draft set
        student_answers = coalesce(student_answers, '{}'::jsonb) || ${this.sql.json(answers as unknown as JSONValue)},
        status = '2b_saved',
        phase = '2c'
      where id = ${draft.id}
    `
    // NOTIFY THE PARENT (deferred): the student section is saved and ready for the
    // parent to review at 2C. The real mailer is the future seam; there is no token
    // to hand back here (both parties already hold theirs).
  }

  // ---- 2C review (parent token, UNAUTHENTICATED) ---------------------------
  /**
   * The 2C read-only view for the parent: the 2A parent facts and the 2B student
   * answers, returned together so the parent can review before submitting. Purely a
   * read — it never mutates the draft and offers no edit of the student's answers.
   */
  async reviewStage2(parentToken: string): Promise<ReviewStage2Result> {
    const draft = await this.loadDraftByParentToken(parentToken)
    this.assertPhase(draft, ['2c'])
    return {
      phase: draft.phase,
      status: draft.status,
      parentAnswers: draft.parent_answers,
      studentAnswers: draft.student_answers,
    }
  }

  // ---- 2C submit (parent token ONLY, UNAUTHENTICATED) ----------------------
  /**
   * The ONE submit path and the ONLY place an `application` is minted. Parent token
   * only — a student token fails to resolve a parent-gated draft and is rejected,
   * which is what makes "only the parent submits" hold. Creates the `application`
   * (kind `student`) from the 2A facts (child name/guardian details -> the typed
   * applicant/guardian columns) plus the 2B `student_answers` (stored on
   * `student_section jsonb`), converts the lead, and submits the draft — atomically.
   */
  async submitStage2(parentToken: string): Promise<SubmitStage2Result> {
    const draft = await this.loadDraftByParentToken(parentToken)
    this.assertPhase(draft, ['2c'])

    const chapterId = draft.lead_chapter_id
    if (chapterId === null) throw new Stage2LeadChapterRequiredError(draft.lead_id)

    const parent = draft.parent_answers ?? {}
    const childName = strOrNull(parent.childName)
    const guardianName = strOrNull(parent.guardianName)
    const guardianEmail = strOrNull(parent.guardianEmail)
    const missing: string[] = []
    if (childName === null) missing.push('childName')
    if (guardianName === null) missing.push('guardianName')
    if (guardianEmail === null) missing.push('guardianEmail')
    if (missing.length > 0) throw new Stage2ParentFactsIncompleteError(missing)

    const studentSection = draft.student_answers ?? {}

    const applicationId = await this.sql.begin(async (tx) => {
      const [app] = await tx`
        insert into application (
          kind, chapter_id, status, applicant_name, applicant_contact_email,
          guardian_name, guardian_email, student_section
        ) values (
          'student', ${chapterId}, 'submitted', ${childName}, ${guardianEmail},
          ${guardianName}, ${guardianEmail}, ${tx.json(studentSection as unknown as JSONValue)}
        ) returning id
      `
      const appId = app!.id as string
      await tx`
        update application_lead
        set status = 'converted', converted_application_id = ${appId}, converted_at = now()
        where id = ${draft.lead_id}
      `
      await tx`
        update application_draft set
          status = 'submitted', phase = 'submitted',
          converted_application_id = ${appId}, submitted_at = now()
        where id = ${draft.id}
      `
      return appId
    })

    return { applicationId, leadId: draft.lead_id }
  }

  // ---- 2C send-back (parent token, UNAUTHENTICATED) ------------------------
  /**
   * Return the draft from 2C to 2B so the student can revise: status `sent_back`,
   * phase `2b`. The parent CANNOT edit the student's answers — send-back is the
   * only lever, and only the student (via the student token) writes 2B.
   */
  async sendBack(parentToken: string): Promise<void> {
    const draft = await this.loadDraftByParentToken(parentToken)
    this.assertPhase(draft, ['2c'])
    await this.sql`
      update application_draft set status = 'sent_back', phase = '2b' where id = ${draft.id}
    `
  }

  // ---- internals -----------------------------------------------------------

  /** Timing-safe load of the draft whose PARENT token hash matches. */
  private loadDraftByParentToken(token: string): Promise<DraftRow> {
    return this.loadDraftByToken(token, 'parent_token_hash')
  }

  /** Timing-safe load of the draft whose STUDENT token hash matches. */
  private loadDraftByStudentToken(token: string): Promise<DraftRow> {
    return this.loadDraftByToken(token, 'student_token_hash')
  }

  private async loadDraftByToken(
    token: string,
    column: 'parent_token_hash' | 'student_token_hash',
  ): Promise<DraftRow> {
    const tokenHash = hashToken(token)
    const [row] = await this.sql`
      select d.id, d.lead_id, d.parent_token_hash, d.student_token_hash, d.phase,
             d.status, d.parent_answers, d.student_answers,
             l.chapter_id as lead_chapter_id, l.status as lead_status,
             l.expires_at as lead_expires_at
      from application_draft d
      join application_lead l on l.id = d.lead_id
      where ${this.sql(column)} = ${tokenHash}
    `
    if (row === undefined) throw new InvalidStage2TokenError()
    const stored = (column === 'parent_token_hash' ? row.parent_token_hash : row.student_token_hash) as
      | string
      | null
    // Defensive constant-time compare of the stored hash against the computed one.
    if (stored === null || !hashesEqual(stored, tokenHash)) throw new InvalidStage2TokenError()
    const draft = row as unknown as DraftRow
    // Every token-gated Stage 2 op re-checks the bound lead's 30-day window at
    // REQUEST time (design §8): a lapsed lead is rejected across 2A/2B/2C, not
    // only at start.
    if (leadExpired(draft.lead_expires_at, new Date())) throw new Stage2LeadExpiredError(draft.lead_id)
    return draft
  }

  /** Assert the draft is in one of the phases the requested op permits. */
  private assertPhase(draft: DraftRow, expected: readonly string[]): void {
    if (!expected.includes(draft.phase)) {
      throw new Stage2NotInPhaseError(expected, draft.phase)
    }
  }

  /**
   * Enforce the 2B non-identifying allowlist. Rejects loudly: an identifying-looking
   * key raises StudentSectionIdentifyingFieldError (the specific signal), any other
   * off-allowlist key raises StudentSectionFieldNotAllowedError.
   */
  private assertNonIdentifying(answers: Answers): void {
    for (const key of Object.keys(answers)) {
      if (this.config.stage2IdentifyingKeyPattern.test(key)) {
        throw new StudentSectionIdentifyingFieldError(key)
      }
      if (!this.config.stage2StudentAllowedFields.includes(key)) {
        throw new StudentSectionFieldNotAllowedError(key)
      }
    }
  }
}

/** A trimmed non-empty string, or null (missing / wrong type / blank). */
function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** Constant-time equality for two equal-length hex digest strings. */
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
