// GET /api/public/projects/:id — one public_listed project, else 404 (public, no session).
import { getSql, viewPublicProject } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/public/projects/[id]'>) {
  const params = await ctx.params
  const { status, body } = await viewPublicProject({ sql: getSql(), params })
  return Response.json(body, { status })
}
