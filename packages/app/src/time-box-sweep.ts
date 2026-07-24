// -------------------------------------------------------------------------
// runTimeBoxSweep — §7 time-boxing of volunteer/staff access (admin/director
// backend P5). The job body that closes a former mentor/instructor/volunteer's
// access automatically at term end, rather than leaving an `active` membership
// (and its pod links) lingering after the term it was granted for has ended.
//
// WHAT ALREADY EXISTS (this phase is partly confirmation):
//   - `can`'s `inForce` (packages/core) already treats a membership that is not
//     `status = 'active'` (or is outside its [active_from, active_until) window)
//     as conferring NO capability — a non-active membership is skipped by
//     `pickMembership`, so every student-facing capability denies. That is
//     decision-time expiry, already in place.
//   - The membership state machine already defines the `active -> inactive` edge
//     ("window elapsed — system bookkeeping, no capability"): the legal edge a
//     term-end sweep takes.
//   - The `membership` row already carries `term_id` (the term linkage), so no
//     migration is needed to find the term whose `ends_on` bounds a membership.
//
// WHAT THIS ADDS: the sweep that FLIPS the status (so the closure is auditable
// and visible in the P1 roster reads, not merely denied at decision time) plus
// clears the lapsed member's pod links, and writes a system-actor audit +
// access_ledger row per revocation. Scoped to PRIVILEGED (non-student/alumni)
// roles: students lapse via graduation/maturation, a different flow, and are
// never time-boxed here.
//
// A pure job body: it takes the sql handle and an injectable clock, does its
// work in one transaction, and returns the ids/count it revoked. pg-boss
// scheduling is a separate wiring step; this is only the function. Idempotent —
// a re-run finds no still-`active` membership past its term end, so it writes no
// duplicate rows.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import { PRIVILEGED_ROLES } from '@curiolab/core'
import { writeAudit, writeAccessLedger } from '@curiolab/runtime'

export interface RunTimeBoxSweepDeps {
  sql: Sql
}

export interface RunTimeBoxSweepResult {
  /** The number of memberships time-boxed (active -> inactive) on this run. */
  revokedCount: number
  /** The ids of the memberships time-boxed on this run. */
  revokedMembershipIds: string[]
}

/** The audit action + access-ledger event for a term-end auto-revocation. */
export const TIME_BOX_AUDIT_ACTION = 'membership.time_box_revoked'

/**
 * Run the term-end time-box sweep as of `now` (default: wall clock). In one
 * transaction, for every privileged (non-student/alumni) membership that is
 * still `active` but whose term's `ends_on` is before `now`:
 *   - transition the membership `active -> inactive` (the "window elapsed" edge);
 *   - clear its pod links (delete its `pod_assignment` rows, null its
 *     `membership.pod_id`, and null any `pod.mentor_membership_id` pointing at it)
 *     so a lapsed mentor holds no live pod assignment;
 *   - write a system-actor (actor = null) `audit_entry` and `access_ledger` row
 *     recording the auto-revocation with reason `term_ended`.
 * Returns the ids and count revoked on this run. Idempotent: a membership already
 * `inactive` no longer matches the `status = 'active'` filter.
 */
export async function runTimeBoxSweep(
  deps: RunTimeBoxSweepDeps,
  now: Date = new Date(),
): Promise<RunTimeBoxSweepResult> {
  return (await deps.sql.begin(async (tx) => {
    // The still-active privileged memberships whose bound term has ended. A term
    // is "ended" strictly after its `ends_on` calendar day (a member keeps access
    // through the end date itself), compared against `now` cast to a date. Rows
    // with no `term_id` are not term-bound and are left alone. `for update` locks
    // the row so a concurrent activation cannot race the flip.
    const targets = await tx`
      select m.id, m.account_id, m.chapter_id, m.role, m.term_id
      from membership m
      join term t on t.id = m.term_id
      where m.status = 'active'
        and m.role = any(${PRIVILEGED_ROLES})
        and t.ends_on < ${now}::date
      for update
    `

    const revokedMembershipIds: string[] = []
    for (const row of targets) {
      const membershipId = row.id as string
      const accountId = row.account_id as string
      const chapterId = (row.chapter_id as string | null) ?? null
      const role = row.role as string
      const termId = (row.term_id as string | null) ?? null

      // `active -> inactive`, guarded on the current status so a concurrent flip
      // does not double-count and the run stays idempotent.
      const upd = await tx`
        update membership set status = 'inactive'
        where id = ${membershipId} and status = 'active'
        returning id
      `
      if (upd.length === 0) continue

      // Clear the lapsed member's pod links so no live pod assignment lingers.
      await tx`delete from pod_assignment where membership_id = ${membershipId}`
      await tx`update membership set pod_id = null where id = ${membershipId}`
      await tx`update pod set mentor_membership_id = null where mentor_membership_id = ${membershipId}`

      // Auditable closure (references only, no PII): the decision log peer...
      await writeAudit(tx, {
        action: TIME_BOX_AUDIT_ACTION,
        subjectType: 'membership',
        subjectId: membershipId,
        actorAccountId: null, // system job — no human actor
        chapterId,
        detail: {
          reason: 'term_ended',
          role,
          termId,
          fromStatus: 'active',
          toStatus: 'inactive',
        },
      })
      // ...and the access-provenance ledger peer (subject = the member's account).
      await writeAccessLedger(tx, {
        event: 'membership.time_box_revoked',
        actorAccountId: null,
        subjectAccountId: accountId,
        chapterId,
        detail: { membershipId, reason: 'term_ended', role, termId },
      })

      revokedMembershipIds.push(membershipId)
    }

    return { revokedCount: revokedMembershipIds.length, revokedMembershipIds }
  })) as RunTimeBoxSweepResult
}
