// POST /api/ops/dm/suspensions/:id/acknowledge — the SECOND adult acknowledges a
// guardian-visibility suspension, bringing it into effect (Phase 3, design C.8;
// dm.acknowledge_visibility_suspension). The service enforces that the acknowledger
// is not a mentor in the chapter and is distinct from the initiating officer.
// Dark-gated behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, acknowledgeDmSuspension, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/ops/dm/suspensions/[id]/acknowledge'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await acknowledgeDmSuspension({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
