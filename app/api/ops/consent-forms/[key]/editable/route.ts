// GET /api/ops/consent-forms/:key/editable — the editor definition (consent.form.manage).
import { cookies } from 'next/headers'
import { getSql, getEditableConsentForm, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request, ctx: RouteContext<'/api/ops/consent-forms/[key]/editable'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await getEditableConsentForm({ sql: getSql(), sessionToken, params, query })
  return Response.json(body, { status })
}
