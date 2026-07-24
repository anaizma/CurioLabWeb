// GET /api/guardian/children/:id/dm — a verified guardian reads their OWN child's
// mentor-student DM threads (Phase 4, design C.10), decrypted, UNLESS an active
// visibility suspension excludes them (suspension-aware via the party check). Another
// child / a lapsed edge is an opaque 403. A GET (read-exempt from the route manifest),
// dark-gated behind MENTOR_DM_ENABLED. (The full-thread export lives at
// /api/dm/threads/:threadId/export, reachable by the student or a verified guardian.)
import { cookies } from 'next/headers'
import { getSql, readChildDm, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/dm'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await readChildDm({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
