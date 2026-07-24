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
