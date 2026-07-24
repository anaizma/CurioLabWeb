// GET /api/dm/onboarding — the first-open onboarding screen content + whether this
// student has acknowledged it (Phase 4, design C.12): who reads this, what happens
// when you report, and that reporting does not get anyone in trouble by default. A GET
// (read-exempt from the route manifest), dark-gated behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, getDmOnboarding, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await getDmOnboarding({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
