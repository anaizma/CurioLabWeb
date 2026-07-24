// POST /api/ops/messages/:threadId/reply — a mentor/director appends a reply
//      (message.reply; same-chapter staff check). Body { body }. sender_role is
//      derived from the replier's membership (director vs mentor). Append-only.
import { cookies } from 'next/headers'
import { getSql, replyStaffMessage, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/messages/[threadId]/reply'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await replyStaffMessage({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
