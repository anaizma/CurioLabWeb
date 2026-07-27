// The ONE place a public link's base URL is decided.
//
// Emails in the funnel are built in two different layers: the frontend route
// (/api/apply -> the parent's continue link, the director's alert) and the
// framework-agnostic backend service (Stage2Service -> the parent's "review and
// submit" link). Those two used to read DIFFERENT variables, so the review email
// could point at localhost while the continue email pointed at the live host.
// Everything now resolves through here.
//
// Precedence:
//   1. APP_URL — the explicit deployment override. Set this in production
//      (APP_URL=https://acuriolab.org). It also covers a deployment behind a
//      proxy that rewrites Host, where the request origin cannot be trusted.
//   2. NEXT_PUBLIC_SITE_URL — honoured for backwards compatibility.
//   3. The request's own origin — so a local dev server on any port, and a
//      preview deployment on its own hostname, both produce working links with
//      no configuration at all.

/** The base URL for links in outbound mail, with no trailing slash. */
export function resolveAppUrl(req: Request): string {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL
  if (explicit !== undefined && explicit !== '') return stripTrailingSlash(explicit)
  return stripTrailingSlash(new URL(req.url).origin)
}

function stripTrailingSlash(u: string): string {
  return u.endsWith('/') ? u.slice(0, -1) : u
}
