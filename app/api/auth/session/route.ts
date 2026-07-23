// GET /api/auth/session — the AuthContext summary and membership switcher.
import { cookies } from 'next/headers'
import { getSql, getSession, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const store = await cookies()
  const sessionToken = store.get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await getSession({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
