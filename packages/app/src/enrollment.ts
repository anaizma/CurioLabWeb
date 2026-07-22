// -------------------------------------------------------------------------
// EnrollmentService — Flow A step 2, coupling D (04-state-machines; 06-onboarding
// -flows). On `accepted -> enrolled` the Chapter Director records the signed
// enrollment form, the enrollment record, and the two form-sourced consent rows
// (`enrollment`, `data_collection`) in ONE transaction, so an operational record
// never exists before its consent row.
//
// The consents are written `granted_by = null` (backfilled at guardian
// verification) with `source = 'signed_form'`, `source_ref` = the stored form,
// `enrollment_record_id` set (the temporal anchor), and `effective_at` = the
// signature date on the form. The database's temporal trigger floors that date
// at the application submission (not the enrollment record's own creation), so a
// signature that legitimately precedes the scan upload is accepted.
//
// Framework-agnostic: the db handle, the `authorize` wrapper, and the storage
// backend are all injected. The HTTP route (POST /ops/enrollments) is wired
// later.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import { randomUUID } from 'node:crypto'
import { type AppConfig, defaultConfig, type FormSourcedConsentType } from './config.js'
import { EnrollmentDobRequiredError } from './errors.js'
import type { StorageAdapter } from './storage.js'

/**
 * The injected `authorize` dependency, narrowed to this service's one
 * capability. Structurally the runtime `authorize` wrapper (taken by injection
 * so the deny/backstop paths are testable without HTTP).
 */
export type EnrollmentAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'enrollment.create',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface EnrollmentServiceDeps {
  sql: Sql
  authorize: EnrollmentAuthorizeFn
  storage: StorageAdapter
  /** Optional overrides for the config-not-code tunables. */
  config?: Partial<AppConfig>
}

export interface SignedForm {
  body: Uint8Array | Buffer | string
  contentType?: string
  /** Optional storage key override; a key is synthesized when absent. */
  key?: string
}

export interface CreateEnrollmentInput {
  /** The accepted application this enrollment realizes. */
  applicationId: string
  /**
   * RETURNING case: the existing student account. When present, the enrollment
   * carries no DOB copy and the two form-sourced consents commit here (coupling
   * D). Absent/null is the SEEDING case: a brand-new student whose account does
   * not exist yet.
   */
  studentAccountId?: string | null
  /**
   * SEEDING case: the DOB from the signed form (ISO `YYYY-MM-DD`), required when
   * there is no student account yet. It lives on the enrollment record until the
   * account is created at accept-student. Ignored in the RETURNING case (the
   * account already holds the canonical DOB).
   */
  dateOfBirth?: string
  chapterId: string
  termId: string
  guardianNameOnForm: string
  /** The signature date on the form; becomes each consent's effective_at. */
  signatureDate: Date
  signedForm: SignedForm
}

export interface CreateEnrollmentResult {
  enrollmentRecordId: string
  /** The stored signed-form ref (uuid), shared by the record and the consents. */
  signedFormRef: string
  /**
   * The form-sourced consent ids written in this transaction. Populated in the
   * RETURNING case; EMPTY in the SEEDING case, because consent.student_account_id
   * is NOT NULL and the account does not exist yet — those consents follow once
   * it does (they cannot be pre-written or backfilled, consent being append-only).
   */
  consentIds: Partial<Record<FormSourcedConsentType, string>>
}

export class EnrollmentService {
  private readonly sql: Sql
  private readonly authorize: EnrollmentAuthorizeFn
  private readonly storage: StorageAdapter
  private readonly config: AppConfig

  constructor(deps: EnrollmentServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.storage = deps.storage
    this.config = { ...defaultConfig, ...deps.config }
  }

  /**
   * POST /ops/enrollments — coupling D. Gated through `authorize` under
   * `enrollment.create` (chapter-scoped, Chapter Director). In one transaction:
   * store the signed form, insert the enrollment record, insert the two
   * form-sourced consents. All-or-nothing: if any step fails nothing persists,
   * and an already-uploaded form is compensated so no orphan dangles.
   */
  async createEnrollment(
    input: CreateEnrollmentInput,
    ctx: AuthContext,
  ): Promise<CreateEnrollmentResult> {
    // SEEDING (no account yet) vs RETURNING (account present). The DOB copy and
    // the form-sourced consents both hinge on this.
    const studentAccountId = input.studentAccountId ?? null
    const seeding = studentAccountId === null

    // A seeding enrollment must carry the form's DOB (the database CHECK enforces
    // the same). Fail before the storage upload so nothing is orphaned.
    if (seeding && (input.dateOfBirth == null || input.dateOfBirth === '')) {
      throw new EnrollmentDobRequiredError()
    }

    // Authorization first (writes one permission.denied and throws Forbidden on
    // deny). The application id is the resource; its chapter is the scope.
    const resource: Resource = { id: input.applicationId, chapter_id: input.chapterId }
    await this.authorize(ctx, 'enrollment.create', resource, { sql: this.sql })

    const key =
      input.signedForm.key ??
      `${this.config.signedFormKeyPrefix}/${input.applicationId}/${randomUUID()}`

    let storedRef: string | undefined
    try {
      return await this.sql.begin(async (tx) => {
        assertAuthorized() // runtime backstop: no mutation without a recorded decision

        // Step 1: store the signed form, capturing the ref.
        storedRef = await this.storage.putObject({
          key,
          body: input.signedForm.body,
          contentType: input.signedForm.contentType ?? this.config.signedFormContentType,
        })

        // Step 2: the enrollment record, linked to the accepted application. The
        // SEEDING case carries the form DOB with a null account; the RETURNING
        // case sets the account and leaves the DOB null (no second copy).
        const [enr] = await tx`
          insert into enrollment_record (
            application_id, student_account_id, chapter_id, term_id,
            signed_form_ref, guardian_name_on_form, date_of_birth, created_by
          ) values (
            ${input.applicationId}, ${studentAccountId}, ${input.chapterId}, ${input.termId},
            ${storedRef}, ${input.guardianNameOnForm}, ${seeding ? input.dateOfBirth! : null}, ${ctx.account.id}
          ) returning id
        `
        const enrollmentRecordId = enr!.id as string

        // Step 3: the two form-sourced consents (granted_by backfilled later).
        // Only in the RETURNING case: consent.student_account_id is NOT NULL, so
        // with no account yet (seeding) there is nothing to key them on, and they
        // cannot be pre-written or backfilled (consent is append-only). They are
        // captured once the account exists.
        const consentIds: Partial<Record<FormSourcedConsentType, string>> = {}
        if (!seeding) {
          for (const type of this.config.formSourcedConsentTypes) {
            const [c] = await tx`
              insert into consent (
                student_account_id, type, action, source, source_ref,
                enrollment_record_id, granted_by, effective_at, reason
              ) values (
                ${studentAccountId}, ${type}, 'grant', 'signed_form', ${storedRef},
                ${enrollmentRecordId}, ${null}, ${input.signatureDate}, ${this.config.formSourcedConsentReason}
              ) returning id
            `
            consentIds[type] = c!.id as string
          }
        }

        return { enrollmentRecordId, signedFormRef: storedRef, consentIds }
      })
    } catch (err) {
      // The DB transaction rolled back; compensate the (now orphaned) upload so
      // coupling D leaves nothing dangling. Best-effort: a backend without
      // delete relies on a storage lifecycle rule instead.
      if (storedRef !== undefined && this.storage.deleteObject) {
        try {
          await this.storage.deleteObject(storedRef)
        } catch {
          /* swallow: compensation is best-effort, the original error wins */
        }
      }
      throw err
    }
  }
}
