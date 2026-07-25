// Account self-service ("My Information").
// GET   /api/account — the caller's OWN info, assembled per role (self-session read).
// PATCH /api/account — edit the editable fields (email — role-aware; school —
//   students only), gated by account.self.manage; body { email?, school? }.
import { cookies } from 'next/headers'
import { getSql, getAccount, updateAccount, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await getAccount({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}

export async function PATCH(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await updateAccount({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
