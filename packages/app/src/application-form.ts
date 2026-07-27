// -------------------------------------------------------------------------
// ApplicationFormService — the editable, versioned, per-chapter application form
// definition (docs/platform/application-form-definition-spec.md + the two
// program-lead overrides). A chapter director edits the questions applicants
// answer (parent Stage-2A + student Stage-2B); the apply funnel renders from the
// stored PUBLISHED definition, and the director portal renders each application's
// answers against the version stamped at draft time (override 2).
//
//   GET  /api/ops/application-form  (application.read)        -> resolveForChapter
//   PUT  /api/ops/application-form  (application.form.manage) -> saveForm
//
// The wire `definition` matches the frontend model (lib/portal/director/
// application-form.ts) EXACTLY, so no translation is needed.
//
// OVERRIDE 1 — student keys stay constrained to the CODE allowlist
// (STAGE2_STUDENT_ALLOWED_FIELDS). A student question with any other key is
// rejected 400. Directors may reword a student question but may not add a student
// key off the allowlist. This preserves the COPPA invariant that 2B collects
// nothing identifying. The allowlist is NOT chapter-scoped/extensible.
//
// OVERRIDE 2 — the stamping lives in Stage2Service (startStage2 captures the
// published version onto the draft; submitStage2 carries it to the application);
// this module exposes `resolvePublishedForm` (the funnel resolver) and
// `formById` (the director-detail read-back) it uses.
//
// Framework-agnostic: the db handle and `authorize` are injected.
// -------------------------------------------------------------------------

import type { Sql, JSONValue } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, writeAudit, type AuthorizeDeps } from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { ApplicationFormValidationError } from './errors.js'

// ---- the definition shape (matches lib/portal/director/application-form.ts) ----

export type QuestionType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'date'
  | 'dropdown'
  | 'multiple_choice'
  | 'checkboxes'
  | 'consent'

/** The choice types that require ≥1 option. */
export const CHOICE_TYPES: readonly QuestionType[] = ['dropdown', 'multiple_choice', 'checkboxes']

const ALL_QUESTION_TYPES: readonly QuestionType[] = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'date',
  'dropdown',
  'multiple_choice',
  'checkboxes',
  'consent',
]

export interface FormQuestion {
  id: string
  key: string
  label: string
  type: QuestionType
  required: boolean
  help?: string
  options?: string[]
  fixed?: boolean
}

export type SectionId = 'parent' | 'student'

export interface FormSection {
  id: SectionId
  title: string
  description: string
  questions: FormQuestion[]
}

export interface FormDefinition {
  version?: number
  updatedAt?: string | null
  sections: FormSection[]
}

/** The stored form as the GET/PUT surfaces return it. */
export interface StoredForm {
  /** null for the platform default. */
  chapterId: string | null
  version: number
  status: 'draft' | 'published'
  definition: FormDefinition
}

/** The resolved PUBLISHED form the funnel renders (override 2 read-back too). */
export interface ResolvedForm {
  formId: string
  chapterId: string | null
  version: number
  definition: FormDefinition
}

// ---- validation (pure) ----------------------------------------------------

/** A fixed field's locked structure, taken from the platform default. */
export interface FixedFieldSpec {
  section: SectionId
  key: string
  type: QuestionType
  required: boolean
}

export interface ValidateDeps {
  /**
   * The COPPA floor for student questions: any student key matching this is
   * refused at publish time. This is the ONLY constraint on which student keys a
   * director may create — the published definition itself is the allowlist that
   * saveStudentSection enforces at write time.
   */
  identifyingKeyPattern: RegExp
  /** The fixed-field specs the incoming definition may not restructure. */
  fixedFields: readonly FixedFieldSpec[]
}

/**
 * The student keys a given published definition permits — the runtime allowlist
 * saveStudentSection checks a 2B write against. Derived from the definition so a
 * director's published questions and the accepted answer keys can never drift.
 */
export function allowedStudentKeys(definition: FormDefinition | undefined | null): string[] {
  if (!definition || !Array.isArray(definition.sections)) return []
  const student = definition.sections.find((s) => s.id === 'student')
  return (student?.questions ?? []).map((q) => q.key)
}

const SLUG_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Validate a form definition server-side. Throws ApplicationFormValidationError
 * (mapped to 400) with the offending detail. Pure — no IO — so it is unit-testable
 * without a database. The rules (spec §Validation + override 1):
 *   - well-formed structure (sections array, known section ids, question shape);
 *   - keys unique within a section, non-empty, slug-safe;
 *   - choice types carry ≥1 option;
 *   - every STUDENT key is on the code allowlist (override 1), and no student key
 *     matches the identifying pattern;
 *   - every fixed field from the platform default is present with the SAME
 *     key/type/required (only label/help/option wording may change).
 */
export function validateDefinition(definition: unknown, deps: ValidateDeps): FormDefinition {
  if (!isRecord(definition) || !Array.isArray(definition.sections)) {
    throw new ApplicationFormValidationError('malformed', 'definition must have a sections array')
  }
  const seenSectionIds = new Set<string>()
  for (const rawSection of definition.sections) {
    if (!isRecord(rawSection)) {
      throw new ApplicationFormValidationError('malformed', 'each section must be an object')
    }
    const sectionId = rawSection.id
    if (sectionId !== 'parent' && sectionId !== 'student') {
      throw new ApplicationFormValidationError('malformed', `unknown section id: ${String(sectionId)}`, {
        section: sectionId,
      })
    }
    if (seenSectionIds.has(sectionId)) {
      throw new ApplicationFormValidationError('malformed', `duplicate section: ${sectionId}`, {
        section: sectionId,
      })
    }
    seenSectionIds.add(sectionId)
    if (!Array.isArray(rawSection.questions)) {
      throw new ApplicationFormValidationError('malformed', `section ${sectionId} needs a questions array`, {
        section: sectionId,
      })
    }

    const keysInSection = new Set<string>()
    for (const rawQ of rawSection.questions) {
      if (!isRecord(rawQ)) {
        throw new ApplicationFormValidationError('malformed', 'each question must be an object', {
          section: sectionId,
        })
      }
      const key = rawQ.key
      if (typeof key !== 'string' || key.length === 0) {
        throw new ApplicationFormValidationError('empty_key', 'a question key must be a non-empty string', {
          section: sectionId,
        })
      }
      if (!SLUG_RE.test(key)) {
        throw new ApplicationFormValidationError('non_slug_key', `question key is not slug-safe: ${key}`, {
          section: sectionId,
          key,
        })
      }
      if (keysInSection.has(key)) {
        throw new ApplicationFormValidationError('duplicate_key', `duplicate question key in ${sectionId}: ${key}`, {
          section: sectionId,
          key,
        })
      }
      keysInSection.add(key)

      const type = rawQ.type
      if (typeof type !== 'string' || !ALL_QUESTION_TYPES.includes(type as QuestionType)) {
        throw new ApplicationFormValidationError('malformed', `unknown question type: ${String(type)}`, {
          section: sectionId,
          key,
        })
      }
      if (CHOICE_TYPES.includes(type as QuestionType)) {
        const options = rawQ.options
        if (!Array.isArray(options) || options.length === 0) {
          throw new ApplicationFormValidationError(
            'choice_no_options',
            `choice question ${key} needs at least one option`,
            { section: sectionId, key },
          )
        }
      }

      // The COPPA floor for the student section. A director may now add their own
      // student questions (the published definition is what applicants see AND
      // what saveStudentSection accepts), so the closed code allowlist is no
      // longer the gate. The identifying-key pattern IS, and it is enforced HERE,
      // at publish time, so a director who tries to ask a child for their name,
      // email, school, phone or birthday is refused in the editor with a clear
      // message rather than the child hitting an opaque wall mid-application.
      // saveStudentSection re-checks the same pattern at write time, so a form
      // published before this rule existed still cannot smuggle a key through.
      if (sectionId === 'student' && deps.identifyingKeyPattern.test(key)) {
        throw new ApplicationFormValidationError(
          'identifying_key',
          `student question key looks identifying: ${key}`,
          { section: sectionId, key },
        )
      }
    }
  }

  // Fixed fields: every platform-default fixed field must be present with the same
  // key/type/required (only label/help/option wording may change). A missing one
  // is a removal; a differing type/required is a restructuring.
  const bySection = new Map<SectionId, Map<string, { type: unknown; required: unknown }>>()
  for (const rawSection of definition.sections as Record<string, unknown>[]) {
    const sid = rawSection.id as SectionId
    const m = new Map<string, { type: unknown; required: unknown }>()
    for (const q of rawSection.questions as Record<string, unknown>[]) {
      m.set(q.key as string, { type: q.type, required: q.required })
    }
    bySection.set(sid, m)
  }
  for (const fixed of deps.fixedFields) {
    const incoming = bySection.get(fixed.section)?.get(fixed.key)
    if (incoming === undefined) {
      throw new ApplicationFormValidationError(
        'fixed_field_changed',
        `fixed field removed: ${fixed.section}.${fixed.key}`,
        { section: fixed.section, key: fixed.key, reason: 'removed' },
      )
    }
    if (incoming.type !== fixed.type || incoming.required !== fixed.required) {
      throw new ApplicationFormValidationError(
        'fixed_field_changed',
        `fixed field structure changed: ${fixed.section}.${fixed.key}`,
        {
          section: fixed.section,
          key: fixed.key,
          reason: 'restructured',
          expected: { type: fixed.type, required: fixed.required },
        },
      )
    }
  }

  return definition as unknown as FormDefinition
}

/** Extract the fixed-field specs from a (platform-default) definition. */
export function fixedFieldsOf(definition: FormDefinition): FixedFieldSpec[] {
  const out: FixedFieldSpec[] = []
  for (const section of definition.sections) {
    for (const q of section.questions) {
      if (q.fixed === true) {
        out.push({ section: section.id, key: q.key, type: q.type, required: q.required })
      }
    }
  }
  return out
}

// ---- resolvers (shared with Stage2Service) --------------------------------

interface FormRow {
  id: string
  chapter_id: string | null
  version: number
  status: string
  definition: FormDefinition
  published_at: Date | null
}

/**
 * The PUBLISHED form the funnel renders for a chapter: the latest published row
 * for the chapter, else the latest published platform default (chapter_id NULL).
 * Returns null only when no platform default exists (it is seeded, so it does).
 */
export async function resolvePublishedForm(
  sql: Sql,
  chapterId: string | null,
): Promise<ResolvedForm | null> {
  if (chapterId !== null) {
    const [chapterForm] = await sql`
      select id, chapter_id, version, definition from application_form
      where chapter_id = ${chapterId} and status = 'published'
      order by version desc limit 1
    `
    if (chapterForm !== undefined) return toResolved(chapterForm as unknown as FormRow)
  }
  const [platform] = await sql`
    select id, chapter_id, version, definition from application_form
    where chapter_id is null and status = 'published'
    order by version desc limit 1
  `
  return platform === undefined ? null : toResolved(platform as unknown as FormRow)
}

/** Read one form row by id (the override-2 director-detail read-back). */
export async function formById(sql: Sql, formId: string): Promise<ResolvedForm | null> {
  const [row] = await sql`
    select id, chapter_id, version, definition from application_form where id = ${formId}
  `
  return row === undefined ? null : toResolved(row as unknown as FormRow)
}

function toResolved(row: FormRow): ResolvedForm {
  return {
    formId: row.id,
    chapterId: row.chapter_id,
    version: row.version,
    definition: row.definition,
  }
}

// ---- the service ----------------------------------------------------------

export type ApplicationFormCapability = 'application.read' | 'application.form.manage'

export type ApplicationFormAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: ApplicationFormCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ApplicationFormServiceDeps {
  sql: Sql
  authorize: ApplicationFormAuthorizeFn
  config?: Partial<AppConfig>
}

export interface SaveFormInput {
  definition: unknown
  publish?: boolean
}

/** In-force chapter_director chapters for the actor (mirrors OpsReadService). */
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

export class ApplicationFormService {
  private readonly sql: Sql
  private readonly authorize: ApplicationFormAuthorizeFn
  private readonly config: AppConfig

  constructor(deps: ApplicationFormServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
    this.config = { ...defaultConfig, ...deps.config }
  }

  /**
   * GET: the caller's chapter's CURRENT form (the latest published if any, else
   * the latest draft), or the platform default when the chapter has none.
   * Chapter-scoped read (application.read): a director reads their own chapter; a
   * platform reader (admin/staff) reads a chapter via ?chapterId, or the platform
   * default when none is given.
   */
  async getForm(ctx: AuthContext, requestedChapterId?: string | null): Promise<StoredForm> {
    const chapterId = await this.resolveChapter(ctx, 'application.read', requestedChapterId)
    if (chapterId !== null) {
      const [published] = await this.sql`
        select chapter_id, version, status, definition from application_form
        where chapter_id = ${chapterId} and status = 'published'
        order by version desc limit 1
      `
      if (published !== undefined) return toStored(published)
      const [draft] = await this.sql`
        select chapter_id, version, status, definition from application_form
        where chapter_id = ${chapterId} and status = 'draft'
        order by version desc limit 1
      `
      if (draft !== undefined) return toStored(draft)
    }
    // No chapter form (or a platform reader with no ?chapterId): the platform default.
    const [platform] = await this.sql`
      select chapter_id, version, status, definition from application_form
      where chapter_id is null and status = 'published'
      order by version desc limit 1
    `
    if (platform === undefined) {
      throw new ApplicationFormValidationError('malformed', 'no platform-default form is seeded')
    }
    return toStored(platform)
  }

  /**
   * PUT: validate, bump the per-chapter version, insert a NEW row (never mutate a
   * published one), publish when `publish` is true (else draft), and write the
   * audit row. Chapter-scoped write (application.form.manage): a director saves
   * their own chapter's form; a platform_admin any via ?chapterId.
   */
  async saveForm(
    ctx: AuthContext,
    input: SaveFormInput,
    requestedChapterId?: string | null,
  ): Promise<StoredForm> {
    const chapterId = await this.resolveChapter(ctx, 'application.form.manage', requestedChapterId)
    if (chapterId === null) {
      // A form is always saved against a concrete chapter; there is no "edit the
      // platform default" surface here.
      throw new ApplicationFormValidationError('malformed', 'a chapter is required to save a form')
    }

    // The platform default supplies the fixed-field specs the edit may not change.
    const platformDefault = await resolvePublishedForm(this.sql, null)
    const fixedFields = platformDefault ? fixedFieldsOf(platformDefault.definition) : []
    const definition = validateDefinition(input.definition, {
      identifyingKeyPattern: this.config.stage2IdentifyingKeyPattern,
      fixedFields,
    })

    const publish = input.publish === true
    const status: 'draft' | 'published' = publish ? 'published' : 'draft'

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [{ next }] = (await tx`
        select coalesce(max(version), 0) + 1 as next from application_form
        where chapter_id = ${chapterId}
      `) as unknown as [{ next: number }]
      const version = Number(next)
      const [row] = await tx`
        insert into application_form (chapter_id, version, status, definition, created_by, published_at)
        values (
          ${chapterId}, ${version}, ${status},
          ${tx.json(definition as unknown as JSONValue)}, ${ctx.account.id},
          ${publish ? tx`now()` : null}
        )
        returning id, chapter_id, version, status, definition
      `
      await writeAudit(tx, {
        action: publish ? 'application.form.published' : 'application.form.saved',
        subjectType: 'application_form',
        subjectId: row!.id as string,
        actorAccountId: ctx.account.id,
        chapterId,
        detail: { version, publish },
      })
      return toStored(row!)
    }) as Promise<StoredForm>
  }

  /**
   * Resolve the ONE chapter this request targets, gating through `authorize`.
   * With an explicit ?chapterId, authorize against it (a cross-chapter director
   * denies out_of_scope). Otherwise a director's own chapter; a platform reader
   * (no director chapter) authorizes against a chapterless resource (only the
   * platform override satisfies it) and targets the platform default (null).
   */
  private async resolveChapter(
    ctx: AuthContext,
    capability: ApplicationFormCapability,
    requested: string | null | undefined,
  ): Promise<string | null> {
    if (requested != null && requested !== '') {
      await this.authorize(ctx, capability, { chapter_id: requested }, { sql: this.sql })
      return requested
    }
    const chapters = directorChapters(ctx)
    if (chapters.length > 0) {
      await this.authorize(ctx, capability, { chapter_id: chapters[0]! }, { sql: this.sql })
      return chapters[0]!
    }
    await this.authorize(ctx, capability, {}, { sql: this.sql })
    return null
  }
}

function toStored(row: Record<string, unknown>): StoredForm {
  return {
    chapterId: (row.chapter_id as string | null) ?? null,
    version: Number(row.version),
    status: row.status as 'draft' | 'published',
    definition: row.definition as FormDefinition,
  }
}
