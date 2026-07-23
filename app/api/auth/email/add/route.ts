// POST /api/auth/email/add — the 18+ student adds their email, moving the
// account minor -> maturation_pending (Flow D step 2). Self session.
import { cookies } from 'next/headers'
import { getSql, addEmail, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await addEmail({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
