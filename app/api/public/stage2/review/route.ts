// POST /api/public/stage2/review — 2C read-only review (parent token in the body).
import { getSql, reviewStage2 } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await reviewStage2({ sql: getSql(), body })
  return Response.json(out, { status })
}
