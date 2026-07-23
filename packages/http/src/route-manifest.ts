// -------------------------------------------------------------------------
// The build-time route manifest (07-test-plan.md "The two invariant guards").
//
// The runtime backstop (an `assertAuthorized` on the repository write path) is
// the first guard. THIS is the second: a manifest that binds every mutating
// `app/api` route to EITHER the capability its handler resolves through
// `authorize`, OR a documented reason it is one of the actor-less / self-session
// endpoints that do not (and cannot) call `authorize`. The companion build test
// (test/route-manifest.test.ts) walks `app/api/**/route.ts`, parses the HTTP
// methods each exports, and asserts the discovered mutating surface EQUALS the
// manifest set — so a new mutating endpoint with no entry FAILS the build, and a
// stale entry with no route FAILS too.
//
// MANIFEST RULE: exactly the mutating methods (POST/PUT/PATCH/DELETE) are
// manifested. GET handlers are read paths (public reads, feed/record reads gated
// by their own `authorize`, or token-flip reads) and are exempt — they never
// create authority, so a missing GET entry cannot smuggle a privileged write in.
// The two GET endpoints 05-api-surface lists in its actor-less table
// (GET /invites/:token, GET /public/newsletter/unsubscribe/:token) are covered by
// that exemption; POST /public/apply is frontend-owned and has no route.ts.
// -------------------------------------------------------------------------

import type { Capability } from '@curiolab/core'

/** HTTP methods that mutate state and therefore require a manifest entry. */
export const MUTATING_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])

/** All HTTP method names an `app/api` route file may export as a handler. */
const HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])

/** A route whose mutating method resolves through `authorize(ctx, capability)`. */
export interface AuthorizedEntry {
  method: string
  path: string
  /**
   * The capability (or capabilities, for a route with a documented branch such as
   * the moderate-vs-safety hide) the handler's service authorizes.
   */
  capability: Capability | readonly Capability[]
}

/** A route that does NOT call `authorize`, with the protection that stands in. */
export interface InertEntry {
  method: string
  path: string
  /** Short reason documenting the non-`authorize` protection that gates the write. */
  inert: string
  /**
   * True iff this endpoint is one of the actor-less write endpoints enumerated in
   * 05-api-surface.md's inert table ("the entire attack surface a stranger can
   * reach"). False marks the other non-`authorize` writes (auth session
   * management, the self-session maturation writes, the Stage-2 onboarding funnel,
   * the marketing contact form) — reachable but not in that enumerated set.
   */
  specEnumerated: boolean
}

export type RouteManifestEntry = AuthorizedEntry | InertEntry
export type RouteManifest = readonly RouteManifestEntry[]

/** A route discovered in the codebase (method + path), capability unknown. */
export interface DiscoveredRoute {
  method: string
  path: string
}

/** True when the entry is gated through `authorize` (carries a capability). */
export function isAuthorized(e: RouteManifestEntry): e is AuthorizedEntry {
  return 'capability' in e
}

/** The one-or-many capabilities an authorized entry declares, as an array. */
export function entryCapabilities(e: AuthorizedEntry): readonly Capability[] {
  return Array.isArray(e.capability) ? e.capability : [e.capability as Capability]
}

export function routeKey(r: { method: string; path: string }): string {
  return `${r.method.toUpperCase()} ${r.path}`
}

// ---- The pure checker (shared by the build test and its fixture unit tests) ---

/**
 * The mutating discovered routes that have no manifest entry. Empty means the
 * manifest fully covers the discovered mutating surface. A NEW mutating route
 * added without a manifest entry appears here — that is the guard biting.
 */
export function missingManifestEntries(
  discovered: readonly DiscoveredRoute[],
  manifest: RouteManifest,
): DiscoveredRoute[] {
  const covered = new Set(manifest.map(routeKey))
  return discovered.filter(
    (r) => MUTATING_METHODS.has(r.method.toUpperCase()) && !covered.has(routeKey(r)),
  )
}

/**
 * The manifest entries that correspond to no discovered route — a stale binding
 * left behind when a route is deleted or renamed. Empty means every entry is live.
 */
export function staleManifestEntries(
  discovered: readonly DiscoveredRoute[],
  manifest: RouteManifest,
): RouteManifestEntry[] {
  const live = new Set(
    discovered
      .filter((r) => MUTATING_METHODS.has(r.method.toUpperCase()))
      .map(routeKey),
  )
  return manifest.filter((e) => !live.has(routeKey(e)))
}

/**
 * The authorized entries whose declared capability is not a real key in the core
 * capability set — catches a typo that would otherwise bind a route to nothing.
 */
export function unknownCapabilities(
  manifest: RouteManifest,
  validCapabilities: ReadonlySet<string>,
): { entry: AuthorizedEntry; capability: string }[] {
  const out: { entry: AuthorizedEntry; capability: string }[] = []
  for (const e of manifest) {
    if (!isAuthorized(e)) continue
    for (const cap of entryCapabilities(e)) {
      if (!validCapabilities.has(cap)) out.push({ entry: e, capability: cap })
    }
  }
  return out
}

/** Throw, listing offenders, if any mutating discovered route lacks a manifest entry. */
export function assertManifestComplete(
  discovered: readonly DiscoveredRoute[],
  manifest: RouteManifest,
): void {
  const missing = missingManifestEntries(discovered, manifest)
  if (missing.length > 0) {
    throw new Error(
      `mutating route(s) with no manifest entry: ${missing.map(routeKey).join(', ')}`,
    )
  }
}

// ---- Discovery: parse the real app/api route tree ------------------------

/**
 * The HTTP method handlers a `route.ts` source exports. Handlers are module-level
 * `export async function GET(...)` / `export function POST(...)` /
 * `export const DELETE = ...` named for the HTTP verb; anything else is ignored.
 */
export function parseExportedMethods(source: string): string[] {
  const re = /export\s+(?:async\s+)?(?:function|const)\s+([A-Z]+)\b/g
  const found = new Set<string>()
  for (const m of source.matchAll(re)) {
    const name = m[1] as string
    if (HTTP_METHODS.has(name)) found.add(name)
  }
  return [...found]
}

/** `app/api/lab/posts/[id]/route.ts` (relative to app/api) -> `/api/lab/posts/[id]`. */
export function routePathFromFile(relFromApiDir: string): string {
  const normalized = relFromApiDir.replace(/\\/g, '/').replace(/\/route\.ts$/, '')
  return `/api/${normalized}`
}

/**
 * The enumerated actor-less write endpoints from 05-api-surface.md's inert table
 * that exist as mutating `app/api` routes, in the manifest's path form. Every
 * manifest entry marked `specEnumerated` must be one of these, and vice versa —
 * the cross-check that keeps the "inert set" honest against the spec. The other
 * rows of 05's nine-row table are excluded by the mutating-route rule (two GET
 * reads) or are frontend-owned (POST /public/apply, no route.ts).
 */
export const SPEC_ENUMERATED_INERT: readonly DiscoveredRoute[] = [
  { method: 'POST', path: '/api/auth/password/reset-request' },
  { method: 'POST', path: '/api/auth/password/reset' },
  { method: 'POST', path: '/api/invites/[token]/accept' },
  { method: 'POST', path: '/api/invites/[token]/accept-student' },
  { method: 'POST', path: '/api/public/newsletter/subscribe' },
  { method: 'POST', path: '/api/webhooks/resend' },
  { method: 'POST', path: '/api/webhooks/stripe' },
]

// -------------------------------------------------------------------------
// THE MANIFEST. One row per (app/api route, mutating method). Capabilities are
// taken from each route's controller/service `authorize(ctx, '<capability>')`
// call; inert rows name the protection that stands in for `authorize`.
// -------------------------------------------------------------------------
export const ROUTE_MANIFEST: RouteManifest = [
  // ---- Platform administration: org structure (05 §Platform administration) ----
  { method: 'POST', path: '/api/admin/chapters', capability: 'chapter.manage' },
  { method: 'PATCH', path: '/api/admin/chapters/[id]', capability: 'chapter.manage' },
  { method: 'POST', path: '/api/ops/terms', capability: 'term.manage' },
  { method: 'PATCH', path: '/api/ops/terms/[id]', capability: 'term.manage' },
  { method: 'POST', path: '/api/ops/pods', capability: 'pod.manage' },
  { method: 'POST', path: '/api/ops/pods/[id]/assignments', capability: 'pod.manage' },
  {
    method: 'DELETE',
    path: '/api/ops/pods/[id]/assignments/[membershipId]',
    capability: 'pod.manage',
  },

  // ---- Auth (05 §Auth) ----
  { method: 'POST', path: '/api/auth/impersonate', capability: 'impersonation.start' },
  {
    method: 'DELETE',
    path: '/api/auth/impersonate',
    inert: 'ends the actor’s own impersonation session; no registry capability (05 §Auth: none)',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    inert: 'credential check mints an opaque session; no actor to authorize (05 §Auth: none)',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    inert: 'deletes the actor’s own session row; no registry capability (05 §Auth: none)',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/auth/password/reset-request',
    inert: 'rate-limited, uniform response, token-gated; issues a reset token (05 inert table)',
    specEnumerated: true,
  },
  {
    method: 'POST',
    path: '/api/auth/password/reset',
    inert: 'token-gated; consumes a reset token, no enumeration signal (05 inert table)',
    specEnumerated: true,
  },
  {
    method: 'POST',
    path: '/api/auth/email/add',
    inert: 'self session, 18+ maturation email add; self-ownership + age floor gate the service, no registry capability (05 §Auth: none (self session))',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/auth/account-recovery',
    inert: 'unauthenticated, token-gated; consumes an account_recovery setup token (invite-accept-shaped), one opaque invalid_token otherwise',
    specEnumerated: false,
  },

  // ---- Apply funnel Stage 1 (frontend-owned adapter over LeadService.createLead) ----
  {
    method: 'POST',
    path: '/api/apply',
    inert: 'public Stage-1 lead capture; creates only an application_lead (parent email, chapter, source, filler_role — no child data, no account or edge). Returns the parent Stage-2 token only for a parent-filler',
    specEnumerated: false,
  },

  // ---- Invite onboarding entry (05 inert table; actor-less, inert rows) ----
  {
    method: 'POST',
    path: '/api/invites/[token]/accept',
    inert: 'rate limit, single-use token; creates a pending account + pending edge, zero authority until verify (05 inert table)',
    specEnumerated: true,
  },
  {
    method: 'POST',
    path: '/api/invites/[token]/accept-student',
    inert: 'rate limit, single-use token; creates a pending student account, no active membership until activate (05 inert table)',
    specEnumerated: true,
  },

  // ---- The Lab (05 §The Lab) ----
  { method: 'POST', path: '/api/lab/posts', capability: 'feed.post' },
  { method: 'PATCH', path: '/api/lab/posts/[id]', capability: 'feed.post' },
  { method: 'POST', path: '/api/lab/posts/[id]/comments', capability: 'feed.comment' },
  { method: 'POST', path: '/api/lab/posts/[id]/reactions', capability: 'feed.react' },
  { method: 'DELETE', path: '/api/lab/posts/[id]/reactions', capability: 'feed.react' },
  { method: 'POST', path: '/api/lab/comments/[id]/reactions', capability: 'feed.react' },
  { method: 'DELETE', path: '/api/lab/comments/[id]/reactions', capability: 'feed.react' },
  { method: 'POST', path: '/api/lab/reports', capability: 'feed.report' },
  // hide branches: the default moderate hide OR the on-sight safety hide (05 §The Lab).
  {
    method: 'POST',
    path: '/api/lab/posts/[id]/hide',
    capability: ['feed.moderate', 'feed.hide_safety'],
  },
  { method: 'POST', path: '/api/lab/posts/[id]/remove', capability: 'feed.moderate' },
  { method: 'POST', path: '/api/lab/moderation/[id]/ack', capability: 'feed.moderate' },
  { method: 'POST', path: '/api/lab/moderation/[id]/resolve', capability: 'moderation.resolve' },
  { method: 'POST', path: '/api/lab/moderation/[id]/escalate', capability: 'feed.moderate' },

  // ---- Student profile & projects (05 §Student profile and projects) ----
  { method: 'PATCH', path: '/api/profile/narrative', capability: 'profile.edit_narrative' },
  { method: 'POST', path: '/api/profile/narrative/[id]/review', capability: 'narrative.review' },
  {
    method: 'POST',
    path: '/api/profile/verification-token',
    capability: 'verification.regenerate',
  },
  { method: 'POST', path: '/api/projects', capability: 'project.create' },
  { method: 'PATCH', path: '/api/projects/[id]/submit', capability: 'project.submit' },
  { method: 'POST', path: '/api/projects/[id]/verify', capability: 'project.verify' },
  { method: 'POST', path: '/api/projects/[id]/publish', capability: 'project.publish_public' },
  { method: 'POST', path: '/api/projects/[id]/unpublish', capability: 'project.unpublish' },

  // ---- Guardian portal (05 §Guardian portal) ----
  { method: 'POST', path: '/api/guardian/children/[id]/consents', capability: 'consent.grant' },
  {
    method: 'POST',
    path: '/api/guardian/children/[id]/consents/[type]/revoke',
    capability: 'consent.revoke',
  },
  {
    method: 'POST',
    path: '/api/guardian/children/[id]/export',
    capability: 'guardian.request_export',
  },
  {
    method: 'POST',
    path: '/api/guardian/children/[id]/deletion',
    capability: 'guardian.request_deletion',
  },

  // ---- Operations back office (05 §Operations back office) ----
  { method: 'PATCH', path: '/api/ops/applications/[id]', capability: 'application.transition' },
  { method: 'POST', path: '/api/ops/enrollments', capability: 'enrollment.create' },
  { method: 'POST', path: '/api/ops/invites', capability: 'member.invite' },
  { method: 'POST', path: '/api/ops/invites/[id]/resend', capability: 'member.invite' },
  { method: 'POST', path: '/api/ops/guardianships/[id]/verify', capability: 'guardianship.verify' },
  { method: 'POST', path: '/api/ops/guardianships/[id]/revoke', capability: 'guardianship.revoke' },
  {
    method: 'POST',
    path: '/api/ops/students/[id]/consents/safeguard-suspend',
    capability: 'consent.revoke_safeguarding',
  },
  { method: 'POST', path: '/api/ops/memberships/[id]/activate', capability: 'member.activate' },
  { method: 'POST', path: '/api/ops/maturations/[id]/confirm', capability: 'maturation.confirm' },
  { method: 'POST', path: '/api/ops/accounts/[id]/reissue-setup', capability: 'account.recover' },
  {
    method: 'POST',
    path: '/api/ops/students/[id]/self-private',
    inert: 'self session, 16+ witnessed credential privatization; self-ownership + age + non-guardian-witness gate the service, no registry capability (05 §Ops: (self session, witnessed))',
    specEnumerated: false,
  },
  { method: 'POST', path: '/api/ops/deletion-requests/[id]/review', capability: 'deletion.review' },
  {
    method: 'POST',
    path: '/api/ops/deletion-requests/[id]/fulfill',
    capability: 'deletion.fulfill',
  },
  {
    method: 'POST',
    path: '/api/ops/export-requests/[id]/fulfill',
    capability: 'export.fulfill',
  },
  // attach media is a submit on the actor's own project (media service authorizes project.submit).
  { method: 'POST', path: '/api/ops/media', capability: 'project.submit' },
  {
    method: 'POST',
    path: '/api/ops/media/[id]/confirm-depiction',
    capability: 'media.review',
  },
  { method: 'POST', path: '/api/ops/media/[id]/clear', capability: 'media.review' },
  { method: 'POST', path: '/api/ops/media/[id]/remove', capability: 'media.review' },
  { method: 'POST', path: '/api/ops/newsletter', capability: 'newsletter.draft' },
  { method: 'PATCH', path: '/api/ops/newsletter/[id]', capability: 'newsletter.draft' },
  {
    method: 'POST',
    path: '/api/ops/newsletter/[id]/submit',
    capability: 'newsletter.submit_review',
  },
  { method: 'POST', path: '/api/ops/newsletter/[id]/schedule', capability: 'newsletter.schedule' },
  { method: 'POST', path: '/api/ops/newsletter/[id]/publish', capability: 'newsletter.publish' },
  {
    method: 'POST',
    path: '/api/ops/newsletter/[id]/unpublish',
    capability: 'newsletter.unpublish',
  },

  // ---- Provider webhooks (05 §Webhooks; actor-less, signature-verified, idempotent) ----
  {
    method: 'POST',
    path: '/api/webhooks/resend',
    inert: 'provider signature over the raw body, idempotent on event id; mutates only delivery status (05 inert table)',
    specEnumerated: true,
  },
  {
    method: 'POST',
    path: '/api/webhooks/stripe',
    inert: 'provider signature over the raw body, idempotent on event id; mutates only payment status (05 inert table)',
    specEnumerated: true,
  },

  // ---- Public newsletter (05 §Public site / inert table) ----
  {
    method: 'POST',
    path: '/api/public/newsletter/subscribe',
    inert: 'rate limit, double opt-in; writes only to the subscriber list (05 inert table)',
    specEnumerated: true,
  },

  // ---- Public Stage-2 onboarding funnel (design §7.2/§8; unauthenticated, token-gated) ----
  // NOTE: not in 05-api-surface's enumerated inert table — the token-gated funnel
  // that follows the frontend-owned Stage 1 (POST /public/apply). Each op's only
  // gate is the opaque parent/student token (Stage2Service does a timing-safe
  // compare); every handler runs `runPublic`, so there is no actor and no
  // `authorize` call. See findings in the manifest test / commit.
  {
    method: 'POST',
    path: '/api/public/stage2/start',
    inert: 'unauthenticated, token-gated (consumes the lead’s Stage-2 token); creates a draft, runPublic — no actor',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/public/stage2/parent',
    inert: 'unauthenticated, parent-token-gated (timing-safe); saves 2A, runPublic — no actor',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/public/stage2/student-link',
    inert: 'unauthenticated, parent-token-gated (timing-safe); mints/re-mints the 2B student link, runPublic — no actor',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/public/stage2/student',
    inert: 'unauthenticated, student-token-gated (timing-safe); saves 2B, does not submit, runPublic — no actor',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/public/stage2/review',
    inert: 'unauthenticated, parent-token-gated; read-only 2C view, runPublic — no actor',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/public/stage2/submit',
    inert: 'unauthenticated, parent-token-gated; mints the application in submitted (inert row, like /public/apply), runPublic — no actor',
    specEnumerated: false,
  },
  {
    method: 'POST',
    path: '/api/public/stage2/send-back',
    inert: 'unauthenticated, parent-token-gated; returns 2C -> 2B, runPublic — no actor',
    specEnumerated: false,
  },

  // ---- Marketing site (outside the platform spec) ----
  // NOTE: POST /api/contact is a marketing contact form owned by the frontend
  // (app/ marketing pages). It sends an email via Resend and writes NOTHING to the
  // account/consent/standing graph — no actor, no `authorize`. Flagged as a
  // finding: a mutating route not present in 05-api-surface.md.
  {
    method: 'POST',
    path: '/api/contact',
    inert: 'marketing contact form (frontend-owned); sends an email via Resend, no account-graph write, no actor — not in 05-api-surface',
    specEnumerated: false,
  },
]

