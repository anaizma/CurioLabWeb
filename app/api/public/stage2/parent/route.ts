// POST /api/public/stage2/parent — 2A parent section (parent token in the body).
import { getSql, saveParentSection } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await saveParentSection({ sql: getSql(), body })
  return Response.json(out, { status })
}
