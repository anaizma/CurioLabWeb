// GET  /api/ops/enrollments — the chapter enrollment list (enrollment.read).
// POST /api/ops/enrollments — coupling D: record the enrollment + form-sourced consents.
import { cookies } from 'next/headers'
import { getSql, createEnrollment, listEnrollments, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listEnrollments({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createEnrollment({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
