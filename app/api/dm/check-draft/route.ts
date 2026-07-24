// POST /api/dm/check-draft — the PRE-SEND contact-info check (mentor-student DM
// Phase 2, design C.4). Runs the pure core detector over a draft body and returns
// the flags WITHOUT sending, so the frontend can render its interstitial. Session-
// gated but writes nothing and calls no `authorize` (INERT in the route manifest).
// Built DARK behind MENTOR_DM_ENABLED — the detector is a harmless pure regex.
import { cookies } from 'next/headers'
import { getSql, checkDmDraft, SESSION_COOKIE } from '@curiolab/http'

export async function POST(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await checkDmDraft({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
