import { cookies } from 'next/headers'
import { getSql, getFormDraft, saveFormDraft, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms/[formId]/draft'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await getFormDraft({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
export async function PUT(req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms/[formId]/draft'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = await req.json().catch(() => ({}))
  const { status, body: out } = await saveFormDraft({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}
