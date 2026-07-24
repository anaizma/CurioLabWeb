// -------------------------------------------------------------------------
// runEligibilitySweep — §6 mentor eligibility auto-revoke (admin/director backend,
// REVIEW-GATED). A PEER of runTimeBoxSweep (P5), not an extension of it.
//
// WHY A SEPARATE SWEEP (not folded into runTimeBoxSweep): the two sweeps trigger
// on DIFFERENT conditions (term end vs eligibility lapse), scope to different role
// sets (all privileged term-bound memberships vs the mentor/teaching roles that
// carry an eligibility requirement), and are gated independently — the time-box
// sweep always runs, this one only when MENTOR_ELIGIBILITY_ENFORCED is on. Folding
// them would conflate two reasons on one code path. They share the same closure
// mechanics (active -> inactive, clear pod links, system-actor audit +
// access_ledger) and the same access_ledger event, distinguished by `reason`
// (`term_ended` vs `eligibility_lapsed`) — as the P5 agent left room for.
//
// FLAG-GUARDED: when `mentorEligibilityEnforced` is false (the default, production
// posture), the sweep is a NO-OP and records nothing on eligibility grounds — a
// mentor's access is exactly as today until the legal flip. When true, every
// active mentor/teaching membership that is NOT currently eligible (any of the
// four components missing or expired as of `now`) is transitioned out of active,
// its pod links cleared, with reason `eligibility_lapsed` on the audit +
// access_ledger. Deterministic injected `now`. Idempotent — a re-run finds no
// still-`active` ineligible membership. A student membership is never touched.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { MENTOR_ELIGIBILITY_COMPONENTS, MENTOR_ELIGIBILITY_ROLES } from '@curiolab/core'
import { writeAudit, writeAccessLedger } from '@curiolab/runtime'
import { type AppConfig, defaultConfig } from './config.js'
import { TIME_BOX_AUDIT_ACTION } from './time-box-sweep.js'

export interface RunEligibilitySweepDeps {
  sql: Sql
}

export interface RunEligibilitySweepResult {
  /** The number of memberships eligibility-revoked (active -> inactive) this run. */
  revokedCount: number
  /** The ids of the memberships eligibility-revoked this run. */
  revokedMembershipIds: string[]
}

/** The `reason` written to audit + access_ledger for an eligibility auto-revoke. */
export const ELIGIBILITY_LAPSED_REASON = 'eligibility_lapsed'

/**
 * Run the mentor-eligibility auto-revoke sweep as of `now`. Behind the flag:
 * when `config.mentorEligibilityEnforced` is false (the default), returns an empty
 * result WITHOUT touching any row. When true, in one transaction, for every active
 * mentor/teaching membership that is not currently eligible:
 *   - transition `active -> inactive` (the "window elapsed" edge);
 *   - clear its pod links (delete pod_assignment rows, null membership.pod_id, and
 *     null any pod.mentor_membership_id pointing at it);
 *   - write a system-actor (actor = null) audit_entry + access_ledger row with
 *     reason `eligibility_lapsed`.
 * Returns the ids/count revoked. Idempotent (guarded on status='active').
 */
export async function runEligibilitySweep(
  deps: RunEligibilitySweepDeps,
  now: Date = new Date(),
  config: Partial<AppConfig> = {},
): Promise<RunEligibilitySweepResult> {
  const cfg = { ...defaultConfig, ...config }
  if (!cfg.mentorEligibilityEnforced) {
    return { revokedCount: 0, revokedMembershipIds: [] }
  }

  const roles = [...MENTOR_ELIGIBILITY_ROLES]
  const components = [...MENTOR_ELIGIBILITY_COMPONENTS]
  const required = components.length

  return (await deps.sql.begin(async (tx) => {
    // Active mentor/teaching memberships that are NOT currently eligible: fewer
    // than `required` components have a latest (per-component) row that is current
    // (non-expired) as of `now`. `for update` locks the row against a concurrent
    // activation. Rows with a role outside the eligibility set are ignored.
    const targets = await tx`
      with latest as (
        select distinct on (membership_id, component)
          membership_id, component, expires_at
        from mentor_eligibility
        order by membership_id, component, seq desc
      )
      select m.id, m.account_id, m.chapter_id, m.role
      from membership m
      where m.status = 'active'
        and m.role = any(${roles})
        and (
          select count(*) from latest l
          where l.membership_id = m.id
            and l.component = any(${components})
            and (l.expires_at is null or l.expires_at > ${now})
        ) < ${required}
      for update
    `

    const revokedMembershipIds: string[] = []
    for (const row of targets) {
      const membershipId = row.id as string
      const accountId = row.account_id as string
      const chapterId = (row.chapter_id as string | null) ?? null
      const role = row.role as string

      // `active -> inactive`, guarded on the current status so a concurrent flip
      // does not double-count and the run stays idempotent.
      const upd = await tx`
        update membership set status = 'inactive'
        where id = ${membershipId} and status = 'active'
        returning id
      `
      if (upd.length === 0) continue

      // Clear the lapsed mentor's pod links so no live pod assignment lingers.
      await tx`delete from pod_assignment where membership_id = ${membershipId}`
      await tx`update membership set pod_id = null where id = ${membershipId}`
      await tx`update pod set mentor_membership_id = null where mentor_membership_id = ${membershipId}`

      await writeAudit(tx, {
        action: TIME_BOX_AUDIT_ACTION,
        subjectType: 'membership',
        subjectId: membershipId,
        actorAccountId: null, // system job — no human actor
        chapterId,
        detail: {
          reason: ELIGIBILITY_LAPSED_REASON,
          role,
          fromStatus: 'active',
          toStatus: 'inactive',
        },
      })
      await writeAccessLedger(tx, {
        event: 'membership.time_box_revoked',
        actorAccountId: null,
        subjectAccountId: accountId,
        chapterId,
        detail: { membershipId, reason: ELIGIBILITY_LAPSED_REASON, role },
      })

      revokedMembershipIds.push(membershipId)
    }

    return { revokedCount: revokedMembershipIds.length, revokedMembershipIds }
  })) as RunEligibilitySweepResult
}
