// PATCH /api/admin/chapters/:id — reconfigure a chapter (chapter.manage, platform_admin).
import { cookies } from 'next/headers'
import { getSql, updateChapter, SESSION_COOKIE } from '@curiolab/http'

export async function PATCH(req: Request, ctx: RouteContext<'/api/admin/chapters/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await updateChapter({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
