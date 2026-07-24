// GET /api/ops/deletion-requests — the chapter deletion-request queue (deletion.read).
import { cookies } from 'next/headers'
import { getSql, listDeletionRequests, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listDeletionRequests({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
