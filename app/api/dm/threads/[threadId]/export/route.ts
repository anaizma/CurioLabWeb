// GET /api/dm/threads/:threadId/export — export the FULL decrypted mentor-student
// DM thread (Phase 2, design C.4), scoped so ONLY the student (their own thread) or
// a verified guardian of that student can export; anyone else gets an opaque 403. A
// read of already-authorized data (GET, read-exempt from the route manifest), but
// dark-gated: with MENTOR_DM_ENABLED off the service refuses (409) — there are no
// real threads anyway.
import { cookies } from 'next/headers'
import { getSql, exportDmThread, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/dm/threads/[threadId]/export'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await exportDmThread({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
