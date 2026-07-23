// POST /api/public/apply — the unauthenticated, inert Stage 1 lead write
// (submitLead). Thin adapter: parse the Web Request body, call the controller
// with the shared db client, return a JSON Response. No business logic here.
import { getSql, submitLead } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await submitLead({ sql: getSql(), body })
  return Response.json(out, { status })
}
