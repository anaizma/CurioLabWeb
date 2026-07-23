// POST /api/profile/verification-token — regenerate the verification URL (verification.regenerate).
import { cookies } from 'next/headers'
import { getSql, regenerateVerificationToken, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await regenerateVerificationToken({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
