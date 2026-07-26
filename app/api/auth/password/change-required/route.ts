// POST /api/auth/password/change-required — consume the password-change-required
// pending token minted by login() when account.must_change_password is set: sets
// the new password, clears the flag, mints NO session (log in again).
import { getSql, completeRequiredPasswordChange } from '@curiolab/http'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await completeRequiredPasswordChange({ sql: getSql(), body })
  return Response.json(out, { status })
}
