// POST /api/ops/enrollments — coupling D: record the enrollment + form-sourced consents.
import { cookies } from 'next/headers'
import { getSql, createEnrollment, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createEnrollment({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
