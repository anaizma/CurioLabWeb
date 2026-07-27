// POST /api/auth/password/reset — token-gated, unauthenticated (05-api-surface.md
// the actor-less set). Consumes the reset token: sets the account's argon2id
// password, marks the token consumed, and revokes the account's prior sessions.
// An expired/consumed/unknown token is an opaque 401; a password below the shared
// policy is a 400 that names the unmet rules (the caller already holds the token,
// so there is nothing left to protect with an opaque body).
//
// After a successful reset this adapter sends the "your password was changed"
// notice. That notice is the only thing that makes an UNAUTHORIZED reset visible
// to the real owner, so it is sent unconditionally on success and its failure is
// swallowed: the password is already changed and the old sessions already
// revoked, and reporting the reset as failed would be a lie.
import { getSql, resetPassword } from '@curiolab/http'
import { resolveAppUrl } from '@/lib/app-url'
import { accountEmail, sendPasswordChangedEmail } from '@/lib/emails/auth-mail'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const appUrl = resolveAppUrl(req)
  const { status, body: out } = await resetPassword({
    sql: getSql(),
    body,
    notifyChanged: async ({ accountId, at }) => {
      const to = await accountEmail(getSql(), accountId)
      if (to === null) return
      await sendPasswordChangedEmail(to, at, `${appUrl}/forgot-password`)
    },
  })
  return Response.json(out, { status })
}
