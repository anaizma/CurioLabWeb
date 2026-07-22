// -------------------------------------------------------------------------
// The build-time route manifest (07-test-plan.md "The two invariant guards").
//
// Every mutating route declares its capability here. A build test asserts the
// set of mutating routes discovered in the codebase equals the manifest set: a
// new endpoint with no entry fails the build. Phase 0.4 ships no product routes,
// so ROUTE_MANIFEST is empty; the discovery half (walking the app's route tree)
// lands with the Next.js layer in a later phase. The checker below is the
// mechanism both halves share, proved here against fixtures.
// -------------------------------------------------------------------------

import type { Capability } from '@curiolab/core'

/** HTTP methods that mutate state and therefore require a manifest entry. */
export const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export interface RouteManifestEntry {
  method: string
  path: string
  capability: Capability
}

export type RouteManifest = RouteManifestEntry[]

/** A route discovered in the codebase (method + path), capability unknown. */
export interface DiscoveredRoute {
  method: string
  path: string
}

function key(r: { method: string; path: string }): string {
  return `${r.method.toUpperCase()} ${r.path}`
}

/**
 * The mutating discovered routes that have no manifest entry. Empty means the
 * manifest fully covers the mutating surface.
 */
export function missingManifestEntries(
  discovered: DiscoveredRoute[],
  manifest: RouteManifest,
): DiscoveredRoute[] {
  const covered = new Set(manifest.map(key))
  return discovered.filter((r) => MUTATING_METHODS.has(r.method.toUpperCase()) && !covered.has(key(r)))
}

/** Throw if any mutating discovered route lacks a manifest entry. */
export function assertManifestComplete(
  discovered: DiscoveredRoute[],
  manifest: RouteManifest,
): void {
  const missing = missingManifestEntries(discovered, manifest)
  if (missing.length > 0) {
    throw new Error(
      `mutating route(s) with no manifest entry: ${missing.map(key).join(', ')}`,
    )
  }
}

/**
 * The declared manifest. Empty until product routes exist; each future mutating
 * route adds one row mapping it to the capability its handler must `authorize`.
 */
export const ROUTE_MANIFEST: RouteManifest = []
