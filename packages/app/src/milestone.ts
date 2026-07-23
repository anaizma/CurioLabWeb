// -------------------------------------------------------------------------
// MilestoneService — Milestone 2.5: system-generated milestones and the timeline
// (the empty-state solution). Lifecycle transitions (student activation, the
// initial Explorer tier grant, tier transitions, the first project or mentor
// session) emit a `timeline_entry` and a `system_generated` milestone `post`, so
// a brand-new profile and feed read as populated rather than blank
// (02-data-model.md timeline_entry / post; 04-state-machines.md "milestone posts
// are system_generated and skip the consent gate").
//
// `emit` is the SYSTEM emitter. It has no actor and does NOT go through
// `authorize` — it is a side effect of an already-authorized transition, so it
// does not itself record or assert an authorization decision. It writes IN THE
// CALLER'S transaction (the handle is passed in) so it composes atomically inside
// a coupling: if the transition rolls back, its milestones roll back with it.
//
// The `post.author_membership_id` column is NOT NULL, and a milestone is about a
// subject rather than authored by an actor, so a milestone post is authored by
// the SUBJECT's own membership (the student whose timeline it is). This is the
// only path that mints `type = 'milestone'` / `system_generated = true` rows; the
// member-authored `PostService.create` refuses both (milestone-2.md §M2.2).
// -------------------------------------------------------------------------

import type { TransactionSql } from 'postgres'

/** The `timeline_entry.kind` for the "Joined CurioLab" seed milestone. */
export const MILESTONE_JOINED_KIND = 'joined'
/** The `timeline_entry.kind` for a "Reached <tier>" milestone. */
export const MILESTONE_TIER_KIND = 'tier_reached'

/** The body of the "Joined CurioLab" seed milestone post. */
export const MILESTONE_JOINED_BODY = 'Joined CurioLab'

/** The milestone post body for reaching `tier` (e.g. 'explorer' -> "Reached Explorer"). */
export function tierMilestoneBody(tier: string): string {
  return `Reached ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`
}

export interface EmitMilestoneParams {
  /** The subject account whose timeline this entry belongs to. */
  accountId: string
  /** The subject membership that authors the milestone post (author_membership_id is NOT NULL). */
  membershipId: string
  /** The append-only `timeline_entry.kind`. */
  kind: string
  /** The chapter the milestone post is scoped to. */
  chapterId: string
  /** The pod the milestone post is scoped to, if any. */
  podId?: string | null
  /** The instant the milestone occurred (the `timeline_entry.occurred_at`). */
  occurredAt: Date
  /** The milestone post body (the human-readable milestone text). */
  body: string
  /** An optional pointer the timeline_entry references (e.g. the tier_transition id). */
  ref?: string | null
}

export interface EmitMilestoneResult {
  timelineEntryId: string
  postId: string
}

export class MilestoneService {
  /**
   * Emit one milestone: an append-only `timeline_entry` and a `system_generated`
   * milestone `post`, both written in the caller's transaction `tx`. The post is
   * `type = 'milestone'`, `system_generated = true`, `status = 'published'`, and
   * authored by the subject's `membershipId`. No `authorize` and no
   * `assertAuthorized()` here — the emitter is a side effect of a transition the
   * caller has already authorized; the caller owns the transaction and its
   * decision record.
   */
  async emit(tx: TransactionSql, params: EmitMilestoneParams): Promise<EmitMilestoneResult> {
    const podId = params.podId ?? null
    const ref = params.ref ?? null

    const [te] = await tx`
      insert into timeline_entry (account_id, kind, occurred_at, ref)
      values (${params.accountId}, ${params.kind}, ${params.occurredAt}, ${ref})
      returning id
    `

    const [post] = await tx`
      insert into post (
        chapter_id, pod_id, author_membership_id, type, body, status, system_generated
      ) values (
        ${params.chapterId}, ${podId}, ${params.membershipId}, 'milestone', ${params.body}, 'published', true
      )
      returning id
    `

    return { timelineEntryId: te!.id as string, postId: post!.id as string }
  }
}
