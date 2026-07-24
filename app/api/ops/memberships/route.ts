// GET /api/ops/memberships — the chapter roster (membership.read); ?status, ?role.
import { cookies } from 'next/headers'
import { getSql, listMemberships, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listMemberships({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
