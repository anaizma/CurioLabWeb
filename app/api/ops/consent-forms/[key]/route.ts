// GET /api/ops/consent-forms/:key — one consent form's detail (consent.form.read).
// PUT /api/ops/consent-forms/:key — save a new version (consent.form.manage).
import { cookies } from 'next/headers'
import { getSql, getConsentFormDetail, saveConsentForm, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/ops/consent-forms/[key]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body } = await getConsentFormDetail({ sql: getSql(), sessionToken, params })
  return Response.json(body, { status })
}

export async function PUT(req: Request, ctx: RouteContext<'/api/ops/consent-forms/[key]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await saveConsentForm({ sql: getSql(), sessionToken, params, query, body })
  return Response.json(out, { status })
}
