// GET /api/guardian/children/:id/dm/digest — the weekly digest DATA for the
// guardian's OWN child (Phase 4, design C.10): thread count, message count since the
// last digest, and any flags on that child's threads. The email itself is
// frontend-owned (Resend); this exposes the data. Another child is an opaque 403. A
// GET (read-exempt from the route manifest), dark-gated behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, readChildDmDigest, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/dm/digest'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await readChildDmDigest({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
