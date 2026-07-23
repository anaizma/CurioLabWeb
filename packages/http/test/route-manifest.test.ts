// -------------------------------------------------------------------------
// Build-time route-manifest guard (07-test-plan.md "The two invariant guards":
// the route manifest half). Two things are proved here:
//
//  1. The CHECKER bites — against synthetic fixtures, a mutating route with no
//     manifest entry is reported and fails the assertion; a stale entry and a
//     typo'd capability are caught too. (The mechanism, proven independent of the
//     current codebase.)
//  2. The REAL surface is complete — the discovered mutating routes under
//     app/api EQUAL the manifest set, every declared capability is a real core
//     capability, and the `specEnumerated` inert rows match 05-api-surface.md.
// -------------------------------------------------------------------------

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { REGISTRY } from '@curiolab/core'
import {
  ROUTE_MANIFEST,
  SPEC_ENUMERATED_INERT,
  MUTATING_METHODS,
  assertManifestComplete,
  entryCapabilities,
  isAuthorized,
  missingManifestEntries,
  parseExportedMethods,
  routeKey,
  routePathFromFile,
  staleManifestEntries,
  unknownCapabilities,
  type DiscoveredRoute,
  type RouteManifest,
} from '../src/route-manifest.js'

// ---- Discover the real app/api route surface ------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const API_DIR = path.join(REPO_ROOT, 'app', 'api')

function discoverApiRoutes(dir: string): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = []
  const walk = (abs: string, rel: string): void => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, ent.name)
      const childRel = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        walk(childAbs, childRel)
      } else if (ent.name === 'route.ts') {
        const routePath = routePathFromFile(childRel)
        for (const method of parseExportedMethods(readFileSync(childAbs, 'utf8'))) {
          routes.push({ method, path: routePath })
        }
      }
    }
  }
  walk(dir, '')
  return routes
}

const DISCOVERED = discoverApiRoutes(API_DIR)
const DISCOVERED_MUTATING = DISCOVERED.filter((r) => MUTATING_METHODS.has(r.method))

// ---- 1. The checker bites (synthetic fixtures) ----------------------------

describe('route-manifest checker (fixtures)', () => {
  const manifest: RouteManifest = [
    { method: 'POST', path: '/api/feed/comments', capability: 'feed.comment' },
    { method: 'POST', path: '/api/newsletter/publish', capability: 'newsletter.publish' },
    { method: 'POST', path: '/api/public/apply', inert: 'rate-limited inert row', specEnumerated: true },
  ]

  test('a mutating route with no manifest entry is reported and fails the assertion', () => {
    const discovered: DiscoveredRoute[] = [
      { method: 'POST', path: '/api/feed/comments' },
      { method: 'POST', path: '/api/projects' }, // NEW mutating route, unmanifested
    ]
    expect(missingManifestEntries(discovered, manifest)).toEqual([
      { method: 'POST', path: '/api/projects' },
    ])
    expect(() => assertManifestComplete(discovered, manifest)).toThrow(/POST \/api\/projects/)
  })

  test('GET (non-mutating) routes need no manifest entry', () => {
    const discovered: DiscoveredRoute[] = [
      { method: 'GET', path: '/api/lab/feed' },
      { method: 'POST', path: '/api/feed/comments' },
      { method: 'POST', path: '/api/newsletter/publish' },
      { method: 'POST', path: '/api/public/apply' },
    ]
    expect(missingManifestEntries(discovered, manifest)).toEqual([])
    expect(() => assertManifestComplete(discovered, manifest)).not.toThrow()
  })

  test('a manifest entry with no matching discovered route is flagged stale', () => {
    const discovered: DiscoveredRoute[] = [
      { method: 'POST', path: '/api/feed/comments' },
      { method: 'POST', path: '/api/newsletter/publish' },
      { method: 'POST', path: '/api/public/apply' },
    ]
    expect(staleManifestEntries(discovered, manifest)).toEqual([])
    // Drop one discovered route -> its manifest entry is now stale.
    expect(staleManifestEntries(discovered.slice(1), manifest)).toEqual([
      { method: 'POST', path: '/api/feed/comments', capability: 'feed.comment' },
    ])
  })

  test('a manifest entry naming a non-existent capability is caught', () => {
    const bad: RouteManifest = [
      { method: 'POST', path: '/api/x', capability: 'feed.comment' },
      { method: 'POST', path: '/api/y', capability: 'not.a.capability' as never },
    ]
    const valid = new Set(Object.keys(REGISTRY))
    expect(unknownCapabilities(bad, valid)).toEqual([
      { entry: bad[1], capability: 'not.a.capability' },
    ])
    expect(unknownCapabilities(manifest, valid)).toEqual([])
  })

  test('parseExportedMethods reads verb-named handler exports, ignores others', () => {
    const src = [
      'export async function GET(req) {}',
      'export async function POST(req, ctx) {}',
      'export function DELETE() {}',
      'export const PATCH = async () => {}',
      'export async function helper() {}', // not an HTTP verb
      'async function POSTthing() {}', // not exported / not a verb match
    ].join('\n')
    expect(parseExportedMethods(src).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST'])
  })

  test('routePathFromFile maps a route.ts path to its /api URL', () => {
    expect(routePathFromFile('lab/posts/[id]/route.ts')).toBe('/api/lab/posts/[id]')
    expect(routePathFromFile('lab\\posts\\route.ts')).toBe('/api/lab/posts')
  })
})

// ---- 2. The real surface is complete --------------------------------------

describe('route-manifest guard (real app/api surface)', () => {
  test('the api route tree is discovered (sanity: routes and mutating methods exist)', () => {
    expect(DISCOVERED.length).toBeGreaterThan(50)
    expect(DISCOVERED_MUTATING.length).toBeGreaterThan(50)
  })

  test('every discovered mutating route has a manifest entry (a new route fails the build)', () => {
    const missing = missingManifestEntries(DISCOVERED, ROUTE_MANIFEST)
    expect(missing, `unmanifested mutating routes: ${missing.map(routeKey).join(', ')}`).toEqual([])
    expect(() => assertManifestComplete(DISCOVERED, ROUTE_MANIFEST)).not.toThrow()
  })

  test('no manifest entry is stale (every entry maps to a real mutating route)', () => {
    const stale = staleManifestEntries(DISCOVERED, ROUTE_MANIFEST)
    expect(stale, `stale manifest entries: ${stale.map(routeKey).join(', ')}`).toEqual([])
  })

  test('the manifest and the discovered mutating surface are the same size', () => {
    expect(ROUTE_MANIFEST.length).toBe(DISCOVERED_MUTATING.length)
  })

  test('every declared capability is a real key in the core REGISTRY', () => {
    const valid = new Set(Object.keys(REGISTRY))
    const unknown = unknownCapabilities(ROUTE_MANIFEST, valid)
    expect(
      unknown,
      `unknown capabilities: ${unknown.map((u) => `${routeKey(u.entry)} -> ${u.capability}`).join(', ')}`,
    ).toEqual([])
  })

  test('the specEnumerated inert rows match 05-api-surface.md exactly', () => {
    const flagged = new Set(
      ROUTE_MANIFEST.filter((e) => !isAuthorized(e) && e.specEnumerated).map(routeKey),
    )
    const spec = new Set(SPEC_ENUMERATED_INERT.map(routeKey))
    expect([...flagged].sort()).toEqual([...spec].sort())
  })

  test('every manifest entry keys a unique (method, path) with a real handler', () => {
    const discoveredKeys = new Set(DISCOVERED_MUTATING.map(routeKey))
    const seen = new Set<string>()
    for (const e of ROUTE_MANIFEST) {
      const k = routeKey(e)
      expect(seen.has(k), `duplicate manifest entry ${k}`).toBe(false)
      seen.add(k)
      expect(discoveredKeys.has(k), `manifest entry ${k} has no discovered handler`).toBe(true)
      if (isAuthorized(e)) expect(entryCapabilities(e).length).toBeGreaterThan(0)
      else expect(e.inert.length).toBeGreaterThan(0)
    }
  })
})
