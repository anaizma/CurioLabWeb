// GET /api/ops/consent-forms/:key/pdf — the form's PDF bytes (consent.form.read).
// Reads ?v=<version> for a pinned version; else the latest published (or catalog).
import { cookies } from 'next/headers'
import { getSql, getConsentFormPdf, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request, ctx: RouteContext<'/api/ops/consent-forms/[key]/pdf'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const result = await getConsentFormPdf({ sql: getSql(), sessionToken, params, query })
  if (result.status !== 200) {
    return Response.json({ error: result.status === 404 ? 'not_found' : 'forbidden' }, { status: result.status })
  }
  return new Response(new Uint8Array(result.bytes), {
    status: 200,
    headers: { 'content-type': result.contentType, 'x-pdf-sha256': result.sha256 },
  })
}
