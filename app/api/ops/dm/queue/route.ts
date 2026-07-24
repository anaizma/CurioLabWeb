// GET /api/ops/dm/queue?chapterId=… — the safety officer's FULL-COVERAGE reading
// queue (Phase 3, design C.6): the complete chronological, decrypted queue with
// flags pinned + per-thread coverage + the weekly-volume threshold flag. GET
// (read-exempt from the route manifest); it logs officer reads to the append-only
// monitoring ledger (the existing read-logging precedent). Dark-gated behind
// MENTOR_DM_ENABLED; a non-officer / another chapter's officer gets an opaque 403.
import { cookies } from 'next/headers'
import { getSql, readDmQueue, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await readDmQueue({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
