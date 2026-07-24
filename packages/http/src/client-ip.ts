// -------------------------------------------------------------------------
// Trusted client-IP extraction (admin/director backend §8). The access ledger
// records the source IP of a redemption / mentor-assisted recovery, threaded
// from the HTTP layer down into the service that writes the row.
//
// Conservative by design: behind a trusted proxy the real client is the FIRST
// hop of `x-forwarded-for` (the left-most address the edge appends); we take that
// single address, trimmed, and fall back to `x-real-ip`. We do NOT trust an
// arbitrarily long forwarded chain or parse ports. A malformed / absent header
// yields null (a system-like event), which the ledger stores as a null inet — the
// DB column rejects a non-inet, so a garbage value can never be persisted.
// -------------------------------------------------------------------------

/** A minimal IPv4/IPv6 shape check so only a plausible address reaches the inet column. */
function looksLikeIp(v: string): boolean {
  // IPv4 dotted quad, or an IPv6 (contains a colon) — the DB inet cast is the floor.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) || v.includes(':')
}

/**
 * The trusted client IP for a request, or null when none can be determined. Reads
 * the first hop of `x-forwarded-for`, else `x-real-ip`; returns null for anything
 * that does not look like an address.
 */
export function clientIpFromRequest(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first && looksLikeIp(first)) return first
  }
  const real = req.headers.get('x-real-ip')?.trim()
  if (real && looksLikeIp(real)) return real
  return null
}
