import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { CATALOG, getCatalogForm, toClientSchema } from './consent-forms/catalog.js'
import type { FormListEntry, FormSubmitPayload, FormStatus } from './consent-forms/types.js'
import type { AppConfig } from './config.js'

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
    const dob = row ? new Date(row.dob as string) : new Date()
    const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 864e5))
    return { subjectAccountId: childId, subjectAge: age, subjectIsMinor: age < 18, ownerAccountId: childId }
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
    const sigBuf = payload.signature?.startsWith('data:') ? Buffer.from(payload.signature.split(',')[1] ?? '', 'base64') : null
    await this.sql`
      insert into consent_form_draft (guardian_account_id, subject_student_account_id, form_id, item_states, field_values, signature)
      values (${ctx.account.id}, ${childId}, ${formId}, ${this.sql.json(payload.itemStates)}, ${this.sql.json(payload.fieldValues)}, ${sigBuf})
      on conflict (guardian_account_id, subject_student_account_id, form_id)
      do update set item_states = excluded.item_states, field_values = excluded.field_values, signature = excluded.signature, updated_at = now()`
  }
}
