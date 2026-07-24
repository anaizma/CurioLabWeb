// GET /api/ops/guardianships — the name-match verify queue (guardianship.read).
import { cookies } from 'next/headers'
import { getSql, listGuardianships, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listGuardianships({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
