// POST /api/public/stage2/send-back — 2C -> 2B send-back (parent token in the body).
import { getSql, sendBack } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await sendBack({ sql: getSql(), body })
  return Response.json(out, { status })
}
