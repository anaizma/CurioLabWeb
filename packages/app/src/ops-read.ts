// -------------------------------------------------------------------------
// OpsReadService — the director-portal READ surfaces (admin/director work order
// Phase P1). The write paths already exist in packages/http/controllers/ops.ts
// (§6 of docs/platform/api-reference.md); every ops surface was POST-only. This
// service adds the chapter-scoped list/detail GETs the director portal reads,
// mirroring how GET /api/ops/audit and GET /api/lab/moderation/queue gate then
// read: authorize a chapter-scoped READ capability, then run one query set.
//
// Auth + scope (from docs/platform/director-portal-read-endpoints.md):
//   - session required; a director sees ONLY their own chapter's rows.
//   - a platform_admin sees all chapters via the platform override, or one via
//     an explicit ?chapterId.
//   - a cross-chapter ?chapterId is an opaque Forbidden (403), like every other
//     out-of-scope director read.
// Each surface gates through a small chapter-scoped READ capability
// (application.read / invite.read / membership.read / guardianship.read /
// enrollment.read / pod.read / deletion.read / export.read; the media queue
// reuses the existing media.review). A deny writes one permission.denied row and
// throws Forbidden — the single-code-path invariant, unchanged.
//
// PII (from the platform rules): a minor's raw last name / school never leaves
// this layer. Surfaces that join `account` return `account.display_name` (already
// first name + last initial for under-18); the application surface (which
// predates the account) derives the same first + last-initial form from the raw
// applicant name. The guardianship surface is the one exception — the verify
// decision is a name-on-account vs name-on-form match, so it legitimately returns
// both the guardian's name-on-account (legal name) and the name-on-form.
//
// Framework-agnostic: the db handle and `authorize` are injected; the thin Next
// GET adapters + controllers live in packages/http.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import type { AuthorizeDeps } from '@curiolab/runtime'
import { ApplicationNotFoundError } from './errors.js'

/** The chapter-scoped READ capabilities this service gates on. */
export type OpsReadCapability =
  | 'application.read'
  | 'invite.read'
  | 'membership.read'
  | 'guardianship.read'
  | 'enrollment.read'
  | 'pod.read'
  | 'deletion.read'
  | 'export.read'
  | 'media.review'

/**
 * The injected `authorize` dependency (structurally the runtime `authorize`
 * wrapper; taken by injection so the deny path is testable without HTTP). A read
 * capability with no obligations writes nothing on allow and returns undefined;
 * on deny it writes one permission.denied row and throws Forbidden.
 */
export type OpsReadAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: OpsReadCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface OpsReadServiceDeps {
  sql: Sql
  authorize: OpsReadAuthorizeFn
}

// ---- response shapes ------------------------------------------------------

export interface ApplicationListItem {
  applicationId: string
  status: string
  studentDisplayName: string | null
  guardianDisplayName: string | null
  submittedAt: string
  chapterId: string
  /** No term is captured on an application; always null (noted for the frontend). */
  term: string | null
}

export interface ApplicationDetail {
  applicationId: string
  status: string
  submittedAt: string
  chapterId: string
  student: { displayName: string | null }
  guardian: { displayName: string | null; email: string | null }
  answers: {
    stage2a: Record<string, unknown>
    stage2b: Record<string, unknown>
    /** No separate 2C answer blob exists (2C is the review of 2A+2B); always null. */
    stage2c: Record<string, unknown> | null
  }
  history: { from: string | null; to: string; at: string; note: string | null }[]
}

export interface InviteListItem {
  inviteId: string
  kind: string
  targetEmail: string | null
  status: 'pending' | 'accepted' | 'expired' | 'superseded'
  issuedAt: string
  expiresAt: string
  /** The bound intended account (there is no accepted_account_id column). */
  acceptedAccountId: string | null
}

export interface MembershipListItem {
  membershipId: string
  accountId: string
  displayName: string
  role: string
  status: string
  tier: string | null
  podId: string | null
  joinedAt: string
}

export interface GuardianshipListItem {
  guardianshipId: string
  status: string
  guardianDisplayName: string
  guardianNameOnAccount: string
  studentDisplayName: string
  nameOnForm: string
  createdAt: string
}

export interface MediaDepictionView {
  accountId: string
  displayName: string
  confirmed: boolean
}
export interface MediaReviewItem {
  mediaId: string
  projectId: string | null
  projectTitle: string | null
  reviewStatus: string
  storageRef: string
  depictions: MediaDepictionView[]
  submittedAt: string
}

export interface SubjectRequestItem {
  subjectAccountId: string
  subjectDisplayName: string
  status: string
  requestedAt: string
}
export interface DeletionRequestItem extends SubjectRequestItem {
  deletionRequestId: string
}
export interface ExportRequestItem extends SubjectRequestItem {
  exportRequestId: string
}

export interface EnrollmentListItem {
  enrollmentRecordId: string
  applicationId: string
  studentDisplayName: string | null
  termId: string
  termName: string | null
  guardianNameOnForm: string
  signatureDate: string | null
  hasAccount: boolean
}

export interface PodListItem {
  podId: string
  name: string
  termId: string
  mentorMembershipId: string | null
  mentorDisplayName: string | null
  memberCount: number
}

export interface TermListItem {
  termId: string
  name: string
  startsOn: string
  endsOn: string
}

export interface DashboardSummary {
  newApplications: number
  pendingInvites: number
  guardianshipsToVerify: number
  mediaToReview: number
  openRequests: number
  activeMembers: number
}

export interface ApplicationListQuery {
  chapterId?: string | null
  statuses?: string[]
}
export interface MembershipListQuery {
  chapterId?: string | null
  statuses?: string[]
  roles?: string[]
}
export interface ChapterScopedQuery {
  chapterId?: string | null
}

// ---- helpers --------------------------------------------------------------

/**
 * The first name + last initial rendering (02-data-model.md; a legal name / raw
 * last name is never rendered). Used for surfaces that predate the account (an
 * application), where there is no `account.display_name` to join.
 */
export function displayFromFullName(name: string | null | undefined): string | null {
  if (name == null) return null
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  const first = parts[0]!
  const lastInitial = parts[parts.length - 1]![0]!
  return `${first} ${lastInitial.toUpperCase()}.`
}

/** In-force chapter_director chapters for the actor (the director's own chapters). */
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

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v)
}

// ---------------------------------------------------------------------------

export class OpsReadService {
  private readonly sql: Sql
  private readonly authorize: OpsReadAuthorizeFn

  constructor(deps: OpsReadServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Resolve the set of chapters this read is scoped to, gating through
   * `authorize`. With an explicit `?chapterId` the read is authorized against
   * that one chapter (a cross-chapter director denies out_of_scope -> Forbidden).
   * Without one, a director reads their own chapter(s); a platform reader (no
   * director chapter) authorizes against a chapterless resource — only the
   * platform override satisfies it — and reads ALL chapters (null).
   */
  private async resolveChapters(
    ctx: AuthContext,
    cap: OpsReadCapability,
    requested: string | null | undefined,
  ): Promise<string[] | null> {
    if (requested != null && requested !== '') {
      await this.authorize(ctx, cap, { chapter_id: requested }, { sql: this.sql })
      return [requested]
    }
    const chapters = directorChapters(ctx)
    if (chapters.length > 0) {
      await this.authorize(ctx, cap, { chapter_id: chapters[0]! }, { sql: this.sql })
      return chapters
    }
    // No director chapter and no filter: only the platform override passes here.
    await this.authorize(ctx, cap, {}, { sql: this.sql })
    return null
  }

  // ---- applications -------------------------------------------------------

  async listApplications(
    ctx: AuthContext,
    query: ApplicationListQuery = {},
  ): Promise<{ items: ApplicationListItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'application.read', query.chapterId)
    const statuses = query.statuses && query.statuses.length > 0 ? query.statuses : null
    const sql = this.sql
    const rows = await sql`
      select a.id, a.status, a.applicant_name, a.guardian_name, a.chapter_id, a.created_at
      from application a
      where ${chapters === null ? sql`true` : sql`a.chapter_id in ${sql(chapters)}`}
        ${statuses ? sql`and a.status in ${sql(statuses)}` : sql``}
      order by a.created_at desc
    `
    return {
      items: rows.map((r) => ({
        applicationId: r.id as string,
        status: r.status as string,
        studentDisplayName: displayFromFullName(r.applicant_name as string | null),
        guardianDisplayName: displayFromFullName(r.guardian_name as string | null),
        submittedAt: iso(r.created_at),
        chapterId: r.chapter_id as string,
        term: null,
      })),
    }
  }

  async getApplication(ctx: AuthContext, applicationId: string): Promise<ApplicationDetail> {
    const sql = this.sql
    const [app] = await sql`
      select id, status, chapter_id, applicant_name, guardian_name, guardian_email,
             created_at, student_section
      from application where id = ${applicationId}
    `
    if (app === undefined) throw new ApplicationNotFoundError(applicationId)
    await this.authorize(
      ctx,
      'application.read',
      { id: applicationId, chapter_id: app.chapter_id as string },
      { sql },
    )

    const [draft] = await sql`
      select parent_answers, student_answers
      from application_draft where converted_application_id = ${applicationId}
      order by created_at desc limit 1
    `
    const events = await sql`
      select from_status, to_status, at, note
      from application_event where application_id = ${applicationId}
      order by at asc
    `
    const stage2b =
      (draft?.student_answers as Record<string, unknown> | null) ??
      (app.student_section as Record<string, unknown> | null) ??
      {}
    return {
      applicationId: app.id as string,
      status: app.status as string,
      submittedAt: iso(app.created_at),
      chapterId: app.chapter_id as string,
      student: { displayName: displayFromFullName(app.applicant_name as string | null) },
      guardian: {
        displayName: displayFromFullName(app.guardian_name as string | null),
        email: (app.guardian_email as string | null) ?? null,
      },
      answers: {
        stage2a: (draft?.parent_answers as Record<string, unknown> | null) ?? {},
        stage2b,
        stage2c: null,
      },
      history: events.map((e) => ({
        from: (e.from_status as string | null) ?? null,
        to: e.to_status as string,
        at: iso(e.at),
        note: (e.note as string | null) ?? null,
      })),
    }
  }

  // ---- invites ------------------------------------------------------------
  // An invite carries no chapter_id column; its chapter is the bound enrollment's
  // chapter (guardian/student invites) or the issuer's chapter membership
  // (mentor/staff invites). The raw token / token_hash is NEVER returned.

  async listInvites(
    ctx: AuthContext,
    query: ChapterScopedQuery = {},
  ): Promise<{ items: InviteListItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'invite.read', query.chapterId)
    const sql = this.sql
    const rows = await sql`
      select i.id, i.kind, i.target_email, i.status, i.expires_at, i.created_at,
             i.intended_account_id, (i.expires_at <= now()) as is_expired
      from invite i
      left join enrollment_record e on e.id = i.enrollment_record_id
      left join lateral (
        select m.chapter_id from membership m
        where m.account_id = i.issued_by
          and m.role in ('chapter_director', 'comms_associate') and m.status = 'active'
        limit 1
      ) im on true
      where ${
        chapters === null
          ? sql`true`
          : sql`coalesce(e.chapter_id, im.chapter_id) in ${sql(chapters)}`
      }
      order by i.created_at desc
    `
    return {
      items: rows.map((r) => ({
        inviteId: r.id as string,
        kind: r.kind as string,
        targetEmail: (r.target_email as string | null) ?? null,
        status: inviteStatus(r.status as string, r.is_expired as boolean),
        issuedAt: iso(r.created_at),
        expiresAt: iso(r.expires_at),
        acceptedAccountId: (r.intended_account_id as string | null) ?? null,
      })),
    }
  }

  // ---- memberships (roster) ----------------------------------------------

  async listMemberships(
    ctx: AuthContext,
    query: MembershipListQuery = {},
  ): Promise<{ items: MembershipListItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'membership.read', query.chapterId)
    const statuses = query.statuses && query.statuses.length > 0 ? query.statuses : null
    const roles = query.roles && query.roles.length > 0 ? query.roles : null
    const sql = this.sql
    const rows = await sql`
      select m.id, m.account_id, ac.display_name, m.role, m.status, m.current_tier,
             m.pod_id, m.created_at
      from membership m
      join account ac on ac.id = m.account_id
      where ${chapters === null ? sql`true` : sql`m.chapter_id in ${sql(chapters)}`}
        ${statuses ? sql`and m.status in ${sql(statuses)}` : sql``}
        ${roles ? sql`and m.role in ${sql(roles)}` : sql``}
      order by m.created_at desc
    `
    return {
      items: rows.map((r) => ({
        membershipId: r.id as string,
        accountId: r.account_id as string,
        displayName: r.display_name as string,
        role: r.role as string,
        status: r.status as string,
        tier: (r.current_tier as string | null) ?? null,
        podId: (r.pod_id as string | null) ?? null,
        joinedAt: iso(r.created_at),
      })),
    }
  }

  // ---- guardianships (the name-match surface) -----------------------------

  async listGuardianships(
    ctx: AuthContext,
    query: ChapterScopedQuery = {},
  ): Promise<{ items: GuardianshipListItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'guardianship.read', query.chapterId)
    const sql = this.sql
    const rows = await sql`
      select g.id, g.status, g.created_at,
             gac.display_name as guardian_display, gac.legal_name as guardian_legal,
             sac.display_name as student_display,
             e.guardian_name_on_form as name_on_form
      from guardianship g
      join account gac on gac.id = g.guardian_account_id
      join account sac on sac.id = g.student_account_id
      join lateral (
        select chapter_id, guardian_name_on_form from enrollment_record
        where student_account_id = g.student_account_id
        order by created_at desc limit 1
      ) e on true
      where ${chapters === null ? sql`true` : sql`e.chapter_id in ${sql(chapters)}`}
      order by g.created_at desc
    `
    return {
      items: rows.map((r) => ({
        guardianshipId: r.id as string,
        status: r.status as string,
        guardianDisplayName: r.guardian_display as string,
        guardianNameOnAccount: r.guardian_legal as string,
        studentDisplayName: r.student_display as string,
        nameOnForm: r.name_on_form as string,
        createdAt: iso(r.created_at),
      })),
    }
  }

  // ---- media review queue (reuses media.review) ---------------------------

  async listMediaReviewQueue(
    ctx: AuthContext,
    query: ChapterScopedQuery = {},
  ): Promise<{ items: MediaReviewItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'media.review', query.chapterId)
    const sql = this.sql
    const rows = await sql`
      select pm.id, pm.project_id, p.title, pm.review_status, pm.storage_ref, pm.created_at
      from project_media pm
      join project p on p.id = pm.project_id
      where ${chapters === null ? sql`true` : sql`p.chapter_id in ${sql(chapters)}`}
        and pm.review_status = 'pending_review'
      order by pm.created_at desc
    `
    const mediaIds = rows.map((r) => r.id as string)
    const depByMedia = new Map<string, MediaDepictionView[]>()
    if (mediaIds.length > 0) {
      const deps = await sql`
        select d.media_id, d.account_id, ac.display_name,
               (d.confirmed_at is not null) as confirmed
        from media_depiction d
        join account ac on ac.id = d.account_id
        where d.media_id in ${sql(mediaIds)}
      `
      for (const d of deps) {
        const key = d.media_id as string
        const list = depByMedia.get(key) ?? []
        list.push({
          accountId: d.account_id as string,
          displayName: d.display_name as string,
          confirmed: d.confirmed as boolean,
        })
        depByMedia.set(key, list)
      }
    }
    return {
      items: rows.map((r) => ({
        mediaId: r.id as string,
        projectId: (r.project_id as string | null) ?? null,
        projectTitle: (r.title as string | null) ?? null,
        reviewStatus: r.review_status as string,
        storageRef: r.storage_ref as string,
        depictions: depByMedia.get(r.id as string) ?? [],
        submittedAt: iso(r.created_at),
      })),
    }
  }

  // ---- deletion / export requests -----------------------------------------

  async listDeletionRequests(
    ctx: AuthContext,
    query: ChapterScopedQuery = {},
  ): Promise<{ items: DeletionRequestItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'deletion.read', query.chapterId)
    const sql = this.sql
    const rows = await sql`
      select dr.id, dr.subject_account_id, ac.display_name, dr.status, dr.created_at
      from deletion_request dr
      join account ac on ac.id = dr.subject_account_id
      join lateral (
        select chapter_id from enrollment_record
        where student_account_id = dr.subject_account_id
        order by created_at desc limit 1
      ) e on true
      where ${chapters === null ? sql`true` : sql`e.chapter_id in ${sql(chapters)}`}
      order by dr.created_at desc
    `
    return {
      items: rows.map((r) => ({
        deletionRequestId: r.id as string,
        subjectAccountId: r.subject_account_id as string,
        subjectDisplayName: r.display_name as string,
        status: r.status as string,
        requestedAt: iso(r.created_at),
      })),
    }
  }

  async listExportRequests(
    ctx: AuthContext,
    query: ChapterScopedQuery = {},
  ): Promise<{ items: ExportRequestItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'export.read', query.chapterId)
    const sql = this.sql
    const rows = await sql`
      select er.id, er.subject_account_id, ac.display_name, er.status, er.created_at
      from export_request er
      join account ac on ac.id = er.subject_account_id
      join lateral (
        select chapter_id from enrollment_record
        where student_account_id = er.subject_account_id
        order by created_at desc limit 1
      ) e on true
      where ${chapters === null ? sql`true` : sql`e.chapter_id in ${sql(chapters)}`}
      order by er.created_at desc
    `
    return {
      items: rows.map((r) => ({
        exportRequestId: r.id as string,
        subjectAccountId: r.subject_account_id as string,
        subjectDisplayName: r.display_name as string,
        status: r.status as string,
        requestedAt: iso(r.created_at),
      })),
    }
  }

  // ---- enrollments --------------------------------------------------------

  async listEnrollments(
    ctx: AuthContext,
    query: ChapterScopedQuery = {},
  ): Promise<{ items: EnrollmentListItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'enrollment.read', query.chapterId)
    const sql = this.sql
    const rows = await sql`
      select er.id, er.application_id, er.student_account_id, er.term_id,
             t.name as term_name, er.guardian_name_on_form, er.form_signed_at,
             ac.display_name as account_display, app.applicant_name
      from enrollment_record er
      join term t on t.id = er.term_id
      join application app on app.id = er.application_id
      left join account ac on ac.id = er.student_account_id
      where ${chapters === null ? sql`true` : sql`er.chapter_id in ${sql(chapters)}`}
      order by er.created_at desc
    `
    return {
      items: rows.map((r) => ({
        enrollmentRecordId: r.id as string,
        applicationId: r.application_id as string,
        studentDisplayName:
          (r.account_display as string | null) ??
          displayFromFullName(r.applicant_name as string | null),
        termId: r.term_id as string,
        termName: (r.term_name as string | null) ?? null,
        guardianNameOnForm: r.guardian_name_on_form as string,
        signatureDate: (r.form_signed_at as string | null) ?? null,
        hasAccount: r.student_account_id != null,
      })),
    }
  }

  // ---- pods / terms -------------------------------------------------------

  async listPods(
    ctx: AuthContext,
    query: ChapterScopedQuery = {},
  ): Promise<{ items: PodListItem[] }> {
    const chapters = await this.resolveChapters(ctx, 'pod.read', query.chapterId)
    const sql = this.sql
    const rows = await sql`
      select p.id, p.name, p.term_id, p.mentor_membership_id,
             ac.display_name as mentor_display,
             (select count(*)::int from pod_assignment pa where pa.pod_id = p.id) as member_count
      from pod p
      left join membership mm on mm.id = p.mentor_membership_id
      left join account ac on ac.id = mm.account_id
      where ${chapters === null ? sql`true` : sql`p.chapter_id in ${sql(chapters)}`}
      order by p.created_at desc
    `
    return {
      items: rows.map((r) => ({
        podId: r.id as string,
        name: r.name as string,
        termId: r.term_id as string,
        mentorMembershipId: (r.mentor_membership_id as string | null) ?? null,
        mentorDisplayName: (r.mentor_display as string | null) ?? null,
        memberCount: Number(r.member_count),
      })),
    }
  }

  async listTerms(
    ctx: AuthContext,
    query: ChapterScopedQuery = {},
  ): Promise<{ items: TermListItem[] }> {
    // Terms are org-structure reads gated with pods on pod.read (a director's own
    // chapter; platform_admin via the override).
    const chapters = await this.resolveChapters(ctx, 'pod.read', query.chapterId)
    const sql = this.sql
    const rows = await sql`
      select t.id, t.name, t.starts_on, t.ends_on
      from term t
      where ${chapters === null ? sql`true` : sql`t.chapter_id in ${sql(chapters)}`}
      order by t.starts_on desc
    `
    return {
      items: rows.map((r) => ({
        termId: r.id as string,
        name: r.name as string,
        startsOn: r.starts_on as string,
        endsOn: r.ends_on as string,
      })),
    }
  }

  // ---- dashboard ----------------------------------------------------------

  async dashboard(ctx: AuthContext, query: ChapterScopedQuery = {}): Promise<DashboardSummary> {
    // The count-card summary is a chapter-scoped director read; gate on
    // application.read (every director read capability is equivalent — same scope
    // and role floor — so any one gates the aggregate view).
    const chapters = await this.resolveChapters(ctx, 'application.read', query.chapterId)
    const sql = this.sql

    const [apps] = await sql`
      select count(*)::int as n from application a
      where ${chapters === null ? sql`true` : sql`a.chapter_id in ${sql(chapters)}`}
        and a.status = 'submitted'
    `
    const [invites] = await sql`
      select count(*)::int as n
      from invite i
      left join enrollment_record e on e.id = i.enrollment_record_id
      left join lateral (
        select m.chapter_id from membership m
        where m.account_id = i.issued_by
          and m.role in ('chapter_director', 'comms_associate') and m.status = 'active'
        limit 1
      ) im on true
      where ${
        chapters === null
          ? sql`true`
          : sql`coalesce(e.chapter_id, im.chapter_id) in ${sql(chapters)}`
      } and i.status = 'issued' and i.expires_at > now()
    `
    const [guardianships] = await sql`
      select count(*)::int as n
      from guardianship g
      join lateral (
        select chapter_id from enrollment_record
        where student_account_id = g.student_account_id
        order by created_at desc limit 1
      ) e on true
      where ${chapters === null ? sql`true` : sql`e.chapter_id in ${sql(chapters)}`}
        and g.status = 'pending'
    `
    const [media] = await sql`
      select count(*)::int as n
      from project_media pm join project p on p.id = pm.project_id
      where ${chapters === null ? sql`true` : sql`p.chapter_id in ${sql(chapters)}`}
        and pm.review_status = 'pending_review'
    `
    const [deletions] = await sql`
      select count(*)::int as n
      from deletion_request dr
      join lateral (
        select chapter_id from enrollment_record
        where student_account_id = dr.subject_account_id
        order by created_at desc limit 1
      ) e on true
      where ${chapters === null ? sql`true` : sql`e.chapter_id in ${sql(chapters)}`}
        and dr.status in ('requested', 'under_review')
    `
    const [exports] = await sql`
      select count(*)::int as n
      from export_request er
      join lateral (
        select chapter_id from enrollment_record
        where student_account_id = er.subject_account_id
        order by created_at desc limit 1
      ) e on true
      where ${chapters === null ? sql`true` : sql`e.chapter_id in ${sql(chapters)}`}
        and er.status = 'requested'
    `
    const [members] = await sql`
      select count(*)::int as n from membership m
      where ${chapters === null ? sql`true` : sql`m.chapter_id in ${sql(chapters)}`}
        and m.status = 'active'
    `
    return {
      newApplications: Number(apps!.n),
      pendingInvites: Number(invites!.n),
      guardianshipsToVerify: Number(guardianships!.n),
      mediaToReview: Number(media!.n),
      openRequests: Number(deletions!.n) + Number(exports!.n),
      activeMembers: Number(members!.n),
    }
  }
}

/** Map the DB invite status (+ decision-time expiry) to the portal's status. */
function inviteStatus(
  raw: string,
  isExpired: boolean,
): 'pending' | 'accepted' | 'expired' | 'superseded' {
  switch (raw) {
    case 'accepted':
      return 'accepted'
    case 'revoked':
      return 'superseded'
    case 'expired':
      return 'expired'
    case 'issued':
    default:
      return isExpired ? 'expired' : 'pending'
  }
}
