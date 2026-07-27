// -------------------------------------------------------------------------
// Device recognition for sessions (migration 0045). Three small pure functions
// that turn what a browser happens to send into the least information that still
// answers one question: "has this account signed in from this device before?"
//
// The posture is deliberate. A device fingerprint is one small step from a
// tracking identifier, so:
//
//   - the fingerprint is SALTED WITH THE ACCOUNT ID, which means the same laptop
//     hashes differently for every account that signs in from it. Nothing can be
//     correlated across accounts, which is the only thing this data could
//     otherwise be abused for.
//   - the client's IP is COARSENED before it is hashed or shown (IPv4 /24, IPv6
//     /48). Enough to say "a different network than usual"; not enough to place
//     someone at an address.
//   - the human-readable label is a two-word family ("Chrome on Windows"), not
//     the user-agent string, which is high-entropy and identifying on its own.
//
// The hash is not a secret and is not defending against someone who already has
// the database; it exists so the raw user agent and IP are never at rest.
// -------------------------------------------------------------------------

import { createHash } from 'node:crypto'

/** A device as it is recorded on a session row. */
export interface DeviceFingerprint {
  /** Account-salted SHA-256 of (user agent, coarse network). Null when unknowable. */
  hash: string | null
  /** Coarse, human-readable descriptor for the sessions list, or null. */
  label: string | null
  /** The client's coarse network (IPv4 /24, IPv6 /48), or null. */
  ipHint: string | null
}

/**
 * Expand an IPv6 address to its full eight hextets, undoing `::` compression.
 * Returns null for anything that is not a well-formed address.
 *
 * This has to be done properly rather than by splitting on ':' and dropping the
 * empties: in `::1` the single `1` is the LAST hextet, not the first, so a naive
 * split would report the loopback address as the network `1:0:0::/48` and every
 * distinct machine on a `::`-compressed address as a different network than it
 * really is.
 */
function expandIpv6(address: string): string[] | null {
  const halves = address.split('::')
  if (halves.length > 2) return null
  const left = halves[0] === '' ? [] : halves[0]!.split(':')
  const right = halves.length === 2 ? (halves[1] === '' ? [] : halves[1]!.split(':')) : []
  if ([...left, ...right].some((g) => g === '' || !/^[0-9a-fA-F]{1,4}$/.test(g))) return null

  if (halves.length === 1) return left.length === 8 ? left : null
  const missing = 8 - (left.length + right.length)
  if (missing < 1) return null
  return [...left, ...Array<string>(missing).fill('0'), ...right]
}

/**
 * Reduce a client IP to the network it sits on: an IPv4 /24 (`203.0.113.0/24`)
 * or an IPv6 /48 (`2001:db8:1::/48`). Both are stable enough that a person's home
 * or office network looks the same across sign-ins, and coarse enough that the
 * value is a neighbourhood rather than a household. Returns null for anything
 * that does not parse, so a garbled proxy header degrades to "unknown" rather
 * than to a shared bucket.
 */
export function coarseIp(ip: string | null | undefined): string | null {
  if (ip == null) return null
  // Drop an IPv6 zone index (fe80::1%eth0) before anything else.
  const trimmed = (ip.trim().split('%')[0] ?? '').trim()
  if (trimmed === '') return null

  // IPv4, including the IPv4-mapped form proxies emit as ::ffff:1.2.3.4.
  const v4 = /^(?:.*:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(trimmed)
  if (v4 !== null) {
    const octets = [v4[1], v4[2], v4[3], v4[4]].map((o) => Number(o))
    if (octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`
    }
    return null
  }

  // IPv6: the first three hextets, the /48 a site is typically delegated.
  if (trimmed.includes(':')) {
    const groups = expandIpv6(trimmed)
    if (groups === null) return null
    // Strip leading zeros so 0db8 and db8 are the same network.
    const kept = groups.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''))
    return `${kept.join(':')}::/48`
  }

  return null
}

/**
 * A coarse, human-readable device descriptor: browser family + platform family,
 * e.g. "Chrome on Windows", "Safari on iOS", "Firefox on macOS". Deliberately
 * lossy — it is a memory aid in the sessions list, not an identifier. Returns
 * null when the user agent is absent or unrecognised, and the UI then says
 * "Unrecognised device" rather than inventing a plausible one.
 *
 * Order matters: Edge and Opera both claim to be Chrome, and Chrome claims to be
 * Safari, so the more specific names are tested first.
 */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (userAgent == null) return null
  const ua = userAgent.trim()
  if (ua === '') return null

  const browser =
    /\bEdgA?\//.test(ua) ? 'Edge'
    : /\bOPR\/|\bOpera\b/.test(ua) ? 'Opera'
    : /\bSamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /\bFirefox\/|\bFxiOS\//.test(ua) ? 'Firefox'
    : /\bChrome\/|\bCriOS\//.test(ua) ? 'Chrome'
    : /\bSafari\//.test(ua) ? 'Safari'
    : null

  const platform =
    /\biPhone\b|\biPad\b|\biPod\b/.test(ua) ? 'iOS'
    : /\bAndroid\b/.test(ua) ? 'Android'
    : /\bWindows\b/.test(ua) ? 'Windows'
    : /\bMac OS X\b|\bMacintosh\b/.test(ua) ? 'macOS'
    : /\bCrOS\b/.test(ua) ? 'ChromeOS'
    : /\bLinux\b/.test(ua) ? 'Linux'
    : null

  if (browser !== null && platform !== null) return `${browser} on ${platform}`
  return browser ?? platform
}

/**
 * The account-salted device hash. Null when there is nothing to fingerprint (no
 * user agent AND no resolvable network), because a hash of nothing would make
 * every anonymous caller look like the same familiar device — the exact failure
 * that would suppress the notification we want.
 */
export function deviceHash(
  accountId: string,
  userAgent: string | null | undefined,
  ip: string | null | undefined,
): string | null {
  const ua = (userAgent ?? '').trim()
  const network = coarseIp(ip)
  if (ua === '' && network === null) return null
  // The account id is the salt: the same device is a different hash per account.
  return createHash('sha256').update(`${accountId}\n${ua}\n${network ?? ''}`).digest('hex')
}

/** Build the whole device record recorded on a session row. */
export function fingerprintDevice(
  accountId: string,
  userAgent: string | null | undefined,
  ip: string | null | undefined,
): DeviceFingerprint {
  return {
    hash: deviceHash(accountId, userAgent, ip),
    label: deviceLabel(userAgent),
    ipHint: coarseIp(ip),
  }
}
