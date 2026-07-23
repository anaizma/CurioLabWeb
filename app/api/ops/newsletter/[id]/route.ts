// PATCH /api/ops/newsletter/:id — a draft-only title/body edit (newsletter.draft).
import { cookies } from 'next/headers'
import { getSql, editNewsletter, SESSION_COOKIE } from '@curiolab/http'

export async function PATCH(req: Request, ctx: RouteContext<'/api/ops/newsletter/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await editNewsletter({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
