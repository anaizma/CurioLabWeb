// -------------------------------------------------------------------------
// Public read controllers (05-api-surface.md "Public site": GET
// /public/projects, /:id and GET /public/newsletter, /:slug — public_site.read).
// PUBLIC (runPublic, no AuthContext). These return ONLY publicly-visible rows —
// `public_listed` projects and `published` newsletter issues; a draft, verified,
// archived, or blocked row is NEVER returned. There is no dedicated service (the
// M3 services add no read method), so the read policy (02-data-model.md: "only
// `published` is readable without a session") is enforced HERE, in the WHERE
// clause. A missing / non-public row is a 404 that reveals nothing further.
// -------------------------------------------------------------------------

import { runPublic } from '../run.js'
import { reqStr } from '../respond.js'
import type { ControllerResult, PublicInputBase } from '../types.js'

// ---- Public projects ------------------------------------------------------

export interface PublicProjectSummary {
  projectId: string
  title: string
  summary: string | null
  chapterId: string
  verifiedAt: string | null
  /** first name + last initial (02-data-model.md; legal_name is never rendered). */
  ownerDisplayName: string
}

export interface PublicProjectListResult {
  projects: PublicProjectSummary[]
}

/** A timestamptz column (a JS Date from `postgres`) as an ISO string, or null. */
function isoOrNull(value: unknown): string | null {
  return value == null ? null : new Date(value as string | Date).toISOString()
}

/** GET /api/public/projects — the public_listed showcase directory. */
export function listPublicProjects(
  input: PublicInputBase,
): Promise<ControllerResult<PublicProjectListResult>> {
  return runPublic(async () => {
    const rows = await input.sql`
      select p.id, p.title, p.summary, p.chapter_id, p.verified_at, a.display_name
      from project p
      join membership m on m.id = p.owner_membership_id
      join account a on a.id = m.account_id
      where p.status = 'public_listed'
      order by p.verified_at desc nulls last, p.created_at desc
    `
    return {
      status: 200,
      body: {
        projects: rows.map((r) => ({
          projectId: r.id as string,
          title: r.title as string,
          summary: (r.summary as string | null) ?? null,
          chapterId: r.chapter_id as string,
          verifiedAt: isoOrNull(r.verified_at),
          ownerDisplayName: (r.display_name as string | null) ?? '',
        })),
      },
    }
  })
}

export interface PublicProjectInput extends PublicInputBase {
  params: { id?: unknown }
}

/** GET /api/public/projects/:id — one public_listed project, else 404. */
export function viewPublicProject(
  input: PublicProjectInput,
): Promise<ControllerResult<PublicProjectSummary | { error: string }>> {
  return runPublic<PublicProjectSummary | { error: string }>(async () => {
    const id = reqStr(input.params?.id, 'id')
    const [r] = await input.sql`
      select p.id, p.title, p.summary, p.chapter_id, p.verified_at, a.display_name
      from project p
      join membership m on m.id = p.owner_membership_id
      join account a on a.id = m.account_id
      where p.id = ${id} and p.status = 'public_listed'
    `
    if (r === undefined) return { status: 404, body: { error: 'not_found' } }
    return {
      status: 200,
      body: {
        projectId: r.id as string,
        title: r.title as string,
        summary: (r.summary as string | null) ?? null,
        chapterId: r.chapter_id as string,
        verifiedAt: isoOrNull(r.verified_at),
        ownerDisplayName: (r.display_name as string | null) ?? '',
      },
    }
  })
}

// ---- Public newsletter ----------------------------------------------------

export interface PublicNewsletterSummary {
  issueId: string
  title: string
  chapterId: string | null
  publishedAt: string | null
}

export interface PublicNewsletterListResult {
  issues: PublicNewsletterSummary[]
}

/** One rendered block of a published issue. */
export interface PublicNewsletterItem {
  body: string
  ref: string | null
}

export interface PublicNewsletterView extends PublicNewsletterSummary {
  body: string
  items: PublicNewsletterItem[]
}

/** GET /api/public/newsletter — the published issues, newest first. */
export function listPublicNewsletters(
  input: PublicInputBase,
): Promise<ControllerResult<PublicNewsletterListResult>> {
  return runPublic(async () => {
    const rows = await input.sql`
      select id, title, chapter_id, published_at from newsletter_issue
      where status = 'published'
      order by published_at desc nulls last, created_at desc
    `
    return {
      status: 200,
      body: {
        issues: rows.map((r) => ({
          issueId: r.id as string,
          title: r.title as string,
          chapterId: (r.chapter_id as string | null) ?? null,
          publishedAt: isoOrNull(r.published_at),
        })),
      },
    }
  })
}

export interface PublicNewsletterInput extends PublicInputBase {
  /** The `newsletter_issue.id` (the surface names it `:slug`; there is no slug column). */
  params: { slug?: unknown }
}

/** GET /api/public/newsletter/:slug — one published issue with its items, else 404. */
export function viewPublicNewsletter(
  input: PublicNewsletterInput,
): Promise<ControllerResult<PublicNewsletterView | { error: string }>> {
  return runPublic<PublicNewsletterView | { error: string }>(async () => {
    const id = reqStr(input.params?.slug, 'slug')
    const [issue] = await input.sql`
      select id, title, body, chapter_id, published_at from newsletter_issue
      where id = ${id} and status = 'published'
    `
    if (issue === undefined) return { status: 404, body: { error: 'not_found' } }
    const items = await input.sql`
      select body, ref from newsletter_item where issue_id = ${id} order by created_at asc
    `
    return {
      status: 200,
      body: {
        issueId: issue.id as string,
        title: issue.title as string,
        body: issue.body as string,
        chapterId: (issue.chapter_id as string | null) ?? null,
        publishedAt: isoOrNull(issue.published_at),
        items: items.map((it) => ({
          body: it.body as string,
          ref: (it.ref as string | null) ?? null,
        })),
      },
    }
  })
}
