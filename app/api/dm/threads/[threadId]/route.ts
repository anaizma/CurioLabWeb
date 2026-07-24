// GET /api/dm/threads/:threadId — one mentor-student DM thread with its decrypted
// messages (Phase 4, design C.2), gated by the suspension-aware four-party party
// check. The payload INCLUDES the permanent visibility header + the who-can-read
// statement. A GET (read-exempt from the route manifest), dark-gated behind
// MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, readDmThread, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/dm/threads/[threadId]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await readDmThread({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
