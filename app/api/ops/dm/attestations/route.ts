// POST /api/ops/dm/attestations — record a chapter's abuse-and-molestation
// insurance attestation (dm.enable, director/admin), a Part D enable precondition.
// Mentor-student DM Phase 1, built DARK behind MENTOR_DM_ENABLED.
import { cookies } from 'next/headers'
import { getSql, recordDmInsurance, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await recordDmInsurance({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
