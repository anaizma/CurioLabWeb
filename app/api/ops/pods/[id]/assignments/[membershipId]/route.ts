// DELETE /api/ops/pods/:id/assignments/:membershipId — remove a pod assignment
// (pod.manage, chapter_director). The term is carried in the request body.
import { cookies } from 'next/headers'
import { getSql, unassignPod, SESSION_COOKIE } from '@curiolab/http'

export async function DELETE(
  req: Request,
  ctx: RouteContext<'/api/ops/pods/[id]/assignments/[membershipId]'>,
) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await unassignPod({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
