// POST /api/admin/chapters — stand up a chapter (chapter.manage, platform_admin).
import { cookies } from 'next/headers'
import { getSql, createChapter, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createChapter({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
