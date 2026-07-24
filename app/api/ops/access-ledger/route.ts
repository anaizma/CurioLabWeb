// GET /api/ops/access-ledger — a Chapter Director reads their chapter's append-only
// invitation/access ledger (admin/director backend §8; ledger.read, chapter-scoped).
// Returns { chapterId, items } with minor PII hidden (display names + ids). A GET
// read carries no route-manifest entry (only mutating methods are manifested).
import { cookies } from 'next/headers'
import { getSql, readAccessLedger, SESSION_COOKIE } from '@curiolab/http'

export async function GET(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const query = Object.fromEntries(new URL(req.url).searchParams)
  const { status, body } = await readAccessLedger({ sql: getSql(), sessionToken, query })
  return Response.json(body, { status })
}
