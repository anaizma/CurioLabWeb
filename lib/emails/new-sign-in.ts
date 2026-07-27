// The new-device sign-in notice, as the three sign-in route adapters use it.
//
// One helper rather than three copies, because the notice has to look identical
// however the session was minted (password-only, TOTP, or the enrollment confirm)
// and because getting the revoke link wrong in one of three places is exactly the
// kind of drift that leaves a "this wasn't me" button pointing at nothing.
//
// It is BEST EFFORT by construction: the session is already minted when this
// runs, so a mail failure is logged and swallowed. It never throws into a login.

import { getSql, type NewSignInNotice } from '@curiolab/http'
import { accountEmail, sendNewSignInEmail } from '@/lib/emails/auth-mail'
import { resolveAppUrl } from '@/lib/app-url'

/**
 * Build the `notifyNewSignIn` callback for a request. Returns undefined when
 * there is no way to send at all (no Resend key), which also switches the
 * controller's device bookkeeping off — no revoke token is minted for a notice
 * that cannot be delivered.
 */
export function newSignInNotifier(req: Request): ((n: NewSignInNotice) => Promise<void>) | undefined {
  if (!process.env.RESEND_API_KEY) return undefined
  const appUrl = resolveAppUrl(req)
  return async (n: NewSignInNotice) => {
    try {
      const to = await accountEmail(getSql(), n.accountId)
      // A student account has a username and no email; a minor is not directly
      // contactable, so there is simply nobody to notify here. That is the
      // correct outcome, not a failure.
      if (to === null) return
      await sendNewSignInEmail(to, {
        at: n.at,
        deviceLabel: n.deviceLabel,
        ipHint: n.ipHint,
        // The revoke token appears in exactly one place: this link.
        revokeUrl: `${appUrl}/sessions/revoke/${n.revokeToken}`,
      })
    } catch (err) {
      console.error('[auth] new-sign-in email failed (the session is still valid):', err)
    }
  }
}

/** The User-Agent header, or null. Fingerprinted and labelled, never stored raw. */
export function userAgentOf(req: Request): string | null {
  const ua = req.headers.get('user-agent')
  return ua !== null && ua !== '' ? ua : null
}
