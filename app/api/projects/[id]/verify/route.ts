// POST /api/projects/:id/verify — submitted -> verified (project.verify).
import { cookies } from 'next/headers'
import { getSql, verifyProject, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/projects/[id]/verify'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await verifyProject({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
