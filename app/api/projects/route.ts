// POST /api/projects — open a draft project (project.create).
import { cookies } from 'next/headers'
import { getSql, createProject, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await createProject({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
