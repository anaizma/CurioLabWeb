// -------------------------------------------------------------------------
// The pure, data-driven off-platform content-flag detector (mentor-student-dm
// design C.4/C.5, Phase 2). Finds contact-info patterns (phone, email, social
// handle, off-platform URL) in a draft body. PURE: no IO, deterministic. Phase 2
// ships only the `contact_info` category; the matcher table is data-driven so
// Phase 3 extends it (secrecy framing, in-person arrangements, …) without a rewrite.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import { detectDmContentFlags, DM_CONTENT_MATCHERS } from '../src/dm-content-flags.js'

describe('detectDmContentFlags — contact info (design C.4)', () => {
  test('flags an email address', () => {
    const flags = detectDmContentFlags('reach me at coach.sam@gmail.com anytime')
    expect(flags.some((f) => f.category === 'contact_info' && f.detail === 'email')).toBe(true)
  })

  test('flags a phone number', () => {
    const flags = detectDmContentFlags('call me at 216-555-0199 tonight')
    expect(flags.some((f) => f.category === 'contact_info' && f.detail === 'phone')).toBe(true)
  })

  test('flags a social handle', () => {
    const flags = detectDmContentFlags('add me @coach_sam_official on there')
    expect(flags.some((f) => f.category === 'contact_info' && f.detail === 'social_handle')).toBe(true)
  })

  test('flags an off-platform URL', () => {
    const flags = detectDmContentFlags('the video is at https://discord.gg/xyz join it')
    expect(flags.some((f) => f.category === 'contact_info' && f.detail === 'url')).toBe(true)
  })

  test('flags a bare www URL', () => {
    const flags = detectDmContentFlags('go to www.example-chat.net later')
    expect(flags.some((f) => f.category === 'contact_info' && f.detail === 'url')).toBe(true)
  })

  test('does NOT flag ordinary text', () => {
    const flags = detectDmContentFlags('Great work on the robot today! I have 3 ideas for next week.')
    expect(flags).toEqual([])
  })

  test('does NOT treat an email as a separate social handle (no double flag)', () => {
    const flags = detectDmContentFlags('email me at a.person@example.com')
    expect(flags.filter((f) => f.detail === 'social_handle')).toEqual([])
    expect(flags.some((f) => f.detail === 'email')).toBe(true)
  })

  test('detects multiple distinct categories in one body', () => {
    const flags = detectDmContentFlags('text 555-123-4567 or email me@foo.org')
    const details = flags.map((f) => f.detail).sort()
    expect(details).toContain('email')
    expect(details).toContain('phone')
  })

  test('the matcher table is data-driven (every matcher carries a category + detail)', () => {
    expect(DM_CONTENT_MATCHERS.length).toBeGreaterThan(0)
    for (const m of DM_CONTENT_MATCHERS) {
      expect(typeof m.category).toBe('string')
      expect(typeof m.detail).toBe('string')
      expect(m.pattern).toBeInstanceOf(RegExp)
    }
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — the remaining grooming-pattern categories (design C.5). Each is a
// human-routed flag (never an auto-block); `detail` is the matched KIND, never
// the raw substring. Ordinary mentoring text must NOT trip any of them.
// ---------------------------------------------------------------------------
describe('detectDmContentFlags — secrecy framing (design C.5)', () => {
  test.each([
    "let's keep this between us ok",
    'don\'t tell your mom about our chats',
    'this is our little secret',
    'delete this message after you read it',
    "don't tell anyone we talk like this",
  ])('flags secrecy framing: %s', (body) => {
    const flags = detectDmContentFlags(body)
    expect(flags.some((f) => f.category === 'secrecy_framing')).toBe(true)
  })

  test('ordinary text is not secrecy framing', () => {
    expect(detectDmContentFlags('great job keeping the code organized this week')).toEqual([])
  })
})

describe('detectDmContentFlags — in-person arrangement (design C.5)', () => {
  test.each([
    'i can give you a ride to the mall on saturday',
    "let's meet up outside of the program sometime",
    'i got you a gift, meet me after',
    'want to hang out just the two of us this weekend',
    'i can pick you up so your parents don\'t have to know',
  ])('flags in-person arrangement: %s', (body) => {
    const flags = detectDmContentFlags(body)
    expect(flags.some((f) => f.category === 'in_person_arrangement')).toBe(true)
  })

  test('an on-program session reference is not an off-program arrangement', () => {
    expect(detectDmContentFlags('see you at the pod session on wednesday')).toEqual([])
  })
})

describe('detectDmContentFlags — romantic / appearance language (design C.5)', () => {
  test.each([
    'you are so beautiful when you smile',
    'i think i have a crush on you',
    'you looked really cute today',
    'i love you, you know that right',
    'you are so mature for your age',
  ])('flags romantic/appearance language: %s', (body) => {
    const flags = detectDmContentFlags(body)
    expect(flags.some((f) => f.category === 'romantic_appearance')).toBe(true)
  })

  test('praising work is not romantic/appearance language', () => {
    expect(detectDmContentFlags('your project looks great and the design is clean')).toEqual([])
  })
})

describe('detectDmContentFlags — home-life probing (design C.5)', () => {
  test.each([
    'are you ever home alone after school',
    'do your parents check your phone',
    'is anyone else there right now',
    'do you get along with your parents',
    'when are your parents not home',
  ])('flags home-life probing: %s', (body) => {
    const flags = detectDmContentFlags(body)
    expect(flags.some((f) => f.category === 'home_life_probing')).toBe(true)
  })

  test('asking about the project at home is not isolation-probing', () => {
    expect(detectDmContentFlags('did you get a chance to test the robot at home')).toEqual([])
  })
})

describe('detectDmContentFlags — one send, one flag per matched category', () => {
  test('a body matching two categories yields one flag each', () => {
    const flags = detectDmContentFlags("keep this between us — are you home alone")
    const cats = flags.map((f) => f.category).sort()
    expect(cats).toContain('secrecy_framing')
    expect(cats).toContain('home_life_probing')
    // deduped by category+detail, not doubled
    expect(new Set(flags.map((f) => `${f.category}:${f.detail}`)).size).toBe(flags.length)
  })

  test('detail carries the matched KIND, never the raw body text', () => {
    const flags = detectDmContentFlags('this is our little secret, delete this')
    for (const f of flags) {
      expect(f.detail.length).toBeLessThan(40)
      expect(f.detail).not.toContain(' secret')
    }
  })
})
