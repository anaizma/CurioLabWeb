// PATCH /api/projects/:id/submit — draft -> submitted (project.submit, own).
import { cookies } from 'next/headers'
import { getSql, submitProject, SESSION_COOKIE } from '@curiolab/http'

export async function PATCH(_req: Request, ctx: RouteContext<'/api/projects/[id]/submit'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await submitProject({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
