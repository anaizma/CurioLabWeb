// POST /api/public/stage2/submit — 2C submit (parent token only); mints the application.
import { getSql, submitStage2 } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await submitStage2({ sql: getSql(), body })
  return Response.json(out, { status })
}
