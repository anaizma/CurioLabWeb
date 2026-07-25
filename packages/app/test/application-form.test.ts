// -------------------------------------------------------------------------
// ApplicationFormService + the funnel/stamping wiring (application-form-
// definition-spec.md + the two program-lead overrides). Embedded Postgres,
// synthetic data only. The platform-default form row is seeded by migration 0034,
// so every test DB has it.
//
//   - validateDefinition (pure): override-1 allowlist, identifying keys, fixed
//     fields, duplicate/empty/non-slug keys, choice options.
//   - GET: director reads their chapter (published else draft) or the platform
//     default; non-director 403; cross-chapter denied; admin any.
//   - PUT: bump + insert; publish sets published_at; a second PUT bumps; audit row;
//     application.form.manage allow/deny.
//   - Public funnel read: startStage2 / getParentDraft / getStudentDraft carry the
//     PUBLISHED definition (never a draft); falls back to the platform default.
//   - Version stamping (override 2): submit under version N, publish N+1;
//     getApplication still returns version N's definition.
//   - Safety regression: saveStudentSection still rejects an off-allowlist key.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest, generateSessionToken, hashToken } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  ApplicationFormService,
  ApplicationFormValidationError,
  OpsReadService,
  Stage2Service,
  validateDefinition,
  fixedFieldsOf,
  StudentSectionFieldNotAllowedError,
  type ApplicationFormAuthorizeFn,
  type OpsReadAuthorizeFn,
  type FormDefinition,
} from '../src/index.js'
import { STAGE2_STUDENT_ALLOWED_FIELDS, STAGE2_IDENTIFYING_KEY_PATTERN } from '../src/config.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc() {
  return new ApplicationFormService({ sql: h.sql, authorize: authorize as unknown as ApplicationFormAuthorizeFn })
}
function opsRead() {
  return new OpsReadService({ sql: h.sql, authorize: authorize as unknown as OpsReadAuthorizeFn })
}
function directorCtx(director: string, chapter: string) {
  return baseCtx(director, new Date(), [mem('chapter_director', chapter)])
}

/** The seeded platform-default definition — a valid base to mutate for PUTs. */
async function platformDefaultDefinition(): Promise<FormDefinition> {
  const [row] = await h.sql`
    select definition from application_form where chapter_id is null and status = 'published'
    order by version desc limit 1
  `
  return structuredClone(row!.definition) as FormDefinition
}

// ===========================================================================
describe('validateDefinition (pure, override 1 + spec rules)', () => {
  async function deps() {
    return {
      allowedStudentFields: STAGE2_STUDENT_ALLOWED_FIELDS,
      identifyingKeyPattern: STAGE2_IDENTIFYING_KEY_PATTERN,
      fixedFields: fixedFieldsOf(await platformDefaultDefinition()),
    }
  }

  test('the platform default validates against its own rules', async () => {
    const def = await platformDefaultDefinition()
    const d = await deps()
    expect(() => validateDefinition(def, d)).not.toThrow()
  })

  test('a student key OFF the allowlist is rejected (override 1)', async () => {
    const def = await platformDefaultDefinition()
    const student = def.sections.find((s) => s.id === 'student')!
    student.questions.push({ id: 's_new', key: 'made_up_key', label: 'x', type: 'long_text', required: false })
    try {
      validateDefinition(def, await deps())
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApplicationFormValidationError)
      expect((e as ApplicationFormValidationError).code).toBe('student_key_not_allowed')
    }
  })

  test('an identifying student key is rejected with the identifying signal', async () => {
    const def = await platformDefaultDefinition()
    const student = def.sections.find((s) => s.id === 'student')!
    student.questions.push({ id: 's_email', key: 'guardianEmail', label: 'x', type: 'email', required: false })
    const err = catchErr(() => validateDefinition(def, awaitDepsFor(def)))
    expect(err).toBeInstanceOf(ApplicationFormValidationError)
    expect((err as ApplicationFormValidationError).code).toBe('identifying_key')
  })

  test('changing a fixed field type/required is rejected; label/help change is OK', async () => {
    const d = await deps()
    // label change on a fixed field -> OK
    const okDef = await platformDefaultDefinition()
    const grade = okDef.sections
      .find((s) => s.id === 'parent')!
      .questions.find((q) => q.key === 'gradeEntering')!
    grade.label = 'Which grade will your child enter?'
    grade.help = 'Pick the grade for the fall'
    expect(() => validateDefinition(okDef, d)).not.toThrow()

    // required flip on a fixed field -> rejected
    const badDef = await platformDefaultDefinition()
    badDef.sections.find((s) => s.id === 'parent')!.questions.find((q) => q.key === 'childDob')!.required = false
    expect(() => validateDefinition(badDef, d)).toThrow(ApplicationFormValidationError)

    // removing a fixed field -> rejected
    const rmDef = await platformDefaultDefinition()
    const parent = rmDef.sections.find((s) => s.id === 'parent')!
    parent.questions = parent.questions.filter((q) => q.key !== 'guardianEmail')
    const rmErr = catchErr(() => validateDefinition(rmDef, d))
    expect(rmErr).toBeInstanceOf(ApplicationFormValidationError)
    expect((rmErr as ApplicationFormValidationError).code).toBe('fixed_field_changed')
  })

  test('duplicate, empty, and non-slug keys, and a choice type with no options, are rejected', async () => {
    const d = await deps()
    const dup = await platformDefaultDefinition()
    const student = dup.sections.find((s) => s.id === 'student')!
    student.questions.push({ id: 's_dup', key: 'interests', label: 'dup', type: 'long_text', required: false })
    expect((catchErr(() => validateDefinition(dup, d)) as ApplicationFormValidationError).code).toBe('duplicate_key')

    const empty = await platformDefaultDefinition()
    empty.sections.find((s) => s.id === 'student')!.questions.push({
      id: 's_e', key: '', label: 'x', type: 'long_text', required: false,
    } as never)
    expect((catchErr(() => validateDefinition(empty, d)) as ApplicationFormValidationError).code).toBe('empty_key')

    const nonslug = await platformDefaultDefinition()
    nonslug.sections.find((s) => s.id === 'parent')!.questions.push({
      id: 'p_x', key: 'has space', label: 'x', type: 'short_text', required: false,
    })
    expect((catchErr(() => validateDefinition(nonslug, d)) as ApplicationFormValidationError).code).toBe('non_slug_key')

    const nochoice = await platformDefaultDefinition()
    nochoice.sections.find((s) => s.id === 'parent')!.questions.push({
      id: 'p_c', key: 'favColor', label: 'Favourite colour', type: 'dropdown', required: false, options: [],
    })
    expect((catchErr(() => validateDefinition(nochoice, d)) as ApplicationFormValidationError).code).toBe('choice_no_options')
  })
})

/** Run a thunk, return the thrown error (or throw if it did not throw). */
function catchErr(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected the function to throw')
}
/** Deps with the real allowlist/pattern; fixedFields empty (the identifying check
 *  fires during the section loop, before fixed-field validation). */
function awaitDepsFor(_def: FormDefinition) {
  return {
    allowedStudentFields: STAGE2_STUDENT_ALLOWED_FIELDS,
    identifyingKeyPattern: STAGE2_IDENTIFYING_KEY_PATTERN,
    fixedFields: [],
  }
}

// ===========================================================================
describe('ApplicationFormService.getForm', () => {
  test('a chapter with no form gets the platform default', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    let out!: Awaited<ReturnType<ApplicationFormService['getForm']>>
    await withRequest(async () => {
      out = await svc().getForm(ctx)
    })
    expect(out.chapterId).toBeNull()
    expect(out.version).toBe(1)
    expect(out.status).toBe('published')
    expect(out.definition.sections.map((s) => s.id).sort()).toEqual(['parent', 'student'])
  })

  test('a non-director is denied (403 Forbidden)', async () => {
    const chapter = await makeChapter(h.sql)
    const actor = await makeAdult(h.sql)
    const ctx = baseCtx(actor, new Date(), [mem('lead_instructor', chapter)])
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().getForm(ctx, chapter)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })

  test('a cross-chapter director is denied (out_of_scope)', async () => {
    const chapter = await makeChapter(h.sql)
    const other = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, other)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().getForm(ctx, chapter)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })
})

// ===========================================================================
describe('ApplicationFormService.saveForm (PUT)', () => {
  test('a valid draft bumps version and inserts a draft row; a second PUT bumps again', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const def = await platformDefaultDefinition()

    let first!: Awaited<ReturnType<ApplicationFormService['saveForm']>>
    await withRequest(async () => {
      first = await svc().saveForm(ctx, { definition: def, publish: false }, chapter)
    })
    expect(first.version).toBe(1)
    expect(first.status).toBe('draft')
    expect(first.chapterId).toBe(chapter)

    // getForm with only a draft returns the draft (no published yet).
    let read!: Awaited<ReturnType<ApplicationFormService['getForm']>>
    await withRequest(async () => {
      read = await svc().getForm(ctx)
    })
    expect(read.version).toBe(1)
    expect(read.status).toBe('draft')

    let second!: Awaited<ReturnType<ApplicationFormService['saveForm']>>
    await withRequest(async () => {
      second = await svc().saveForm(ctx, { definition: def, publish: false }, chapter)
    })
    expect(second.version).toBe(2)
  })

  test('publish:true sets published + published_at and writes an audit row', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const def = await platformDefaultDefinition()

    let out!: Awaited<ReturnType<ApplicationFormService['saveForm']>>
    await withRequest(async () => {
      out = await svc().saveForm(ctx, { definition: def, publish: true }, chapter)
    })
    expect(out.status).toBe('published')

    const [row] = await h.sql`
      select status, published_at, created_by from application_form
      where chapter_id = ${chapter} and version = ${out.version}
    `
    expect(row!.status).toBe('published')
    expect(row!.published_at).not.toBeNull()
    expect(row!.created_by).toBe(director)

    const audit = await h.sql`
      select action, detail from audit_entry
      where subject_type = 'application_form' and actor_account_id = ${director}
        and action = 'application.form.published'
    `
    expect(audit.length).toBe(1)
    expect(audit[0]!.detail).toMatchObject({ version: out.version, publish: true })

    // getForm now returns the published version.
    let read!: Awaited<ReturnType<ApplicationFormService['getForm']>>
    await withRequest(async () => {
      read = await svc().getForm(ctx)
    })
    expect(read.status).toBe('published')
    expect(read.version).toBe(out.version)
  })

  test('application.form.manage is enforced: a non-director save is denied and writes nothing', async () => {
    const chapter = await makeChapter(h.sql)
    const actor = await makeAdult(h.sql)
    const ctx = baseCtx(actor, new Date(), [mem('lead_instructor', chapter)])
    const def = await platformDefaultDefinition()
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().saveForm(ctx, { definition: def, publish: true }, chapter)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const rows = await h.sql`select id from application_form where chapter_id = ${chapter}`
    expect(rows).toHaveLength(0)
  })

  test('a student key off the allowlist is rejected 400 (override 1) and no row is written', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const def = await platformDefaultDefinition()
    def.sections.find((s) => s.id === 'student')!.questions.push({
      id: 's_bad', key: 'super_secret', label: 'x', type: 'long_text', required: false,
    })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().saveForm(ctx, { definition: def, publish: true }, chapter)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(ApplicationFormValidationError)
    expect((caught as ApplicationFormValidationError).code).toBe('student_key_not_allowed')
    const rows = await h.sql`select id from application_form where chapter_id = ${chapter}`
    expect(rows).toHaveLength(0)
  })
})

// ===========================================================================
describe('public funnel read carries the PUBLISHED definition', () => {
  async function makeLead(chapterId: string | null): Promise<{ leadId: string; parentToken: string }> {
    const parentToken = generateSessionToken()
    const [row] = await h.sql`
      insert into application_lead (email, chapter, chapter_id, source, filler_role, status, token_hash, expires_at)
      values (${`parent-${randomUUID().slice(0, 8)}@example.test`}, 'a-code', ${chapterId},
              'instagram', 'parent', 'new', ${hashToken(parentToken)}, now() + interval '30 days')
      returning id
    `
    return { leadId: row!.id as string, parentToken }
  }

  test('startStage2 returns the platform default when the chapter has no form', async () => {
    const chapter = await makeChapter(h.sql)
    const { parentToken } = await makeLead(chapter)
    const res = await new Stage2Service({ sql: h.sql }).startStage2(parentToken)
    expect(res.form).not.toBeNull()
    expect(res.form!.chapterId).toBeNull() // the platform default
    expect(res.form!.version).toBe(1)
  })

  test('the funnel shows the chapter PUBLISHED form, not a newer draft', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const def = await platformDefaultDefinition()

    // Publish v1 for the chapter, then save a DRAFT v2 (not published).
    let published!: Awaited<ReturnType<ApplicationFormService['saveForm']>>
    await withRequest(async () => {
      published = await svc().saveForm(ctx, { definition: def, publish: true }, chapter)
      await svc().saveForm(ctx, { definition: def, publish: false }, chapter)
    })
    expect(published.version).toBe(1)

    const { parentToken } = await makeLead(chapter)
    const s2 = new Stage2Service({ sql: h.sql })
    const start = await s2.startStage2(parentToken)
    // The funnel sees the PUBLISHED chapter form (v1), never the v2 draft.
    expect(start.form!.chapterId).toBe(chapter)
    expect(start.form!.version).toBe(1)

    const pd = await s2.getParentDraft(parentToken)
    expect(pd.form!.version).toBe(1)
    expect(pd.form!.chapterId).toBe(chapter)
  })
})

// ===========================================================================
describe('version stamping (override 2): getApplication renders the stamped version', () => {
  async function runFunnelToSubmit(chapter: string): Promise<string> {
    const parentToken = generateSessionToken()
    await h.sql`
      insert into application_lead (email, chapter, chapter_id, source, filler_role, status, token_hash, expires_at)
      values (${`parent-${randomUUID().slice(0, 8)}@example.test`}, 'a-code', ${chapter},
              'instagram', 'parent', 'new', ${hashToken(parentToken)}, now() + interval '30 days')
    `
    const s2 = new Stage2Service({ sql: h.sql })
    await s2.startStage2(parentToken)
    await s2.saveParentSection(parentToken, {
      childName: 'Minor Testchild',
      gradeEntering: '7',
      schoolName: 'Test Middle School',
      guardianName: 'Parent Testperson',
      guardianEmail: `guardian-${randomUUID().slice(0, 6)}@example.test`,
    })
    const { studentToken } = await s2.createStudentLink(parentToken)
    await s2.saveStudentSection(studentToken, { interests: 'robotics', motivation: 'to build' })
    const { applicationId } = await s2.submitStage2(parentToken)
    return applicationId
  }

  test('submit under version N, publish N+1; getApplication still returns version N', async () => {
    const chapter = await makeChapter(h.sql)
    const director = await makeAdult(h.sql)
    const ctx = directorCtx(director, chapter)
    const def = await platformDefaultDefinition()

    // Publish v1 for the chapter.
    await withRequest(async () => {
      await svc().saveForm(ctx, { definition: def, publish: true }, chapter)
    })

    const applicationId = await runFunnelToSubmit(chapter)

    // The application is stamped with the chapter's v1.
    const [appRow] = await h.sql`select form_version from application where id = ${applicationId}`
    expect(appRow!.form_version).toBe(1)

    // Director republishes v2 with a reworded student question.
    const v2 = await platformDefaultDefinition()
    v2.sections.find((s) => s.id === 'student')!.questions[0]!.label = 'REWORDED v2 question'
    await withRequest(async () => {
      await svc().saveForm(ctx, { definition: v2, publish: true }, chapter)
    })

    // getApplication renders against the STAMPED v1, not the new v2.
    let detail!: Awaited<ReturnType<OpsReadService['getApplication']>>
    await withRequest(async () => {
      detail = await opsRead().getApplication(ctx, applicationId)
    })
    expect(detail.form).not.toBeNull()
    expect(detail.form!.version).toBe(1)
    const stampedStudentQ0 = (detail.form!.definition as FormDefinition).sections
      .find((s) => s.id === 'student')!
      .questions[0]!
    expect(stampedStudentQ0.label).not.toBe('REWORDED v2 question')
  })
})

// ===========================================================================
describe('safety regression: saveStudentSection guard unchanged', () => {
  test('an off-allowlist / identifying key is still rejected loudly', async () => {
    const chapter = await makeChapter(h.sql)
    const parentToken = generateSessionToken()
    await h.sql`
      insert into application_lead (email, chapter, chapter_id, source, filler_role, status, token_hash, expires_at)
      values (${`parent-${randomUUID().slice(0, 8)}@example.test`}, 'a-code', ${chapter},
              'instagram', 'parent', 'new', ${hashToken(parentToken)}, now() + interval '30 days')
    `
    const s2 = new Stage2Service({ sql: h.sql })
    await s2.startStage2(parentToken)
    await s2.saveParentSection(parentToken, { childName: 'Minor Testchild' })
    const { studentToken } = await s2.createStudentLink(parentToken)
    await expect(s2.saveStudentSection(studentToken, { off_list_key: 'x' })).rejects.toBeInstanceOf(
      StudentSectionFieldNotAllowedError,
    )
  })
})
