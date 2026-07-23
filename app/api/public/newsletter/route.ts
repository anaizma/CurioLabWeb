// GET /api/public/newsletter — the published newsletter issues (public, no session).
import { getSql, listPublicNewsletters } from '@curiolab/http'

export async function GET(_req: Request) {
  const { status, body } = await listPublicNewsletters({ sql: getSql() })
  return Response.json(body, { status })
}
