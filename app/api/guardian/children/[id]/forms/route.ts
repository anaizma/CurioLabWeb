import { cookies } from 'next/headers'
import { getSql, listChildForms, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await listChildForms({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
