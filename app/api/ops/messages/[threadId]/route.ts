// GET /api/ops/messages/:threadId — one thread with its full message list
//     (message.view; same-chapter staff check). An unknown thread is a 404; a
//     thread in another chapter is an opaque 403.
import { cookies } from 'next/headers'
import { getSql, getStaffThread, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/ops/messages/[threadId]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await getStaffThread({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
