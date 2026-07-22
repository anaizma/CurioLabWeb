// -------------------------------------------------------------------------
// Consent block composition + § 312.7 enforcement (Milestone 1 step 5). Pure,
// no Postgres — this is the config-not-code layer (compliance-coppa.md Part 3)
// and the tier-progression / public-visibility invariant (§ 312.7,
// compliance-coppa.md 1.4 and Part 3 item 6).
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import { REGISTRY, type Capability } from '@curiolab/core'
import {
  CONSENT_BLOCKS,
  SCOPED_CONSENT_TYPES,
  blockOf,
  isDigitallyGrantable,
  consentTypeRequiresScopeRef,
  TIER_PROGRESSION_CAPABILITIES,
  publicProfileGatesAnyTierProgression,
} from '../src/index.js'

describe('block composition is exposed as data (config-not-code, Part 3)', () => {
  test('the three blocks carry exactly the spec composition', () => {
    const byId = Object.fromEntries(CONSENT_BLOCKS.map((b) => [b.id, b]))
    expect(byId.A!.types).toEqual(['enrollment', 'data_collection'])
    expect(byId.B!.types).toEqual(['platform_participation'])
    expect(byId.C!.types).toEqual(['public_profile', 'photo_media', 'external_publication'])
  })

  test('Block A is required and form-sourced; B and C are optional', () => {
    const byId = Object.fromEntries(CONSENT_BLOCKS.map((b) => [b.id, b]))
    expect(byId.A!.required).toBe(true)
    expect(byId.A!.source).toBe('signed_form')
    expect(byId.B!.required).toBe(false)
    expect(byId.C!.required).toBe(false)
  })

  test('Block C is a disclosure block, separately signable, separable from A/B (§ 312.5(a)(2))', () => {
    const byId = Object.fromEntries(CONSENT_BLOCKS.map((b) => [b.id, b]))
    expect(byId.C!.disclosure).toBe(true)
    expect(byId.C!.separable).toBe(true)
    // The required block is NOT separable (participation depends on it); the
    // disclosure block is (declining it costs the student nothing).
    expect(byId.A!.separable).toBe(false)
    expect(byId.B!.disclosure).toBe(false)
    expect(byId.C!.disclosure).toBe(true)
  })

  test('every block carries a notice-text key per type (placeholder values, not code)', () => {
    for (const b of CONSENT_BLOCKS) {
      for (const t of b.types) {
        expect(typeof b.noticeTextKeys[t]).toBe('string')
        expect(b.noticeTextKeys[t]!.length).toBeGreaterThan(0)
      }
    }
  })

  test('blockOf maps a type back to its block', () => {
    expect(blockOf('data_collection')!.id).toBe('A')
    expect(blockOf('platform_participation')!.id).toBe('B')
    expect(blockOf('photo_media')!.id).toBe('C')
  })
})

describe('grantability + scoping are config-driven', () => {
  test('Block A types are form-sourced, not digitally grantable; B and C are', () => {
    expect(isDigitallyGrantable('enrollment')).toBe(false)
    expect(isDigitallyGrantable('data_collection')).toBe(false)
    expect(isDigitallyGrantable('platform_participation')).toBe(true)
    expect(isDigitallyGrantable('public_profile')).toBe(true)
    expect(isDigitallyGrantable('photo_media')).toBe(true)
    expect(isDigitallyGrantable('external_publication')).toBe(true)
  })

  test('only external_publication requires a scope_ref (per-item, never blanket)', () => {
    expect(SCOPED_CONSENT_TYPES).toEqual(['external_publication'])
    expect(consentTypeRequiresScopeRef('external_publication')).toBe(true)
    expect(consentTypeRequiresScopeRef('photo_media')).toBe(false)
    expect(consentTypeRequiresScopeRef('platform_participation')).toBe(false)
  })
})

describe('§ 312.7: participation never requires public visibility', () => {
  test('the tier-progression capability set is inspectable and non-empty', () => {
    expect(TIER_PROGRESSION_CAPABILITIES.length).toBeGreaterThan(0)
    // Each named capability really exists in the registry.
    for (const cap of TIER_PROGRESSION_CAPABILITIES) {
      expect(REGISTRY[cap]).toBeDefined()
    }
  })

  test('no tier-progression capability lists public_profile in its actorConsent', () => {
    expect(publicProfileGatesAnyTierProgression()).toBe(false)
  })

  test('the check WOULD fail if public_profile were added to a tier-progression capability', () => {
    const poisoned: Partial<Record<Capability, { actorConsent?: (typeof REGISTRY)[Capability]['actorConsent'] }>> = {
      ...REGISTRY,
      'feed.post': { ...REGISTRY['feed.post'], actorConsent: () => ['public_profile'] },
    }
    expect(publicProfileGatesAnyTierProgression(poisoned)).toBe(true)
  })
})
