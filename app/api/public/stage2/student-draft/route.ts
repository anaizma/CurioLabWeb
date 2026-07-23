// POST /api/public/stage2/student-draft — read-only 2B prefill (student token in the body).
import { getSql, getStudentDraft } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await getStudentDraft({ sql: getSql(), body })
  return Response.json(out, { status })
}
