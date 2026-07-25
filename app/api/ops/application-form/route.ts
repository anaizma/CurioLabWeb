// GET /api/ops/application-form — the chapter's current form (application.read).
// PUT /api/ops/application-form — save a new version (application.form.manage).
import { cookies } from 'next/headers'
import { getSql, getApplicationForm, putApplicationForm, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await getApplicationForm({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}

export async function PUT(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await putApplicationForm({ sql: getSql(), sessionToken, query, body })
  return Response.json(out, { status })
}
