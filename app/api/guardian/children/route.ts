// GET /api/guardian/children — the guardian's verified children (guardian.list_children).
import { cookies } from 'next/headers'
import { getSql, listChildren, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await listChildren({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
