import { describe, expect, test } from 'vitest'
import {
  ROUTE_MANIFEST,
  assertManifestComplete,
  missingManifestEntries,
  type DiscoveredRoute,
  type RouteManifest,
} from '../src/manifest.js'

// There are no real product routes yet (Phase 0.4 builds no endpoints), so the
// mechanism is proved with fixture routes. A real route added later without a
// manifest entry must fail this same check at build time.
const manifest: RouteManifest = [
  { method: 'POST', path: '/feed/comments', capability: 'feed.comment' },
  { method: 'POST', path: '/newsletter/publish', capability: 'newsletter.publish' },
]

describe('route manifest scaffold', () => {
  test('a mutating fixture route with no manifest entry is reported and fails the check', () => {
    const discovered: DiscoveredRoute[] = [
      { method: 'POST', path: '/feed/comments' },
      { method: 'POST', path: '/projects' }, // mutating, NOT in the manifest
    ]
    expect(missingManifestEntries(discovered, manifest)).toEqual([
      { method: 'POST', path: '/projects' },
    ])
    expect(() => assertManifestComplete(discovered, manifest)).toThrow(/POST \/projects/)
  })

  test('non-mutating (GET) routes need no manifest entry', () => {
    const discovered: DiscoveredRoute[] = [
      { method: 'GET', path: '/feed' },
      { method: 'POST', path: '/feed/comments' },
    ]
    expect(missingManifestEntries(discovered, manifest)).toEqual([])
    expect(() => assertManifestComplete(discovered, manifest)).not.toThrow()
  })

  test('every mutating route covered by the manifest passes', () => {
    const discovered: DiscoveredRoute[] = [
      { method: 'POST', path: '/feed/comments' },
      { method: 'POST', path: '/newsletter/publish' },
    ]
    expect(() => assertManifestComplete(discovered, manifest)).not.toThrow()
  })

  test('the shipped ROUTE_MANIFEST is a valid (possibly empty) manifest', () => {
    expect(Array.isArray(ROUTE_MANIFEST)).toBe(true)
    // No real routes exist yet; an empty manifest trivially covers the empty set.
    expect(() => assertManifestComplete([], ROUTE_MANIFEST)).not.toThrow()
  })
})
