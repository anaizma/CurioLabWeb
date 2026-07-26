// -------------------------------------------------------------------------
// ConsentFormAdminService — the READ-ONLY director-portal view over the static
// consent catalog (the guardian/mentor/student consent forms: their PDF, the
// parsed checkbox items, and the curated detail fields). Phase 1 of the larger
// "Consent Forms" feature: a director inspects the forms their chapter uses; the
// edit / PDF-upload surface is a later phase (the consent.form.manage capability
// and the consent_form DB table already exist for it).
//
//   GET /api/ops/consent-forms        (consent.form.read) -> listForms
//   GET /api/ops/consent-forms/:key   (consent.form.read) -> getForm
//
// The catalog is the SAME static @curiolab/app CATALOG the guardian consent flow
// renders from. It is chapter-independent, so the chapter Resource here exists
// only to gate the read (a director reads their OWN chapter; a platform reader via
// the override) — mirroring ApplicationFormService's chapter resolution.
//
// Framework-agnostic: the db handle and `authorize` are injected.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import type { AuthorizeDeps } from '@curiolab/runtime'
import { CATALOG } from './consent-forms/catalog.js'
import type { CatalogItem, FormAudience, FormFieldSchema } from './consent-forms/types.js'

export type ConsentFormAdminCapability = 'consent.form.read' | 'consent.form.manage'

export type ConsentFormAdminAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: ConsentFormAdminCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ConsentFormAdminServiceDeps {
  sql: Sql
  authorize: ConsentFormAdminAuthorizeFn
}

/** One row in the director's grouped consent-form list. */
export interface ConsentFormSummary {
  formKey: string
  audience: FormAudience
  title: string
  documentId: string
  version: string
  elevated: boolean
  itemCount: number
  fieldCount: number
  pdfPath: string
}

/** The full director-facing detail of one consent form (INCLUDES grantMapping). */
export interface ConsentFormDetail {
  formKey: string
  audience: FormAudience
  title: string
  documentId: string
  version: string
  elevated: boolean
  pdfPath: string
  items: CatalogItem[]
  fields: FormFieldSchema[]
}

/** In-force chapter_director chapters for the actor (mirrors ApplicationFormService). */
function directorChapters(ctx: AuthContext): string[] {
  return ctx.memberships
    .filter((m) => {
      if (m.role !== 'chapter_director' || m.status !== 'active') return false
      if (m.active_from !== null && m.active_from > ctx.now) return false
      if (m.active_until !== null && ctx.now >= m.active_until) return false
      return true
    })
    .map((m) => m.chapter_id)
}

export class ConsentFormAdminService {
  private readonly sql: Sql
  private readonly authorize: ConsentFormAdminAuthorizeFn

  constructor(deps: ConsentFormAdminServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * GET: the consent catalog as director-facing summaries. Chapter-scoped read
   * (consent.form.read): a director reads their own chapter; a platform reader
   * (admin/staff) authorizes against a chapterless resource (only the platform
   * override satisfies it). The catalog itself is static and chapter-independent,
   * so every authorized caller sees the same forms.
   */
  async listForms(ctx: AuthContext): Promise<ConsentFormSummary[]> {
    await this.authorizeRead(ctx)
    return CATALOG.map((c) => ({
      formKey: c.formId,
      audience: c.audience,
      title: c.title,
      documentId: c.documentId,
      version: c.version,
      elevated: c.elevated,
      itemCount: c.items.length,
      fieldCount: c.fields.length,
      pdfPath: c.pdfPath,
    }))
  }

  /**
   * GET: the full detail of one catalog form, or null when no form matches the
   * key. Chapter-scoped read (consent.form.read). Unlike the guardian client
   * schema this INCLUDES each item's grantMapping — this surface is director-facing.
   */
  async getForm(formKey: string, ctx: AuthContext): Promise<ConsentFormDetail | null> {
    await this.authorizeRead(ctx)
    const c = CATALOG.find((f) => f.formId === formKey)
    if (c === undefined) return null
    return {
      formKey: c.formId,
      audience: c.audience,
      title: c.title,
      documentId: c.documentId,
      version: c.version,
      elevated: c.elevated,
      pdfPath: c.pdfPath,
      items: c.items,
      fields: c.fields,
    }
  }

  /**
   * Gate consent.form.read against the director's chapter (or a chapterless
   * resource for a platform reader), mirroring ApplicationFormService.resolveChapter.
   */
  private async authorizeRead(ctx: AuthContext): Promise<void> {
    const chapters = directorChapters(ctx)
    const resource: Resource = chapters.length > 0 ? { chapter_id: chapters[0]! } : {}
    await this.authorize(ctx, 'consent.form.read', resource, { sql: this.sql })
  }
}
