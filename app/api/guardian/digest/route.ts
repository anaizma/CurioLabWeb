// GET /api/guardian/digest — the non-child-specific chapter digest (guardian.view_digest).
import { cookies } from 'next/headers'
import { getSql, viewDigest, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await viewDigest({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
