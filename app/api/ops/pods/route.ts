// POST /api/ops/pods — create a pod in a chapter (pod.manage, chapter_director).
import { cookies } from 'next/headers'
import { getSql, createPod, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createPod({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
