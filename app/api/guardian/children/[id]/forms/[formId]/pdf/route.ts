// GET /api/guardian/children/:id/forms/:formId/pdf — the consent-form PDF the
// guardian reads: the chapter's published override, else the platform default,
// else the committed catalog file. Guardian-scoped (guardian.view_grants).
import { cookies } from 'next/headers'
import { getSql, getChildFormPdf, SESSION_COOKIE } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/guardian/children/[id]/forms/[formId]/pdf'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const result = await getChildFormPdf({ sql: getSql(), sessionToken, params })
  if (result.status !== 200) {
    return Response.json({ error: result.status === 404 ? 'not_found' : 'forbidden' }, { status: result.status })
  }
  return new Response(new Uint8Array(result.bytes), {
    status: 200,
    headers: { 'content-type': result.contentType, 'x-pdf-sha256': result.sha256 },
  })
}
