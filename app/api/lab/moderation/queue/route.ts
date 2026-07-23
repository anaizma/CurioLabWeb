// GET /api/lab/moderation/queue — the unresolved report queue, by due_at (feed.moderate).
import { cookies } from 'next/headers'
import { getSql, moderationQueue, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await moderationQueue({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
