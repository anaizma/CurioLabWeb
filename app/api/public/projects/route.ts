// GET /api/public/projects — the public_listed project directory (public, no session).
import { getSql, listPublicProjects } from '@curiolab/http'

export async function GET(_req: Request) {
  const { status, body } = await listPublicProjects({ sql: getSql() })
  return Response.json(body, { status })
}
