// -------------------------------------------------------------------------
// Mentor eligibility controllers (admin/director backend §6, REVIEW-GATED).
// Thin adapters over MentorEligibilityService: resolve the session to an
// AuthContext (runAuthed), then call the service under `authorize`.
//
//   recordMentorEligibility  POST /api/ops/mentors/:membershipId/eligibility  (mentor.manage_eligibility)
//   readMentorEligibility    GET  /api/ops/mentors/:membershipId/eligibility  (membership.read — reused P1 roster read)
//
// The record write is manifested (mentor.manage_eligibility); the GET read is
// exempt from the route-manifest guard (only mutating methods are manifested).
// The ENFORCEMENT this feeds (withdrawing an ineligible mentor's student-facing
// access) is behind MENTOR_ELIGIBILITY_ENFORCED (default off); the record/read
// surfaces are always available (they only write/read the eligibility ledger).
// -------------------------------------------------------------------------

import {
  MentorEligibilityService,
  MENTOR_ELIGIBILITY_COMPONENTS,
  type MentorEligibilityComponent,
  type MentorEligibilityView,
  type RecordClearanceResult,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { ValidationError, optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

const COMPONENTS: readonly MentorEligibilityComponent[] = MENTOR_ELIGIBILITY_COMPONENTS

/** Parse an optional ISO date string to a Date, or null; a bad value is a 400. */
function optDate(v: unknown, field: string): Date | null {
  if (v == null) return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) throw new ValidationError(`invalid date field: ${field}`)
  return d
}

export interface RecordMentorEligibilityInput extends AuthedInputBase {
  params: { membershipId?: unknown }
  body: {
    component?: unknown
    clearedAt?: unknown
    expiresAt?: unknown
    version?: unknown
    evidenceRef?: unknown
  }
}

/** POST /api/ops/mentors/:membershipId/eligibility — record a component clearance. */
export function recordMentorEligibility(
  input: RecordMentorEligibilityInput,
): Promise<ControllerResult<RecordClearanceResult>> {
  return runAuthed(input, async (ctx, sql) => {
    const membershipId = reqStr(input.params?.membershipId, 'membershipId')
    const component = reqStr(input.body?.component, 'component') as MentorEligibilityComponent
    if (!COMPONENTS.includes(component)) {
      throw new ValidationError(`unknown eligibility component: ${component}`)
    }
    const result = await new MentorEligibilityService({ sql, authorize }).record(
      membershipId,
      component,
      ctx,
      {
        clearedAt: optDate(input.body?.clearedAt, 'clearedAt') ?? undefined,
        expiresAt: optDate(input.body?.expiresAt, 'expiresAt'),
        version: optStr(input.body?.version),
        evidenceRef: optStr(input.body?.evidenceRef),
      },
    )
    return { status: 201, body: result }
  })
}

export interface ReadMentorEligibilityInput extends AuthedInputBase {
  params: { membershipId?: unknown }
}

/** GET /api/ops/mentors/:membershipId/eligibility — the mentor-eligibility panel read. */
export function readMentorEligibility(
  input: ReadMentorEligibilityInput,
): Promise<ControllerResult<MentorEligibilityView>> {
  return runAuthed(input, async (ctx, sql) => {
    const membershipId = reqStr(input.params?.membershipId, 'membershipId')
    const view = await new MentorEligibilityService({ sql, authorize }).read(membershipId, ctx)
    return { status: 200, body: view }
  })
}
