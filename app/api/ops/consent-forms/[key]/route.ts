// GET /api/ops/consent-forms/:key — one consent form's detail (consent.form.read).
import { cookies } from 'next/headers'
import { getSql, getConsentFormDetail, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/ops/consent-forms/[key]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await getConsentFormDetail({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}
