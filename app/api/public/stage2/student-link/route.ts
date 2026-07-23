// POST /api/public/stage2/student-link — mint/re-mint the 2B student link (parent token in the body).
import { getSql, createStudentLink } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createStudentLink({ sql: getSql(), body })
  return Response.json(out, { status })
}
