// SERVER-ONLY. Imports the authoritative catalog from @curiolab/app, so it must
// only be imported by server components (never a "use client" module).
//
// Returns the guardian's LIVE forms (with real per-child status) when a verified
// guardian is signed in, or the catalog's guardian forms as a not-started PREVIEW
// otherwise (the sample / non-guardian view). Without this fallback the consent
// tab is empty for anyone who is not a verified guardian of a real child.
import { CATALOG, toClientSchema } from '@curiolab/app'
import { getChildForms, type FormListEntry } from './consent-forms'

export async function getGuardianFormsForDisplay(childId: string): Promise<FormListEntry[]> {
  const live = await getChildForms(childId)
  if (live && live.length > 0) return live
  return CATALOG.filter((f) => f.audience === 'guardian').map((f) => ({
    schema: toClientSchema(f) as unknown as FormListEntry['schema'],
    status: 'not_started',
  }))
}
