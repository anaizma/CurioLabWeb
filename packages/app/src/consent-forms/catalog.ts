import parsedItems from './parsed-items.json'
import pdfHashes from './pdf-hashes.json'
import type { CatalogForm, CatalogItem, FormClientSchema, FormFieldSchema, FormAudience } from './types.js'
import type { ConsentGrantType } from '../config.js'

type ParsedItems = Record<string, { itemKey: string; text: string }[]>

interface Overlay {
  file: string
  documentId: string
  version: string
  title: string
  audience: FormAudience
  elevated: boolean
  /** Per-item overlay, keyed by 1-based item index (matches parse order). */
  items: Record<number, { required?: boolean; elevated?: boolean; grantMapping?: ConsentGrantType }>
  fields: FormFieldSchema[]
}

const T = (fieldType: string, label: string, inputType: FormFieldSchema['inputType'] = 'text', required = true): FormFieldSchema =>
  ({ fieldType, label, inputType, required })

// The curated, legal-sensitive overlay. Item indices are 1-based in parse order.
const OVERLAYS: Overlay[] = [
  {
    file: 'Form-01-Onboarding-Consent.md', documentId: 'CL-CONSENT-01', version: '2026.03',
    title: 'Enrollment and Account Setup', audience: 'guardian', elevated: false,
    items: {
      1: { required: true, grantMapping: 'program_participation' },
      2: { required: true }, 3: { required: true },
      4: { required: true, grantMapping: 'program_participation' },
      5: { required: true }, 6: { required: true }, 7: { required: true },
      8: { required: true, grantMapping: 'platform_account' },
      9: { required: false },
    },
    fields: [
      T('child_name', "Child's full name"), T('child_dob', 'Date of birth', 'date'),
      T('guardian_name', "Guardian's full name"), T('relationship', 'Relationship to child'),
      T('guardian_email', 'Guardian email', 'email'), T('guardian_phone', 'Guardian phone', 'tel'),
      T('date', 'Date', 'date'),
    ],
  },
  {
    file: 'Form-02-Public-Publication-Consent.md', documentId: 'CL-CONSENT-02', version: '2026.03',
    title: 'Publishing Your Child’s Work Publicly', audience: 'guardian', elevated: true,
    items: { 1: { grantMapping: 'public_publication' }, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-03-Likeness-Release.md', documentId: 'CL-CONSENT-03', version: '2026.03',
    title: 'Photograph and Video Release', audience: 'guardian', elevated: false,
    items: { 1: {}, 2: {}, 3: { grantMapping: 'photo_video_likeness' }, 4: { grantMapping: 'photo_video_likeness' },
             5: { elevated: true, grantMapping: 'photo_video_likeness' }, 6: { elevated: true, grantMapping: 'photo_video_likeness' },
             7: { elevated: true, grantMapping: 'photo_video_likeness' }, 8: {}, 9: {}, 10: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-04-Direct-Messaging-Consent.md', documentId: 'CL-CONSENT-04', version: '2026.03',
    title: 'Direct Messages Between Your Child and Their Mentor', audience: 'guardian', elevated: true,
    items: { 1: { grantMapping: 'mentor_dm' }, 2: {}, 3: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-05-Verification-Link-Acknowledgment.md', documentId: 'CL-CONSENT-05', version: '2026.03',
    title: 'Shareable Verification Link Acknowledgment', audience: 'guardian', elevated: false,
    items: { 1: { grantMapping: 'verification_link_sharing' }, 2: {}, 3: {}, 4: {}, 5: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-06-Emergency-Medical-Authorization.md', documentId: 'CL-CONSENT-06', version: '2026.03',
    title: 'Emergency Contact and Medical Authorization', audience: 'guardian', elevated: false,
    items: { 1: { grantMapping: 'emergency_medical_pickup' }, 2: { grantMapping: 'emergency_medical_pickup' }, 3: {}, 4: {} },
    fields: [ T('guardian_name', 'Guardian name'), T('guardian_phone', 'Phone', 'tel'),
              T('second_contact', 'Second contact'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-07-Pickup-Release-Authorization.md', documentId: 'CL-CONSENT-07', version: '2026.03',
    title: 'Pickup and Release Authorization', audience: 'guardian', elevated: false,
    items: { 1: { grantMapping: 'emergency_medical_pickup' }, 2: { grantMapping: 'emergency_medical_pickup' }, 3: {} },
    fields: [ T('guardian_name', 'Guardian signature name'), T('relationship', 'Relationship to child'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-08-Mentor-Code-of-Conduct.md', documentId: 'CL-CONSENT-08', version: '2026.03',
    title: 'Mentor Code of Conduct and Acceptable Use', audience: 'mentor', elevated: false,
    items: { 1: { required: true } },
    fields: [ T('mentor_name', 'Mentor name'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-09-Background-Check-Authorization.md', documentId: 'CL-CONSENT-09', version: '2026.03',
    title: 'Background Check Disclosure and Authorization', audience: 'mentor', elevated: false,
    items: { 1: { required: true }, 2: { required: true } },
    fields: [ T('mentor_name', 'Name'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-10-Volunteer-Role-Agreement.md', documentId: 'CL-CONSENT-10', version: '2026.03',
    title: 'Volunteer and Role Agreement', audience: 'mentor', elevated: false,
    items: { 1: { required: true } },
    fields: [ T('mentor_name', 'Name'), T('date', 'Date', 'date') ],
  },
  {
    file: 'Form-11-Age-of-Majority-Transfer.md', documentId: 'CL-CONSENT-11', version: '2026.03',
    title: 'Age of Majority Transfer Acknowledgment', audience: 'student', elevated: false,
    items: { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} },
    fields: [ T('student_name', 'Student name'), T('date', 'Date', 'date') ],
  },
]

function buildForm(o: Overlay): CatalogForm {
  const formId = 'form-' + o.file.match(/^Form-(\d\d)-/)![1]
  const parsed = (parsedItems as ParsedItems)[formId] ?? []
  const items: CatalogItem[] = parsed.map((p, idx) => {
    const ov = o.items[idx + 1] ?? {}
    return { itemKey: p.itemKey, text: p.text, required: ov.required ?? false, elevated: ov.elevated ?? false, grantMapping: ov.grantMapping }
  })
  return {
    formId, documentId: o.documentId, version: o.version, title: o.title, audience: o.audience,
    elevated: o.elevated, pdfPath: `/consent-forms/${formId}.pdf`,
    pdfSha256: (pdfHashes as Record<string, string>)[formId]!, items, fields: o.fields,
  }
}

export const CATALOG: CatalogForm[] = OVERLAYS.map(buildForm)

export function getCatalogForm(formId: string): CatalogForm | undefined {
  return CATALOG.find((f) => f.formId === formId)
}

/** Strip server-only fields (grantMapping) for the client. */
export function toClientSchema(f: CatalogForm): FormClientSchema {
  return { ...f, items: f.items.map(({ itemKey, text, required, elevated }) => ({ itemKey, text, required, elevated })) }
}
