// GET /api/ops/messages?chapterId= — the staff thread list for a chapter
//     (message.view). Each thread carries the guardian's display name + a
//     last-message preview. Cross-chapter callers are an opaque 403.
import { cookies } from 'next/headers'
import { getSql, listStaffMessages, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await listStaffMessages({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
