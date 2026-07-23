// POST /api/auth/logout — revoke the current session and clear the cookie.
import { cookies } from 'next/headers'
import { getSql, logout, SESSION_COOKIE } from '@curiolab/http'

export async function POST() {
  const store = await cookies()
  const sessionToken = store.get(SESSION_COOKIE)?.value ?? null
  const result = await logout({ sql: getSql(), sessionToken })
  if (result.session && result.session.token === null) {
    store.delete(SESSION_COOKIE)
  }
  return Response.json(result.body, { status: result.status })
}
