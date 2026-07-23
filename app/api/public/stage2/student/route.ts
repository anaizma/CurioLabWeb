// POST /api/public/stage2/student — 2B student section (student token in the body).
import { getSql, saveStudentSection } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await saveStudentSection({ sql: getSql(), body })
  return Response.json(out, { status })
}
