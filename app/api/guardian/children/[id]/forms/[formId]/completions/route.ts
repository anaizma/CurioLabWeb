import { cookies } from 'next/headers'
import { getSql, submitFormCompletion, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms/[formId]/completions'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = await req.json().catch(() => ({}))
  const { status, body: out } = await submitFormCompletion({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
