// POST /api/auth/sessions/revoke-link — the "this wasn't me" action behind the
// new-sign-in email. Unauthenticated and token-gated on purpose: the person
// clicking it may be locked out of the account someone else just signed into,
// which is exactly the case it exists for.
//
// It is a POST, not the GET the email link opens, because mail scanners and link
// previewers fetch every URL in a message. A GET that revoked on sight would let
// a corporate scanner sign a director out several times a day. The link opens a
// page; the page's button posts here.
import { getSql, revokeSessionByLink, readJson } from '@curiolab/http'

export async function POST(req: Request) {
  const body = await readJson(req)
  const { status, body: out } = await revokeSessionByLink({ sql: getSql(), body })
  return Response.json(out, { status })
}
