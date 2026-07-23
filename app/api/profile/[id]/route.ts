// GET /api/profile/:id — the composed student profile (profile.view / student.view_record).
import { cookies } from 'next/headers'
import { getSql, viewProfile, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/profile/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await viewProfile({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
