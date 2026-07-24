// POST /api/guardian/children/:id/publication-holds/:holdId/object — the guardian
// withholds ONE nominated item during its notify-and-object window, without
// touching the grant (publication.object).
import { cookies } from 'next/headers'
import { getSql, objectPublicationHold, SESSION_COOKIE } from '@curiolab/http'

export async function POST(
  _req: Request,
  ctx: RouteContext<'/api/guardian/children/[id]/publication-holds/[holdId]/object'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await objectPublicationHold({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
