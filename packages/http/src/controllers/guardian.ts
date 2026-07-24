// -------------------------------------------------------------------------
// Guardian portal controllers (05-api-surface.md "Guardian portal"). Every
// method is guardian-scoped: the resource names the child and the scope matches
// only the acting guardian's own verified minor children (a different guardian,
// a lapsed edge, or an 18+ child denies with an opaque 403). Consent grant/revoke
// go through ConsentService; the read/request surface through GuardianPortalService.
//
//   viewChildRecord      GET  /api/guardian/children/:id/record   (guardian.view_child_record)
//   viewChildFees        GET  /api/guardian/children/:id/fees     (guardian.view_fee_status)
//   grantChildConsent    POST /api/guardian/children/:id/consents (consent.grant)
//   revokeChildConsent   POST /api/guardian/children/:id/consents/:type/revoke (consent.revoke)
//   requestChildExport   POST /api/guardian/children/:id/export   (guardian.request_export)
//   requestChildDeletion POST /api/guardian/children/:id/deletion (guardian.request_deletion)
//   viewDigest           GET  /api/guardian/digest                (guardian.view_digest)
// -------------------------------------------------------------------------

import {
  ConsentService,
  ConsentGrantService,
  CONSENT_GRANT_TYPES,
  GuardianPortalService,
  composeRevokeCascades,
  mediaPhotoMediaRevokeCascade,
  projectExternalPublicationRevokeCascade,
  type ChapterDigest,
  type ChildRecord,
  type ChildSummary,
  type ConsentGrantMethod,
  type ConsentGrantType,
  type ConsentResult,
  type DeletionRequestResult,
  type DeletionScope,
  type ExportRequestResult,
  type FeeStatus,
  type GrantResult,
  type GrantStatusView,
  type PublicItemView,
  type RevokeGrantResult,
} from '@curiolab/app'
import type { ConsentType } from '@curiolab/core'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { ValidationError, optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

const GRANT_METHODS: readonly ConsentGrantMethod[] = [
  'click',
  'signed_form',
  'monetary_transaction',
  'video_call',
  'id_verification',
]

const CONSENT_TYPES: readonly ConsentType[] = [
  'enrollment',
  'data_collection',
  'platform_participation',
  'public_profile',
  'photo_media',
  'external_publication',
]

const DELETION_SCOPES: readonly DeletionScope[] = ['full', 'redaction']

export interface ChildIdInput extends AuthedInputBase {
  params: { id?: unknown }
}

/** GET /api/guardian/children/:id/record — the composed child record (logs a read). */
export function viewChildRecord(input: ChildIdInput): Promise<ControllerResult<ChildRecord>> {
  return runAuthed<ChildRecord>(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    // On allow the read seam always returns a record; a deny throws Forbidden.
    const record = await new GuardianPortalService({ sql, authorize }).viewChildRecord(childId, ctx)
    return { status: 200, body: record as ChildRecord }
  })
}

/** GET /api/guardian/children/:id/fees — fee status + scholarships, never an amount. */
export function viewChildFees(input: ChildIdInput): Promise<ControllerResult<FeeStatus>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const fees = await new GuardianPortalService({ sql, authorize }).viewFees(childId, ctx)
    return { status: 200, body: fees }
  })
}

export interface GrantConsentInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { type?: unknown; scopeRef?: unknown }
}

/** POST /api/guardian/children/:id/consents — a digital consent grant. */
export function grantChildConsent(
  input: GrantConsentInput,
): Promise<ControllerResult<ConsentResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const type = reqStr(input.body?.type, 'type') as ConsentType
    if (!CONSENT_TYPES.includes(type)) throw new ValidationError(`unknown consent type: ${type}`)
    const result = await new ConsentService({ sql, authorize }).grantConsent(childId, type, ctx, {
      scopeRef: optStr(input.body?.scopeRef),
    })
    return { status: 201, body: result }
  })
}

export interface RevokeConsentInput extends AuthedInputBase {
  params: { id?: unknown; type?: unknown }
}

/** POST /api/guardian/children/:id/consents/:type/revoke — a digital consent revoke. */
export function revokeChildConsent(
  input: RevokeConsentInput,
): Promise<ControllerResult<ConsentResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const type = reqStr(input.params?.type, 'type') as ConsentType
    if (!CONSENT_TYPES.includes(type)) throw new ValidationError(`unknown consent type: ${type}`)
    const result = await new ConsentService({
      sql,
      authorize,
      onRevoke: composeRevokeCascades(
        projectExternalPublicationRevokeCascade,
        mediaPhotoMediaRevokeCascade,
      ),
    }).revokeConsent(childId, type, ctx)
    return { status: 200, body: result }
  })
}

/** POST /api/guardian/children/:id/export — file an export request. */
export function requestChildExport(
  input: ChildIdInput,
): Promise<ControllerResult<ExportRequestResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const result = await new GuardianPortalService({ sql, authorize }).requestExport(childId, ctx)
    return { status: 201, body: result }
  })
}

export interface RequestDeletionInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { scope?: unknown }
}

/** POST /api/guardian/children/:id/deletion — file a deletion request. */
export function requestChildDeletion(
  input: RequestDeletionInput,
): Promise<ControllerResult<DeletionRequestResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const scope = reqStr(input.body?.scope, 'scope') as DeletionScope
    if (!DELETION_SCOPES.includes(scope)) throw new ValidationError(`unknown deletion scope: ${scope}`)
    const result = await new GuardianPortalService({ sql, authorize }).requestDeletion(
      childId,
      ctx,
      scope,
    )
    return { status: 201, body: result }
  })
}

/** GET /api/guardian/digest — the non-child-specific chapter digest. */
export function viewDigest(input: AuthedInputBase): Promise<ControllerResult<ChapterDigest>> {
  return runAuthed(input, async (ctx, sql) => {
    const digest = await new GuardianPortalService({ sql, authorize }).viewDigest(ctx)
    return { status: 200, body: digest }
  })
}

// -------------------------------------------------------------------------
// §5 consent GRANT ledger — the guardian-portal grant surface. Capture reuses
// consent.grant, per-grant revoke reuses consent.revoke, the object write uses
// publication.object, and the three reads use the additive §5 guardian read
// capabilities. Every method is guardian-scoped (the child in the path must be
// one of the acting guardian's verified children).
//
//   listChildren          GET  /api/guardian/children                                   (guardian.list_children)
//   viewChildGrants       GET  /api/guardian/children/:id/grants                        (guardian.view_grants)
//   viewChildPublicItems  GET  /api/guardian/children/:id/public-items                  (guardian.view_public_items)
//   captureChildGrant     POST /api/guardian/children/:id/grants                        (consent.grant)
//   revokeChildGrant      POST /api/guardian/children/:id/grants/:type/revoke           (consent.revoke)
//   objectPublicationHold POST /api/guardian/children/:id/publication-holds/:holdId/object (publication.object)
// -------------------------------------------------------------------------

/** GET /api/guardian/children — the guardian's verified children (display names). */
export function listChildren(
  input: AuthedInputBase,
): Promise<ControllerResult<{ items: ChildSummary[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const items = await new ConsentGrantService({ sql, authorize }).listChildren(ctx)
    return { status: 200, body: { items } }
  })
}

/** GET /api/guardian/children/:id/grants — the six grant types with status. */
export function viewChildGrants(
  input: ChildIdInput,
): Promise<ControllerResult<{ items: GrantStatusView[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const items = await new ConsentGrantService({ sql, authorize }).viewChildGrants(childId, ctx)
    return { status: 200, body: { items } }
  })
}

/** GET /api/guardian/children/:id/public-items — the child's public-surface items. */
export function viewChildPublicItems(
  input: ChildIdInput,
): Promise<ControllerResult<{ items: PublicItemView[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const items = await new ConsentGrantService({ sql, authorize }).viewChildPublicItems(childId, ctx)
    return { status: 200, body: { items } }
  })
}

export interface CaptureGrantInput extends AuthedInputBase {
  params: { id?: unknown }
  body: { grantType?: unknown; method?: unknown; evidenceArtifactRef?: unknown; scope?: unknown }
}

/** POST /api/guardian/children/:id/grants — capture a grant (consent.grant). */
export function captureChildGrant(input: CaptureGrantInput): Promise<ControllerResult<GrantResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const grantType = reqStr(input.body?.grantType, 'grantType') as ConsentGrantType
    if (!CONSENT_GRANT_TYPES.includes(grantType)) {
      throw new ValidationError(`unknown grant type: ${grantType}`)
    }
    const method = reqStr(input.body?.method, 'method') as ConsentGrantMethod
    if (!GRANT_METHODS.includes(method)) throw new ValidationError(`unknown method: ${method}`)
    const result = await new ConsentGrantService({ sql, authorize }).captureGrant(childId, grantType, ctx, {
      method,
      evidenceArtifactRef: optStr(input.body?.evidenceArtifactRef),
      scope: optStr(input.body?.scope),
    })
    return { status: 201, body: result }
  })
}

export interface RevokeGrantInput extends AuthedInputBase {
  params: { id?: unknown; type?: unknown }
}

/** POST /api/guardian/children/:id/grants/:type/revoke — per-grant revoke (consent.revoke). */
export function revokeChildGrant(input: RevokeGrantInput): Promise<ControllerResult<RevokeGrantResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const childId = reqStr(input.params?.id, 'id')
    const grantType = reqStr(input.params?.type, 'type') as ConsentGrantType
    if (!CONSENT_GRANT_TYPES.includes(grantType)) {
      throw new ValidationError(`unknown grant type: ${grantType}`)
    }
    const result = await new ConsentGrantService({ sql, authorize }).revokeGrant(childId, grantType, ctx)
    return { status: 200, body: result }
  })
}

export interface ObjectHoldInput extends AuthedInputBase {
  params: { id?: unknown; holdId?: unknown }
}

/** POST /api/guardian/children/:id/publication-holds/:holdId/object — withhold one item. */
export function objectPublicationHold(
  input: ObjectHoldInput,
): Promise<ControllerResult<{ holdId: string; objected: boolean }>> {
  return runAuthed(input, async (ctx, sql) => {
    const holdId = reqStr(input.params?.holdId, 'holdId')
    const result = await new ConsentGrantService({ sql, authorize }).objectPublicationHold(holdId, ctx)
    return { status: 200, body: result }
  })
}
