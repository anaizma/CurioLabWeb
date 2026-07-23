// GET /api/verify/:token — the PUBLIC verification URL. Returns the minimal
// verified record or the identical neutral not-shared response; noindex. No
// session; token-gated by the VerificationService.
import { getSql, viewVerification } from '@curiolab/http'

export async function GET(_req: Request, ctx: RouteContext<'/api/verify/[token]'>) {
  const { token } = await ctx.params
  const { status, body } = await viewVerification({ sql: getSql(), params: { token } })
  // Belt-and-braces: the shared shape already carries `noindex`, and the URL must
  // never be indexed regardless of the shared/not-shared branch.
  return Response.json(body, { status, headers: { 'X-Robots-Tag': 'noindex' } })
}
