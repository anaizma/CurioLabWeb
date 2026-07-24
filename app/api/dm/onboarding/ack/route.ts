// POST /api/dm/onboarding/ack — record the student's first-open onboarding
// acknowledgement (Phase 4, design C.12; dm.read_own). Idempotent (the earliest ack
// is the record). Built DARK behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, ackDmOnboarding, SESSION_COOKIE } from '@curiolab/http'

export async function POST() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await ackDmOnboarding({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
