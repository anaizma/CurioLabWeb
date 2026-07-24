// GET /api/ops/applications/:id — the application review detail (application.read).
// PATCH /api/ops/applications/:id — an application lifecycle transition.
import { cookies } from 'next/headers'
import { getSql, getApplication, transitionApplication, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/ops/applications/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await getApplication({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}

export async function PATCH(req: Request, ctx: RouteContext<'/api/ops/applications/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await transitionApplication({
    sql: getSql(),
    sessionToken,
    params,
    body,
  })
  return Response.json(out, { status })
}
