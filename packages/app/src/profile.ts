// -------------------------------------------------------------------------
// ProfileService — Milestone 3.3: the student profile. Compose the VERIFIED
// record (active membership + current_tier, the subject's verified/public_listed
// projects, timeline entries, a mentor-hours placeholder) PLUS the PUBLISHED
// narrative, and drive the narrative lifecycle
// (draft/pending_review/published/removed).
//
// The empty-state-in-the-model rule (02-data-model.md "timeline_entry ... which
// is how a new profile reads as complete rather than empty"; 04-state-machines):
// every tier-appropriate section is present BY DEFAULT with an honest zero-state
// (an empty array, a zero count) — a brand-new Explorer's profile is complete,
// never a set of omitted sections.
//
// Every method is gated through the injected `authorize` wrapper over `can`
// (03-authorization.md):
//   - view: student.view_record when STAFF read a student's record (logsRead: an
//     out-of-pod minor read writes one transactional minor_record.read), or
//     profile.view when the subject views their OWN profile (own scope, no read
//     log of one's own record). 05-api-surface GET /profile/:id names both.
//   - editNarrative: profile.edit_narrative (own; a guardian NEVER authors). A
//     MINOR's edit lands `pending_review` (not publicly reachable until reviewed);
//     an ADULT (18+) self-edit publishes directly. Upsert of the subject's narrative.
//   - reviewNarrative: narrative.review (lead/director) — `pending_review ->
//     published`, clearing a minor's narrative for public reach.
//   - removeNarrative: narrative.remove (staff moderation) — `-> removed`.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP routes
// (M3.7) are wired later.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import type { Db } from './events.js'
import {
  IllegalNarrativeTransitionError,
  NarrativeNotFoundError,
  ProfileSubjectNotFoundError,
} from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's capabilities
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop/obligation paths are testable without HTTP).
 */
export type ProfileAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability:
    | 'profile.view'
    | 'student.view_record'
    | 'profile.edit_narrative'
    | 'narrative.review'
    | 'narrative.remove',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface ProfileServiceDeps {
  sql: Sql
  authorize: ProfileAuthorizeFn
}

/** One verified/public_listed project on the profile (title + date). */
export interface ProfileProjectView {
  projectId: string
  title: string
  status: 'verified' | 'public_listed'
  verifiedAt: string | null
}

/** One timeline entry — the profile spine (02-data-model.md timeline_entry). */
export interface ProfileTimelineView {
  kind: string
  occurredAt: string
  ref: string | null
}

/** The subject's active membership summary (the tier-bearing standing). */
export interface ProfileMembershipView {
  role: string
  status: string
  chapterId: string
  podId: string | null
  currentTier: string | null
}

/**
 * The composed profile: verified data + the published narrative. Sections are
 * ALWAYS present (honest zero-states), never omitted — the empty-state property.
 */
export interface ProfileView {
  subjectAccountId: string
  /** first name + last initial (02-data-model.md; legal_name is never rendered). */
  displayName: string
  /** The tier reached (the active student membership's current_tier). */
  tier: string | null
  membership: ProfileMembershipView | null
  /** Verified + public_listed projects (titles + dates). Honest [] zero-state. */
  projects: ProfileProjectView[]
  /** Timeline entries. Honest [] zero-state. */
  timeline: ProfileTimelineView[]
  /** Mentor-hours placeholder — an honest zero until the mentor-hours source lands. */
  mentorHours: number
  /** The PUBLISHED narrative only (pending_review/draft/removed never surface). */
  narrative: { narrativeId: string; body: string } | null
}

export interface EditNarrativeResult {
  narrativeId: string
  accountId: string
  status: 'pending_review' | 'published'
}

export interface NarrativeStatusResult {
  narrativeId: string
  accountId: string
  status: 'published' | 'removed'
}

interface SubjectFacts {
  displayName: string
  age: number
  /** The active student pod — the "minor outside the actor's pod" read-log bit. */
  podId: string | null
  /** The enrolling chapter (most recent active membership). */
  chapterId: string | null
}

interface NarrativeRow {
  id: string
  accountId: string
  status: string
}

/** Whole years from `dob` to `at` (birthday-aware, UTC). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

/** A timestamptz column (a JS Date from `postgres`) as an ISO string, or null. */
function isoOrNull(value: unknown): string | null {
  return value == null ? null : new Date(value as string | Date).toISOString()
}

export class ProfileService {
  private readonly sql: Sql
  private readonly authorize: ProfileAuthorizeFn

  constructor(deps: ProfileServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * Load the subject facts `can` needs (display name for the render, age for the
   * guardian/minor bound, pod for the read-log, chapter for scope). Loaded BEFORE
   * `authorize` because the decision depends on the subject's pod/chapter/age —
   * the same ordering as GuardianPortalService.loadSubject.
   */
  private async loadSubject(subjectAccountId: string): Promise<SubjectFacts> {
    const [row] = await this.sql`
      select
        a.display_name as display_name,
        a.date_of_birth as dob,
        (
          select m.pod_id from membership m
          where m.account_id = a.id and m.status = 'active' and m.role = 'student'
          order by m.created_at desc limit 1
        ) as pod_id,
        (
          select m.chapter_id from membership m
          where m.account_id = a.id and m.status = 'active'
          order by m.created_at desc limit 1
        ) as chapter_id
      from account a
      where a.id = ${subjectAccountId}
    `
    if (row === undefined) throw new ProfileSubjectNotFoundError(subjectAccountId)
    return {
      displayName: row.display_name as string,
      age: ageInYears(new Date(row.dob as string), new Date()),
      podId: (row.pod_id as string | null) ?? null,
      chapterId: (row.chapter_id as string | null) ?? null,
    }
  }

  /**
   * GET /profile/:id — the composed profile. STAFF read via student.view_record
   * (an out-of-pod minor read writes one transactional minor_record.read); the
   * subject reads their OWN profile via profile.view (own scope, no self read
   * log). The compose runs inside the `authorize` read seam, so any read-log
   * obligation shares the read's transaction (fails closed).
   */
  async view(subjectAccountId: string, ctx: AuthContext): Promise<ProfileView | undefined> {
    const s = await this.loadSubject(subjectAccountId)
    const read = (tx: Db): Promise<ProfileView> => this.compose(tx, subjectAccountId, s)

    if (ctx.account.id === subjectAccountId) {
      const resource: Resource = { ownerAccountId: subjectAccountId }
      return this.authorize<ProfileView>(ctx, 'profile.view', resource, { sql: this.sql, read })
    }

    const resource: Resource = {
      subjectAccountId,
      subjectAge: s.age,
      subjectIsMinor: s.age < 18,
      subjectPodId: s.podId,
      pod_id: s.podId,
      chapter_id: s.chapterId,
    }
    return this.authorize<ProfileView>(ctx, 'student.view_record', resource, { sql: this.sql, read })
  }

  private async compose(tx: Db, subjectAccountId: string, s: SubjectFacts): Promise<ProfileView> {
    const memberships = await tx`
      select role, status, chapter_id, pod_id, current_tier
      from membership
      where account_id = ${subjectAccountId} and status = 'active'
      order by created_at asc
    `
    const studentMem = memberships.find((m) => m.role === 'student') ?? memberships[0]

    const projects = await tx`
      select p.id, p.title, p.status, p.verified_at
      from project p
      join membership m on m.id = p.owner_membership_id
      where m.account_id = ${subjectAccountId} and p.status in ('verified', 'public_listed')
      order by p.verified_at desc nulls last, p.created_at desc
    `
    const timeline = await tx`
      select kind, occurred_at, ref
      from timeline_entry
      where account_id = ${subjectAccountId}
      order by occurred_at asc
    `
    const [narrative] = await tx`
      select id, body from profile_narrative
      where account_id = ${subjectAccountId} and status = 'published'
      order by created_at desc limit 1
    `

    return {
      subjectAccountId,
      displayName: s.displayName,
      tier: (studentMem?.current_tier as string | null) ?? null,
      membership: studentMem
        ? {
            role: studentMem.role as string,
            status: studentMem.status as string,
            chapterId: studentMem.chapter_id as string,
            podId: (studentMem.pod_id as string | null) ?? null,
            currentTier: (studentMem.current_tier as string | null) ?? null,
          }
        : null,
      projects: projects.map((p) => ({
        projectId: p.id as string,
        title: p.title as string,
        status: p.status as 'verified' | 'public_listed',
        verifiedAt: isoOrNull(p.verified_at),
      })),
      timeline: timeline.map((t) => ({
        kind: t.kind as string,
        occurredAt: isoOrNull(t.occurred_at) as string,
        ref: (t.ref as string | null) ?? null,
      })),
      mentorHours: 0, // honest zero placeholder — no mentor-hours source yet
      narrative:
        narrative === undefined
          ? null
          : { narrativeId: narrative.id as string, body: narrative.body as string },
    }
  }

  /**
   * PATCH /profile/narrative — profile.edit_narrative (own; a guardian never
   * authors, barred by the own-only scope). A MINOR's edit lands `pending_review`
   * and is NOT publicly reachable until narrative.review clears it; an ADULT
   * (18+) self-edit publishes directly. Upsert of the subject's (non-removed)
   * narrative. The minor/adult split reads the ACTOR's age — the actor is the
   * subject on the own path.
   */
  async editNarrative(
    subjectAccountId: string,
    body: string,
    ctx: AuthContext,
  ): Promise<EditNarrativeResult> {
    const status: 'pending_review' | 'published' =
      ctx.account.age < 18 ? 'pending_review' : 'published'
    const resource: Resource = { ownerAccountId: subjectAccountId }
    await this.authorize(ctx, 'profile.edit_narrative', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [existing] = await tx`
        select id from profile_narrative
        where account_id = ${subjectAccountId} and status <> 'removed'
        order by created_at desc limit 1
      `
      if (existing !== undefined) {
        const [u] = await tx`
          update profile_narrative set body = ${body}, status = ${status}
          where id = ${existing.id} returning id, status
        `
        return { narrativeId: u!.id as string, accountId: subjectAccountId, status: u!.status as EditNarrativeResult['status'] }
      }
      const [ins] = await tx`
        insert into profile_narrative (account_id, body, status)
        values (${subjectAccountId}, ${body}, ${status}) returning id, status
      `
      return { narrativeId: ins!.id as string, accountId: subjectAccountId, status: ins!.status as EditNarrativeResult['status'] }
    }) as Promise<EditNarrativeResult>
  }

  /**
   * POST /profile/narrative/:id/review — narrative.review (lead/director). Clears
   * a minor's narrative `pending_review -> published`. Chapter-scoped to the
   * subject's enrolling chapter. A guarded update rejects any non-pending source
   * as an illegal transition.
   */
  async reviewNarrative(narrativeId: string, ctx: AuthContext): Promise<NarrativeStatusResult> {
    const n = await this.loadNarrative(narrativeId)
    const chapterId = await this.resolveChapter(n.accountId)
    const resource: Resource = { id: narrativeId, chapter_id: chapterId }
    await this.authorize(ctx, 'narrative.review', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update profile_narrative set status = 'published'
        where id = ${narrativeId} and status = 'pending_review' returning id
      `
      if (rows.length === 0) throw new IllegalNarrativeTransitionError(n.status, 'published')
      return { narrativeId, accountId: n.accountId, status: 'published' as const }
    }) as Promise<NarrativeStatusResult>
  }

  /**
   * POST /profile/narrative/:id/remove — narrative.remove (staff moderation).
   * Moves a narrative `-> removed` from any non-removed state. Chapter-scoped to
   * the subject's enrolling chapter.
   */
  async removeNarrative(narrativeId: string, ctx: AuthContext): Promise<NarrativeStatusResult> {
    const n = await this.loadNarrative(narrativeId)
    const chapterId = await this.resolveChapter(n.accountId)
    const resource: Resource = { id: narrativeId, chapter_id: chapterId }
    await this.authorize(ctx, 'narrative.remove', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update profile_narrative set status = 'removed'
        where id = ${narrativeId} and status <> 'removed' returning id
      `
      if (rows.length === 0) throw new IllegalNarrativeTransitionError(n.status, 'removed')
      return { narrativeId, accountId: n.accountId, status: 'removed' as const }
    }) as Promise<NarrativeStatusResult>
  }

  private async loadNarrative(narrativeId: string): Promise<NarrativeRow> {
    const [row] = await this.sql`
      select id, account_id, status from profile_narrative where id = ${narrativeId}
    `
    if (row === undefined) throw new NarrativeNotFoundError(narrativeId)
    return { id: row.id as string, accountId: row.account_id as string, status: row.status as string }
  }

  /** The subject's enrolling chapter (most recent active membership), or null. */
  private async resolveChapter(accountId: string): Promise<string | null> {
    const [row] = await this.sql`
      select chapter_id from membership
      where account_id = ${accountId} and status = 'active'
      order by created_at desc limit 1
    `
    return (row?.chapter_id as string | null) ?? null
  }
}
