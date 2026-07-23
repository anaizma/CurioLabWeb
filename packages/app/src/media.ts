// -------------------------------------------------------------------------
// MediaService — Milestone 3.4: project media and the photo-review policy, plus
// coupling C1 (photo_media revoke -> depicting media re-review) wired into the
// consent revoke seam.
//
// The media policy (02-data-model.md project_media / media_depiction):
//   - a STUDENT may attach images of their OWN work, defaulting
//     review_status = 'pending_review' (the safe default), and may add
//     media_depiction hints that a person is in the image — but student-source
//     depictions (source='student') are UNCONFIRMED and cannot authoritatively
//     tag anyone;
//   - only a mentor/staff confirmation (source in ('mentor','staff'),
//     confirmed_at set) authoritatively tags who is in an image;
//   - a media is clearable for photo_media-gated public use ONLY when EVERY
//     depicted account has an active `photo_media` consent AND every depiction is
//     mentor/staff-confirmed (`isClearedForPublicUse`).
//
// Authorization (03-authorization.md):
//   - attach is `project.submit` (scope 'own', role 'student') — the
//     ownership-of-the-project capability, so a student attaches to their OWN
//     work only (attach is project.create-adjacent; it reuses the existing
//     own-scoped student capability rather than minting a new one);
//   - confirmDepiction / clear / remove are `media.review` (mentor/staff).
//
// Coupling C1 (04-state-machines.md): revoking `photo_media` for a student flips
// every project_media that depicts them to `pending_review` in the SAME
// transaction as the revoke, through ConsentService's `onRevoke` seam (which runs
// inside the revoke transaction under the `consent_current` FOR UPDATE lock).
// `mediaPhotoMediaRevokeCascade` is the C1 implementation; it dispatches on the
// consent TYPE (a no-op for anything but `photo_media`), and `composeRevokeCascades`
// composes it with the C2 project de-list so one seam carries both couplings.
//
// Framework-agnostic: the db handle and `authorize` are injected; the HTTP routes
// (M3.7) are wired later.
// -------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource } from '@curiolab/core'
import { assertAuthorized, type AuthorizeDeps } from '@curiolab/runtime'
import type { RevokeCascade } from './consent.js'
import { MediaNotClearableError, MediaNotFoundError, ProjectNotFoundError } from './errors.js'

/**
 * The injected `authorize` dependency, narrowed to this service's capabilities
 * (structurally the runtime `authorize` wrapper; taken by injection so the
 * deny/backstop paths are testable without HTTP). `project.submit` gates the
 * student attach (ownership of the project); `media.review` gates the reviewer
 * confirm/clear/remove.
 */
export type MediaAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: 'project.submit' | 'media.review',
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface MediaServiceDeps {
  sql: Sql
  authorize: MediaAuthorizeFn
}

export interface AttachDepictionInput {
  /** The account depicted. A student-source hint; unconfirmed until a reviewer confirms. */
  accountId: string
}

export interface AttachMediaInput {
  /** The project the media hangs off; its owner is the `own`-scope subject. */
  projectId: string
  /** The object-store reference (uuid). */
  storageRef: string
  /** Optional student-source depiction hints. */
  depictions?: AttachDepictionInput[]
}

export interface AttachMediaResult {
  mediaId: string
  reviewStatus: string
}

export interface MediaReviewResult {
  mediaId: string
  reviewStatus: string
}

export interface ConfirmDepictionResult {
  mediaId: string
  accountId: string
  source: 'mentor' | 'staff'
}

/** The project facts a media decision needs: the owner (own scope) and chapter/pod. */
interface MediaProjectRow {
  projectId: string
  chapterId: string
  ownerPodId: string | null
  ownerAccountId: string
}

/**
 * Coupling C1 (04-state-machines): the content consequence of a `photo_media`
 * revoke. Called inside the revoke transaction (holding the student's
 * `consent_current` FOR UPDATE lock) via ConsentService's `onRevoke` seam,
 * BEFORE the revoke row commits. Every project_media that depicts the student is
 * flipped back to `review_status = 'pending_review'` in the SAME transaction, so
 * a cleared image can no longer be shown while consent is withdrawn. A
 * terminally `removed` media is left untouched (removed is a terminal moderation
 * state, and pending_review would be a less restrictive state). A no-op for any
 * other consent type (C2 external_publication is a separate cascade).
 */
export const mediaPhotoMediaRevokeCascade: RevokeCascade = async (
  tx: Sql | TransactionSql,
  args: { studentAccountId: string; type: string; scopeRef: string | null },
): Promise<void> => {
  if (args.type !== 'photo_media') return
  await tx`
    update project_media
    set review_status = 'pending_review'
    where review_status <> 'removed'
      and id in (
        select media_id from media_depiction where account_id = ${args.studentAccountId}
      )
  `
}

/**
 * Compose several `RevokeCascade`s into one that dispatches by consent TYPE: each
 * composed cascade guards on `args.type` and is a no-op for a non-matching type,
 * so running them in sequence lets the single `onRevoke` seam carry both C1
 * (photo_media -> media re-review) and C2 (external_publication -> project
 * de-list) while keeping each independently testable. Runs in the caller's
 * transaction; any throw aborts the whole revoke.
 */
export function composeRevokeCascades(...cascades: RevokeCascade[]): RevokeCascade {
  return async (tx, args) => {
    for (const cascade of cascades) {
      await cascade(tx, args)
    }
  }
}

export class MediaService {
  private readonly sql: Sql
  private readonly authorize: MediaAuthorizeFn

  constructor(deps: MediaServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /** Load the project facts a media decision needs (owner + chapter/pod). */
  private async loadProject(projectId: string): Promise<MediaProjectRow> {
    const [row] = await this.sql`
      select p.id, p.chapter_id, m.pod_id as owner_pod_id, m.account_id as owner_account_id
      from project p
      join membership m on m.id = p.owner_membership_id
      where p.id = ${projectId}
    `
    if (row === undefined) throw new ProjectNotFoundError(projectId)
    return {
      projectId: row.id as string,
      chapterId: row.chapter_id as string,
      ownerPodId: (row.owner_pod_id as string | null) ?? null,
      ownerAccountId: row.owner_account_id as string,
    }
  }

  /** Load the project facts behind a media row (for the media.review scope). */
  private async loadMediaProject(mediaId: string): Promise<MediaProjectRow> {
    const [row] = await this.sql`
      select p.id, p.chapter_id, m.pod_id as owner_pod_id, m.account_id as owner_account_id
      from project_media pm
      join project p on p.id = pm.project_id
      join membership m on m.id = p.owner_membership_id
      where pm.id = ${mediaId}
    `
    if (row === undefined) throw new MediaNotFoundError(mediaId)
    return {
      projectId: row.id as string,
      chapterId: row.chapter_id as string,
      ownerPodId: (row.owner_pod_id as string | null) ?? null,
      ownerAccountId: row.owner_account_id as string,
    }
  }

  /**
   * Attach media to the actor's OWN project (`project.submit`, own scope, student
   * role). The row defaults `review_status = 'pending_review'` (the safe default),
   * and each depiction is a STUDENT-source hint (`source = 'student'`, `confirmed_at`
   * null) — unconfirmed until a mentor/staff confirms it. `can` gates the ownership
   * floor (the acting student owns the project); a student attaching to someone
   * else's project is out_of_scope.
   */
  async attach(input: AttachMediaInput, ctx: AuthContext): Promise<AttachMediaResult> {
    const p = await this.loadProject(input.projectId)
    // `own` scope: the owner student is the project's owning membership account.
    const resource: Resource = {
      id: p.projectId,
      chapter_id: p.chapterId,
      ownerAccountId: p.ownerAccountId,
    }
    await this.authorize(ctx, 'project.submit', resource, { sql: this.sql })

    const depictions = input.depictions ?? []
    return this.sql.begin(async (tx) => {
      assertAuthorized() // runtime backstop: no mutation without a recorded decision
      const [media] = await tx`
        insert into project_media (project_id, storage_ref, review_status)
        values (${input.projectId}, ${input.storageRef}, 'pending_review')
        returning id, review_status
      `
      const mediaId = media!.id as string
      for (const d of depictions) {
        await tx`
          insert into media_depiction (media_id, account_id, added_by, source, confirmed_at)
          values (${mediaId}, ${d.accountId}, ${ctx.account.id}, 'student', ${null})
        `
      }
      return { mediaId, reviewStatus: media!.review_status as string }
    }) as Promise<AttachMediaResult>
  }

  /**
   * Confirm a depiction (`media.review`, mentor/staff): authoritatively tag who is
   * in the image. Sets the depiction `source` (mentor or staff, per the actor) and
   * stamps `confirmed_at`. This is what a student cannot do — a student-source hint
   * stays unconfirmed. Confirmation alone does not clear the image; the
   * consent+confirmation rule is checked at `clear`.
   */
  async confirmDepiction(
    mediaId: string,
    accountId: string,
    ctx: AuthContext,
  ): Promise<ConfirmDepictionResult> {
    const p = await this.loadMediaProject(mediaId)
    const resource: Resource = { id: mediaId, chapter_id: p.chapterId, pod_id: p.ownerPodId }
    await this.authorize(ctx, 'media.review', resource, { sql: this.sql })

    const source = this.confirmingSource(ctx)
    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update media_depiction
        set source = ${source}, confirmed_at = now()
        where media_id = ${mediaId} and account_id = ${accountId}
        returning account_id
      `
      if (rows.length === 0) throw new MediaNotFoundError(mediaId)
      return { mediaId, accountId, source }
    }) as Promise<ConfirmDepictionResult>
  }

  /**
   * Clear a media for photo_media-gated public use (`media.review`): move
   * `review_status -> 'ok'`, ONLY when `isClearedForPublicUse` holds (every
   * depicted account has an active `photo_media` consent AND every depiction is
   * mentor/staff-confirmed). Otherwise the media stays as-is and a
   * MediaNotClearableError is raised (the actor is an authorized reviewer; this is
   * a policy refusal, not a permission denial).
   */
  async clear(mediaId: string, ctx: AuthContext): Promise<MediaReviewResult> {
    const p = await this.loadMediaProject(mediaId)
    const resource: Resource = { id: mediaId, chapter_id: p.chapterId, pod_id: p.ownerPodId }
    await this.authorize(ctx, 'media.review', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      if (!(await this.clearedForPublicUse(tx, mediaId))) {
        throw new MediaNotClearableError(mediaId)
      }
      const rows = await tx`
        update project_media set review_status = 'ok'
        where id = ${mediaId} and review_status <> 'removed'
        returning id
      `
      if (rows.length === 0) throw new MediaNotFoundError(mediaId)
      return { mediaId, reviewStatus: 'ok' }
    }) as Promise<MediaReviewResult>
  }

  /** Remove a media (`media.review`): terminal `review_status -> 'removed'`. */
  async remove(mediaId: string, ctx: AuthContext): Promise<MediaReviewResult> {
    const p = await this.loadMediaProject(mediaId)
    const resource: Resource = { id: mediaId, chapter_id: p.chapterId, pod_id: p.ownerPodId }
    await this.authorize(ctx, 'media.review', resource, { sql: this.sql })

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      const rows = await tx`
        update project_media set review_status = 'removed'
        where id = ${mediaId}
        returning id
      `
      if (rows.length === 0) throw new MediaNotFoundError(mediaId)
      return { mediaId, reviewStatus: 'removed' }
    }) as Promise<MediaReviewResult>
  }

  /**
   * The media policy rule, encoding "clearable for photo_media-gated use": there
   * is NO depiction that is unconfirmed, student-source, or whose depicted account
   * lacks an active `photo_media` consent. A media with no depictions of people is
   * vacuously clearable (nobody's photo consent is at stake). Used by the clear
   * path and available to later publish paths.
   */
  async isClearedForPublicUse(mediaId: string): Promise<boolean> {
    return this.clearedForPublicUse(this.sql, mediaId)
  }

  private async clearedForPublicUse(db: Sql | TransactionSql, mediaId: string): Promise<boolean> {
    const [row] = await db`
      select not exists (
        select 1 from media_depiction d
        where d.media_id = ${mediaId}
          and (
            d.confirmed_at is null
            or d.source = 'student'
            or not exists (
              select 1 from consent_current cc
              where cc.student_account_id = d.account_id
                and cc.type = 'photo_media'
                and cc.active = true
            )
          )
      ) as cleared
    `
    return row!.cleared as boolean
  }

  /**
   * Which source a confirmation records: `staff` for a platform actor, `mentor`
   * for a chapter teaching membership. Both clear an image (the media policy only
   * requires `source in ('mentor','staff')`); the distinction records capacity.
   */
  private confirmingSource(ctx: AuthContext): 'mentor' | 'staff' {
    const isPlatform = ctx.memberships.some(
      (m) => m.role === 'platform_admin' || m.role === 'platform_staff',
    )
    return isPlatform ? 'staff' : 'mentor'
  }
}
