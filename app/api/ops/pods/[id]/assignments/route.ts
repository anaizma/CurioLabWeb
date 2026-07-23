// POST /api/ops/pods/:id/assignments — assign a senior instructor to a pod for a
// term, writing a pod_assignment (pod.manage, chapter_director).
import { cookies } from 'next/headers'
import { getSql, assignPod, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/ops/pods/[id]/assignments'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await assignPod({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
