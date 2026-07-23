// PATCH /api/profile/narrative — edit the actor's own narrative (profile.edit_narrative).
import { cookies } from 'next/headers'
import { getSql, editNarrative, SESSION_COOKIE } from '@curiolab/http'

export async function PATCH(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await editNarrative({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
