import { cookies, headers } from 'next/headers'

export type FormStatus = 'not_started' | 'in_progress' | 'complete'
export interface FormItemSchema { itemKey: string; text: string; required: boolean; elevated: boolean }
export interface FormFieldSchema { fieldType: string; label: string; inputType: 'text'|'date'|'tel'|'email'; required: boolean }
export interface FormClientSchema {
  formId: string; documentId: string; version: string; title: string
  audience: 'guardian'|'mentor'|'student'; elevated: boolean; pdfPath: string; pdfSha256: string
  items: FormItemSchema[]; fields: FormFieldSchema[]
}
export interface FormListEntry { schema: FormClientSchema; status: FormStatus }

async function origin(): Promise<string | null> {
  const h = await headers(); const host = h.get('host'); const proto = h.get('x-forwarded-proto') ?? 'http'
  return process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : null)
}

/** Guardian forms for a child; null when unauthenticated (page shows the sample notice). */
export async function getChildForms(childId: string): Promise<FormListEntry[] | null> {
  try {
    const session = (await cookies()).get('cl_session'); if (!session) return null
    const o = await origin(); if (!o) return null
    const res = await fetch(`${o}/api/guardian/children/${childId}/forms`, {
      headers: { cookie: `cl_session=${session.value}` }, cache: 'no-store',
    })
    if (!res.ok) return null
    return ((await res.json()) as { items: FormListEntry[] }).items
  } catch { return null }
}
