// POST /api/public/stage2/draft — read-only 2A prefill (parent token in the body).
import { getSql, getParentDraft } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await getParentDraft({ sql: getSql(), body })
  return Response.json(out, { status })
}
