// -------------------------------------------------------------------------
// ConsentService — Milestone 1 step 5: DIGITAL consent capture after guardian
// verification (or by a self-managing 18+ student). This is the digital
// counterpart to the form-sourced Block A written by EnrollmentService
// (coupling D). It captures Block B (`platform_participation`) and Block C
// (`public_profile`, `photo_media`, `external_publication`) — which types are
// digitally grantable, and which need a scope_ref, is CONFIG-DRIVEN off the
// block composition (consent-blocks.ts; compliance-coppa.md Part 3).
//
// Every decision is gated through `authorize` under `consent.grant` /
// `consent.revoke` (03-authorization). Both are scope `['guardian','own']`:
//   - guardian path: the acting guardian's verified child, barred once the
//     child is 18 (the guardian scope requires subject age < 18);
//   - own path: a self-managing student, `ownCondition: age >= 18`.
//
// Consent is APPEND-ONLY (02-data-model): a grant is an insert; a revoke is a
// NEW `action='revoke'` insert, never an update. `consent_current` is maintained
// by the DB trigger in the same transaction.
//
// C1/C2 content cascades are DEFERRED. Revoking `photo_media` (C1: depicting
// media -> pending_review) and `external_publication` (C2: scoped project
// de-list) must carry their content consequence in the same transaction — but
// the project/media tables land in M2/M3, so there is nothing to cascade yet.
// The `onRevoke` seam below is where that cascade attaches; today it is a no-op.
// The revoke row and the consent_current flip work now.
//
// Framework-agnostic: the db handle, `authorize`, and config are injected; the
// HTTP routes (the guardian portal, step 7) are wired later.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, ConsentType, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { consentTypeRequiresScopeRef, isDigitallyGrantable } from './consent-blocks.js'
import {
  ConsentEnrollmentNotFoundError,
  ConsentNotDigitallyGrantableError,
  ConsentScopeRefRequiredError,
} from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's two
 * capabilities (structurally the runtime `authorize` wrapper; taken by injection
 * so the deny/backstop paths are testable without HTTP).
 */
export type ConsentAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'consent.grant' | 'consent.revoke' | 'consent.revoke_safeguarding',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

/**
 * The transactional seam for the C1/C2 content cascades (04-state-machines).
 * Called inside the revoke transaction, holding the `consent_current` row lock,
 * BEFORE the revoke row commits — the same transaction the content consequence
 * must ride. No-op by default because the project/media tables are later
 * milestones. M2/M3 supplies the real cascade here (photo_media -> media
 * re-review; external_publication -> project de-list).
 */
export type RevokeCascade = (
  tx: Sql | TransactionSql,
  args: { studentAccountId: string; type: ConsentType; scopeRef: string | null },
) => Promise<void>

const noopCascade: RevokeCascade = async () => {}

export interface ConsentServiceDeps {
  sql: Sql
  authorize: ConsentAuthorizeFn
  /** The C1/C2 content cascade seam; defaults to a no-op (deferred to M2/M3). */
  onRevoke?: RevokeCascade
}

export interface GrantConsentOptions {
  /**
   * The specific project/issue this consent scopes to. REQUIRED for
   * `external_publication` (per-item, never blanket); ignored for other types.
   */
  scopeRef?: string | null
}

export interface ConsentResult {
  consentId: string
  studentAccountId: string
  type: ConsentType
  action: 'grant' | 'revoke'
}

interface StudentAnchor {
  /** The student's age, derived from DOB, for the guardian-scope age bound. */
  age: number
  /** The most recent enrollment record — the temporal anchor for the row. */
  enrollmentRecordId: string
}

/** Whole years from `dob` to `at` (birthday-aware). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

export class ConsentService {
  private readonly sql: Sql
  private readonly authorize: ConsentAuthorizeFn
  private readonly onRevoke: RevokeCascade

  constructor(deps: ConsentServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.onRevoke = deps.onRevoke ?? noopCascade
  }

  /**
   * Resolve the student's age (from DOB) and their most recent enrollment record
   * — the resource fields `can` needs (subject age for the guardian bound) and
   * the temporal anchor the row carries.
   */
  private async loadAnchor(studentAccountId: string): Promise<StudentAnchor> {
    const [row] = await this.sql`
      select
        a.date_of_birth as dob,
        (
          select e.id from enrollment_record e
          where e.student_account_id = a.id
          order by e.created_at desc
          limit 1
        ) as enrollment_record_id
      from account a
      where a.id = ${studentAccountId}
    `
    if (row === undefined || row.enrollment_record_id == null) {
      throw new ConsentEnrollmentNotFoundError(studentAccountId)
    }
    return {
      age: ageInYears(new Date(row.dob as string), new Date()),
      enrollmentRecordId: row.enrollment_record_id as string,
    }
  }

  /**
   * The resource for a consent decision. It carries the student as BOTH the
   * guardian subject (with age, so the guardian path bars at 18) and the `own`
   * owner (so a self-managing 18+ student matches their own consent).
   */
  private buildResource(studentAccountId: string, anchor: StudentAnchor): Resource {
    return {
      subjectAccountId: studentAccountId,
      subjectAge: anchor.age,
      subjectIsMinor: anchor.age < 18,
      ownerAccountId: studentAccountId,
    }
  }

  /**
   * Digital consent grant (guardian portal / self-managing student). Gated
   * through `authorize` under `consent.grant`, then inserts an append-only
   * `action='grant'`, `source='digital'` row: `granted_by` = the acting account,
   * `effective_at = now()`, `enrollment_record_id` = the student's enrollment
   * anchor, `scope_ref` for `external_publication`. `consent_current` is updated
   * by the DB trigger.
   */
  async grantConsent(
    studentAccountId: string,
    type: ConsentType,
    ctx: AuthContext,
    options: GrantConsentOptions = {},
  ): Promise<ConsentResult> {
    // Config-driven block guards, before any IO or authorization:
    //   - Block A is form-sourced (coupling D), never a digital grant;
    //   - a scoped type must name its item.
    if (!isDigitallyGrantable(type)) {
      throw new ConsentNotDigitallyGrantableError(type)
    }
    const scopeRef = options.scopeRef ?? null
    if (consentTypeRequiresScopeRef(type) && scopeRef == null) {
      throw new ConsentScopeRefRequiredError(type)
    }

    const anchor = await this.loadAnchor(studentAccountId)
    const resource = this.buildResource(studentAccountId, anchor)

    // Authorize first (writes one permission.denied and throws Forbidden on
    // deny), BEFORE any mutation.
    await this.authorize(ctx, 'consent.grant', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [c] = await tx`
        insert into consent (
          student_account_id, type, action, source, source_ref,
          enrollment_record_id, scope_ref, granted_by, effective_at, reason
        ) values (
          ${studentAccountId}, ${type}, 'grant', 'digital', ${null},
          ${anchor.enrollmentRecordId}, ${scopeRef}, ${ctx.account.id}, now(), 'standard'
        ) returning id
      `
      return {
        consentId: c!.id as string,
        studentAccountId,
        type,
        action: 'grant' as const,
      }
    }) as Promise<ConsentResult>
  }

  /**
   * Digital consent revoke. Gated through `authorize` under `consent.revoke`,
   * then inserts an append-only `action='revoke'` row (NEVER an update). The
   * `consent_current` row is taken `FOR UPDATE` as the coupling serialization
   * point (04-state-machines C1/C2), the content cascade seam (`onRevoke`) runs
   * in the same transaction (a no-op until M2/M3), then the revoke row commits
   * and flips `consent_current` inactive via the trigger.
   *
   * A scoped revoke (`external_publication`) resolves its `scope_ref` from the
   * consent being revoked, so the row satisfies the per-item DB constraint and
   * the C2 cascade knows which item to de-list.
   */
  async revokeConsent(
    studentAccountId: string,
    type: ConsentType,
    ctx: AuthContext,
  ): Promise<ConsentResult> {
    const anchor = await this.loadAnchor(studentAccountId)
    const resource = this.buildResource(studentAccountId, anchor)

    await this.authorize(ctx, 'consent.revoke', resource, { sql: this.sql })

    const onRevoke = this.onRevoke
    return this.sql.begin(async (tx) => {
      assertAuthorized()

      // Serialization point for the C1/C2 couplings: lock the current row so a
      // concurrent content insert cannot slip between this read and its effect.
      const [cur] = await tx`
        select scope_ref from consent_current
        where student_account_id = ${studentAccountId} and type = ${type}
        for update
      `
      // A scoped revoke carries the scope_ref of the consent it revokes.
      const scopeRef = consentTypeRequiresScopeRef(type)
        ? ((cur?.scope_ref as string | null | undefined) ?? null)
        : null

      // The content consequence rides the same transaction (deferred: no-op).
      await onRevoke(tx, { studentAccountId, type, scopeRef })

      const [c] = await tx`
        insert into consent (
          student_account_id, type, action, source, source_ref,
          enrollment_record_id, scope_ref, granted_by, effective_at, reason
        ) values (
          ${studentAccountId}, ${type}, 'revoke', 'digital', ${null},
          ${anchor.enrollmentRecordId}, ${scopeRef}, ${ctx.account.id}, now(), 'standard'
        ) returning id
      `
      return {
        consentId: c!.id as string,
        studentAccountId,
        type,
        action: 'revoke' as const,
      }
    }) as Promise<ConsentResult>
  }

  /**
   * Resolve the student's enrolling chapter (their most recent enrollment
   * record). `consent.revoke_safeguarding` is CHAPTER-scoped — unlike the ordinary
   * guardian/self grant/revoke — so `can` needs the chapter to match the acting
   * director's membership.
   */
  private async loadChapter(studentAccountId: string): Promise<string> {
    const [row] = await this.sql`
      select e.chapter_id as chapter_id from enrollment_record e
      where e.student_account_id = ${studentAccountId}
      order by e.created_at desc
      limit 1
    `
    if (row === undefined || row.chapter_id == null) {
      throw new ConsentEnrollmentNotFoundError(studentAccountId)
    }
    return row.chapter_id as string
  }

  /**
   * Safeguarding suspend (04-state-machines consent "safeguarding suspend |
   * consent.revoke_safeguarding | chapter_director, admin"). The ONE sanctioned
   * STAFF write to consent: gated through `authorize` under
   * `consent.revoke_safeguarding` (CHAPTER-scoped, Chapter Director; admin via the
   * platform override) — it does NOT ride the guardian/self scope, so a guardian
   * cannot invoke it.
   *
   * Inserts append-only `reason = 'safeguarding'` revoke rows for BOTH
   * `public_profile` and `photo_media` in ONE transaction, each firing the shared
   * `onRevoke` cascade under the `consent_current` FOR UPDATE lock — so C1
   * (photo_media -> depicting media re-review) commits together with the revoke.
   * The suspension STANDS until a new guardian decides.
   */
  async revokeSafeguarding(
    studentAccountId: string,
    ctx: AuthContext,
  ): Promise<ConsentResult[]> {
    const anchor = await this.loadAnchor(studentAccountId)
    const chapterId = await this.loadChapter(studentAccountId)

    // The resource is CHAPTER-scoped (unlike grant/revoke's guardian/own resource).
    const resource: Resource = {
      subjectAccountId: studentAccountId,
      subjectAge: anchor.age,
      subjectIsMinor: anchor.age < 18,
      chapter_id: chapterId,
    }
    await this.authorize(ctx, 'consent.revoke_safeguarding', resource, { sql: this.sql })

    const onRevoke = this.onRevoke
    // The two Block-C types a safeguarding suspend covers (compliance-coppa.md;
    // 04-state-machines). `public_profile` has no content cascade; `photo_media`
    // fires C1 through the shared seam.
    const types: ConsentType[] = ['public_profile', 'photo_media']

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const results: ConsentResult[] = []
      for (const type of types) {
        // Serialization point for C1: lock the current row so a concurrent media
        // insert cannot slip between the read and its effect.
        await tx`
          select scope_ref from consent_current
          where student_account_id = ${studentAccountId} and type = ${type}
          for update
        `
        // Neither public_profile nor photo_media is a scoped type — scope_ref null.
        await onRevoke(tx, { studentAccountId, type, scopeRef: null })

        const [c] = await tx`
          insert into consent (
            student_account_id, type, action, source, source_ref,
            enrollment_record_id, scope_ref, granted_by, effective_at, reason
          ) values (
            ${studentAccountId}, ${type}, 'revoke', 'digital', ${null},
            ${anchor.enrollmentRecordId}, ${null}, ${ctx.account.id}, now(), 'safeguarding'
          ) returning id
        `
        results.push({
          consentId: c!.id as string,
          studentAccountId,
          type,
          action: 'revoke' as const,
        })
      }
      return results
    }) as Promise<ConsentResult[]>
  }
}
