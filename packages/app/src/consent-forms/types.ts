import type { ConsentGrantType, ConsentGrantMethod } from '../config.js'

export type FormAudience = 'guardian' | 'mentor' | 'student'
export type FieldInputType = 'text' | 'date' | 'tel' | 'email'
export type FormStatus = 'not_started' | 'in_progress' | 'complete'

/** One parsed "- [ ]" clause. Client-safe. */
export interface FormItemSchema {
  itemKey: string
  text: string
  required: boolean
  elevated: boolean
}

/** One fill-in blank. Curated (NOT auto-parsed). Client-safe. */
export interface FormFieldSchema {
  fieldType: string
  label: string
  inputType: FieldInputType
  required: boolean
}

/** The client-safe schema delivered by the API (no grant mappings). */
export interface FormClientSchema {
  formId: string
  documentId: string
  version: string
  title: string
  audience: FormAudience
  elevated: boolean
  pdfPath: string
  pdfSha256: string
  items: FormItemSchema[]
  fields: FormFieldSchema[]
}

/** Server-only: adds the grant mapping per item. */
export interface CatalogItem extends FormItemSchema {
  grantMapping?: ConsentGrantType
}
export interface CatalogForm extends Omit<FormClientSchema, 'items'> {
  items: CatalogItem[]
}

export interface FormListEntry {
  schema: FormClientSchema
  status: FormStatus
}

/** The submit / draft payload from the client. */
export interface FormSubmitPayload {
  itemStates: Record<string, boolean>
  fieldValues: Record<string, string>
  signature: string
  pdfSha256: string
  verification?: { method: ConsentGrantMethod; evidenceArtifactRef?: string | null }
}
