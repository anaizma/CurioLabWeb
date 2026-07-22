import { describe, expect, test } from 'vitest'
import {
  assertAuthorized,
  currentDecisions,
  recordDecision,
  withRequest,
} from '../src/context.js'

// A stand-in for the repository write layer: every mutation calls
// assertAuthorized() before touching storage. In the real system this lives in
// the repository base; here it proves the backstop fires.
function fakeRepositoryWrite(): string {
  assertAuthorized()
  return 'wrote-row'
}

describe('AsyncLocalStorage authorization context + repository-write backstop', () => {
  test('a repository write outside any request context throws', () => {
    expect(() => fakeRepositoryWrite()).toThrow(/no authorization decision/i)
  })

  test('a repository write inside a request but with no recorded decision throws', async () => {
    await withRequest(async () => {
      expect(() => fakeRepositoryWrite()).toThrow(/no authorization decision/i)
    })
  })

  test('a repository write proceeds once a decision is recorded on the request', async () => {
    const result = await withRequest(async () => {
      recordDecision({ capability: 'feed.comment', actorAccountId: 'acct-1' })
      return fakeRepositoryWrite()
    })
    expect(result).toBe('wrote-row')
  })

  test('recordDecision outside a request context throws (no ambient store)', () => {
    expect(() => recordDecision({ capability: 'feed.comment', actorAccountId: 'acct-1' })).toThrow(
      /outside a request/i,
    )
  })

  test('decisions recorded on one request do not leak into another', async () => {
    await withRequest(async () => {
      recordDecision({ capability: 'feed.post', actorAccountId: 'acct-1' })
      expect(currentDecisions()).toHaveLength(1)
    })
    await withRequest(async () => {
      expect(currentDecisions()).toHaveLength(0)
    })
  })
})
