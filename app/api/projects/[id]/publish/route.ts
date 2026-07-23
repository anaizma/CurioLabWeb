// POST /api/projects/:id/publish — verified -> public_listed (project.publish_public).
import { cookies } from 'next/headers'
import { getSql, publishProject, SESSION_COOKIE } from '@curiolab/http'

export async function POST(_req: Request, ctx: RouteContext<'/api/projects/[id]/publish'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await publishProject({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
