import { randomUUID } from 'node:crypto'
import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { CATALOG, getCatalogForm, toClientSchema } from './consent-forms/catalog.js'
import type { FormListEntry, FormSubmitPayload, FormStatus } from './consent-forms/types.js'
import { ConsentGrantService, type GrantResult } from './consent-grant.js'
import { STRONG_GRANT_METHODS, type ConsentGrantMethod, type ConsentGrantType } from './config.js'
import type { AppConfig } from './config.js'
import {
  FormNotFoundError, FormItemRequiredError, FormFieldRequiredError,
  FormPdfHashMismatchError, FormElevatedVerificationRequiredError,
} from './errors.js'

export interface ConsentFormServiceDeps {
  sql: Sql
  authorize: (ctx: AuthContext, cap: 'guardian.view_grants' | 'consent.grant', resource: Resource, deps: { sql: Sql }) => Promise<unknown>
  config?: Partial<AppConfig>
}

export class ConsentFormService {
  private readonly sql: Sql
  private readonly authorize: ConsentFormServiceDeps['authorize']
  // `config` (deps.config) is accepted for parity with the sibling services but
  // not yet consumed by the read/draft methods — submitCompletion (a later task)
  // is what wires it in. Kept off the instance until then to satisfy noUnusedLocals.
  constructor(deps: ConsentFormServiceDeps) {
    this.sql = deps.sql; this.authorize = deps.authorize
  }

  private async childResource(childId: string): Promise<Resource> {
    const [row] = await this.sql`select date_of_birth as dob from account where id = ${childId}`
    // Birthday-accurate age (UTC), matching ConsentGrantService.ageInYears — a
    // 365.25-day approximation disagreed by up to a day near the 18th birthday,
    // which could authorize an 18-year-old as a minor here and then have
    // captureGrant deny post-commit. A missing row leaves the far-future default,
    // which authorize rejects out_of_scope (a non-owned/unknown child).
    const now = new Date()
    const dob = row ? new Date(row.dob as string) : now
    let age = now.getUTCFullYear() - dob.getUTCFullYear()
    const m = now.getUTCMonth() - dob.getUTCMonth()
    if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1
    return { subjectAccountId: childId, subjectAge: age, subjectIsMinor: age < 18, ownerAccountId: childId }
  }

  /** The autofill store is per-guardian; child-scoped fields must NOT persist there
   *  (else one child's name/DOB is suggested on a sibling's legal form). */
  private static readonly CHILD_SCOPED_FIELDS: ReadonlySet<string> = new Set(['child_name', 'child_dob'])

  /** Decode + validate a required drawn/reused signature data URL. Bounds the size
   *  so an oversized body cannot be stored as a bytea. */
  private decodeSignature(signature: string | undefined): Buffer {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(signature ?? '')
    if (!m || m[1]!.length > 1_400_000) throw new FormFieldRequiredError('signature')
    return Buffer.from(m[1]!, 'base64')
  }

  async listForms(childId: string, ctx: AuthContext): Promise<FormListEntry[]> {
    await this.authorize(ctx, 'guardian.view_grants', await this.childResource(childId), { sql: this.sql })
    const completions = await this.sql<{ form_id: string }[]>`
      select distinct form_id from consent_form_completion
      where signer_account_id = ${ctx.account.id} and subject_student_account_id = ${childId}`
    const drafts = await this.sql<{ form_id: string }[]>`
      select form_id from consent_form_draft
      where guardian_account_id = ${ctx.account.id} and subject_student_account_id = ${childId}`
    const done = new Set(completions.map((r) => r.form_id))
    const started = new Set(drafts.map((r) => r.form_id))
    return CATALOG.map((f) => {
      const status: FormStatus = done.has(f.formId) ? 'complete' : started.has(f.formId) ? 'in_progress' : 'not_started'
      return { schema: toClientSchema(f), status }
    })
  }

  async getSavedFields(ctx: AuthContext): Promise<{ fields: Record<string, string>; signature: string | null }> {
    const rows = await this.sql<{ field_type: string; value_text: string | null; value_blob: Buffer | null }[]>`
      select field_type, value_text, value_blob from guardian_saved_field
      where guardian_account_id = ${ctx.account.id}`
    const fields: Record<string, string> = {}
    let signature: string | null = null
    for (const r of rows) {
      if (r.field_type === 'signature') { signature = r.value_blob ? `data:image/png;base64,${r.value_blob.toString('base64')}` : null }
      else if (r.value_text != null) fields[r.field_type] = r.value_text
    }
    return { fields, signature }
  }

  async getDraft(childId: string, formId: string, ctx: AuthContext): Promise<FormSubmitPayload | null> {
    const [row] = await this.sql`
      select item_states, field_values, signature from consent_form_draft
      where guardian_account_id = ${ctx.account.id} and subject_student_account_id = ${childId} and form_id = ${formId}`
    if (!row) return null
    return {
      itemStates: (row.item_states as Record<string, boolean>) ?? {},
      fieldValues: (row.field_values as Record<string, string>) ?? {},
      signature: row.signature ? `data:image/png;base64,${(row.signature as Buffer).toString('base64')}` : '',
      pdfSha256: '',
    }
  }

  async saveDraft(childId: string, formId: string, ctx: AuthContext, payload: FormSubmitPayload): Promise<void> {
    if (!getCatalogForm(formId)) throw new Error(`unknown form: ${formId}`)
    // Guardian-scope the write: the acting guardian must have authority over this
    // child (matched against ctx.guardianOf, minor-child age bar) before we persist
    // even scratch draft state referencing them.
    await this.authorize(ctx, 'consent.grant', await this.childResource(childId), { sql: this.sql })
    const sigBuf = payload.signature?.startsWith('data:') ? Buffer.from(payload.signature.split(',')[1] ?? '', 'base64') : null
    await this.sql`
      insert into consent_form_draft (guardian_account_id, subject_student_account_id, form_id, item_states, field_values, signature)
      values (${ctx.account.id}, ${childId}, ${formId}, ${this.sql.json(payload.itemStates)}, ${this.sql.json(payload.fieldValues)}, ${sigBuf})
      on conflict (guardian_account_id, subject_student_account_id, form_id)
      do update set item_states = excluded.item_states, field_values = excluded.field_values, signature = excluded.signature, updated_at = now()`
  }

  async submitCompletion(
    childId: string, formId: string, ctx: AuthContext, payload: FormSubmitPayload, now: Date = new Date(),
  ): Promise<{ completionId: string; grants: GrantResult[] }> {
    const form = getCatalogForm(formId)
    if (!form) throw new FormNotFoundError(formId)

    // Guardian-scope the whole submission up front: the acting guardian must have
    // authority over this child (consent.grant is guardian-scoped, writes:true, with
    // the age-18 bar). captureGrant re-authorizes per grant, but this gate also
    // covers a submission whose checked items map to NO grant (audit-only write).
    await this.authorize(ctx, 'consent.grant', await this.childResource(childId), { sql: this.sql })

    // 1. Completeness (every required item checked; every required field present).
    for (const item of form.items) {
      if (item.required && payload.itemStates[item.itemKey] !== true) throw new FormItemRequiredError(item.itemKey)
    }
    for (const field of form.fields) {
      if (field.required && !(payload.fieldValues[field.fieldType]?.trim())) throw new FormFieldRequiredError(field.fieldType)
    }
    // 2. Bind to the exact bytes the guardian saw.
    if (payload.pdfSha256 !== form.pdfSha256) throw new FormPdfHashMismatchError(formId)

    // 2b. A completion is a legal artifact — require a well-formed, bounded signature
    //     server-side (the client "must sign" rule is not trusted).
    const sigBuf = this.decodeSignature(payload.signature)

    // 3. Elevated gate: any elevated form OR any checked elevated item requires a
    //    strong-method verification result. A reused signature alone never suffices.
    const anyCheckedElevated = form.elevated || form.items.some((i) => i.elevated && payload.itemStates[i.itemKey] === true)
    if (anyCheckedElevated) {
      const v = payload.verification
      if (!v || !STRONG_GRANT_METHODS.includes(v.method) || !v.evidenceArtifactRef) {
        throw new FormElevatedVerificationRequiredError(formId)
      }
    }

    // 4. Which grants to capture: distinct grantMappings on CHECKED items.
    const grantTypes = [...new Set(
      form.items.filter((i) => i.grantMapping && payload.itemStates[i.itemKey] === true).map((i) => i.grantMapping as ConsentGrantType),
    )]
    const method: ConsentGrantMethod = anyCheckedElevated ? (payload.verification!.method) : 'click'
    const completionId = randomUUID()

    // The immutable audit + signature + autofill + draft-delete write atomically.
    // The grant captures run POST-COMMIT: this postgres.js build does not expose a
    // nested `.begin` on the transaction handle (captureGrant opens its own
    // savepoint transaction), so the grants cannot be captured inside this tx.
    await this.sql.begin(async (tx) => {
      await tx`
        insert into consent_signature (completion_id, image, binding)
        values (${completionId}, ${sigBuf}, ${tx.json({ formId, formVersion: form.version, pdfSha256: form.pdfSha256, timestamp: now.toISOString() })})`
      const [sig] = await tx`select id from consent_signature where completion_id = ${completionId} order by seq desc limit 1`
      await tx`
        insert into consent_form_completion (id, form_id, form_version, pdf_sha256, subject_student_account_id,
          signer_account_id, audience, item_states, field_values, signature_ref, verification, submitted_at)
        values (${completionId}, ${formId}, ${form.version}, ${form.pdfSha256}, ${childId}, ${ctx.account.id},
          ${form.audience}, ${tx.json(payload.itemStates)}, ${tx.json(payload.fieldValues)}, ${sig!.id},
          ${payload.verification ? tx.json(payload.verification) : null}, ${now})`
      for (const [fieldType, value] of Object.entries(payload.fieldValues)) {
        if (ConsentFormService.CHILD_SCOPED_FIELDS.has(fieldType)) continue
        await tx`insert into guardian_saved_field (guardian_account_id, field_type, value_text)
          values (${ctx.account.id}, ${fieldType}, ${value})
          on conflict (guardian_account_id, field_type) do update set value_text = excluded.value_text, updated_at = now()`
      }
      await tx`insert into guardian_saved_field (guardian_account_id, field_type, value_blob)
        values (${ctx.account.id}, 'signature', ${sigBuf})
        on conflict (guardian_account_id, field_type) do update set value_blob = excluded.value_blob, updated_at = now()`
      await tx`delete from consent_form_draft
        where guardian_account_id = ${ctx.account.id} and subject_student_account_id = ${childId} and form_id = ${formId}`
    })

    const grantSvc = new ConsentGrantService({ sql: this.sql, authorize: this.authorize as never })
    const grants: GrantResult[] = []
    for (const grantType of grantTypes) {
      grants.push(await grantSvc.captureGrant(childId, grantType, ctx, { method, evidenceArtifactRef: completionId, now }))
    }

    return { completionId, grants }
  }
}
