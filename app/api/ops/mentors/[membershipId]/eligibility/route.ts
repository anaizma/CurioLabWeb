// GET  /api/ops/mentors/:membershipId/eligibility — the mentor-eligibility panel
//      read (membership.read; GET-exempt from the route-manifest guard).
// POST /api/ops/mentors/:membershipId/eligibility — record a component clearance
//      (mentor.manage_eligibility, chapter_director; admin via override). §6, gated.
import { cookies } from 'next/headers'
import {
  getSql,
  readMentorEligibility,
  recordMentorEligibility,
  SESSION_COOKIE,
} from '@curiolab/http'

export async function GET(
  _req: Request,
  ctx: RouteContext<'/api/ops/mentors/[membershipId]/eligibility'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await readMentorEligibility({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}

export async function POST(
  req: Request,
  ctx: RouteContext<'/api/ops/mentors/[membershipId]/eligibility'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await recordMentorEligibility({
    sql: getSql(),
    sessionToken,
    params,
    body,
  })
  return Response.json(out, { status })
}
