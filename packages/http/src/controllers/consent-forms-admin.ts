// -------------------------------------------------------------------------
// Consent-form catalog READ controllers (director portal "Consent Forms",
// Phase 1). Thin GET adapters over the framework-agnostic ConsentFormAdminService:
// resolve the session to an AuthContext (runAuthed), then call the service, which
// gates the chapter-scoped consent.form.read through the injected `authorize` and
// reads the static consent catalog. A null session is an opaque 403 (runAuthed); a
// cross-chapter / non-director caller is an opaque 403 from the service's authorize.
// No manifest entries — GET is exempt from the route-manifest guard (only mutating
// methods are).
//
//   listConsentForms      GET /api/ops/consent-forms        (consent.form.read)
//   getConsentFormDetail  GET /api/ops/consent-forms/:key   (consent.form.read)
// -------------------------------------------------------------------------

import {
  ConsentFormAdminService,
  FormNotFoundError,
  type ConsentFormSummary,
  type ConsentFormDetail,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

/** A bare list envelope (kept symmetric with the ops-read list controllers). */
interface ListEnvelope<T> {
  items: T[]
}

export interface ConsentFormDetailInput extends AuthedInputBase {
  params: { key?: unknown }
}

/** GET /api/ops/consent-forms — the consent catalog summaries (consent.form.read). */
export function listConsentForms(
  input: AuthedInputBase,
): Promise<ControllerResult<ListEnvelope<ConsentFormSummary>>> {
  return runAuthed(input, async (ctx, sql) => {
    const items = await new ConsentFormAdminService({ sql, authorize }).listForms(ctx)
    return { status: 200, body: { items } }
  })
}

/** GET /api/ops/consent-forms/:key — one form's full detail (consent.form.read); 404 if unknown. */
export function getConsentFormDetail(
  input: ConsentFormDetailInput,
): Promise<ControllerResult<ConsentFormDetail>> {
  return runAuthed(input, async (ctx, sql) => {
    const key = reqStr(input.params?.key, 'key')
    const detail = await new ConsentFormAdminService({ sql, authorize }).getForm(key, ctx)
    // An unknown key -> 404 (FormNotFoundError maps to not_found via mapError),
    // mirroring how getApplication surfaces an unknown id.
    if (detail === null) throw new FormNotFoundError(key)
    return { status: 200, body: detail }
  })
}
