// POST /api/public/stage2/start — consume the lead's Stage-2 token (issued at
// createLead, delivered to the parent's inbox) and create the Stage 2 draft.
// Token-gated, unauthenticated. Thin adapter: parse the body, call the
// controller with the shared db client, return a JSON Response.
import { getSql, startStage2 } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await startStage2({ sql: getSql(), body })
  return Response.json(out, { status })
}
