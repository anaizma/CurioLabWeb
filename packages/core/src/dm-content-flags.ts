// -------------------------------------------------------------------------
// Off-platform content-flag detector (mentor-student-dm design C.4/C.5, Phase 2).
// A PURE, tunable, DATA-DRIVEN detector that finds contact-info patterns in a DM
// draft body: phone numbers, email addresses, social handles, and off-platform
// links/URLs. No IO, deterministic, never throws.
//
// Two uses (both in the app layer, over this pure core):
//   * a PRE-SEND check the frontend calls to show its interstitial (detects
//     WITHOUT sending);
//   * on an actual send, a match records an append-only `dm_flag` (category
//     `contact_info`) routed to the safety officer. It does NOT block the send —
//     friction at the migration point, not a block (design C.4).
//
// The matcher table is DATA (an array of {category, detail, pattern}), not code, so
// Phase 3 can extend it with the other content categories (secrecy framing,
// in-person arrangements, romantic/appearance language, home-life probing — design
// C.5) by adding rows, never rewriting the detector. The body must be scanned as
// PLAINTEXT at send time (before/around encryption), never against ciphertext.
//
// `detail` is the matched KIND (e.g. 'email'), never the raw matched substring —
// a flag must not re-introduce the plaintext contact info in the clear, since the
// message body itself is encrypted at rest.
// -------------------------------------------------------------------------

/** One raised content flag: the matcher family and the matched kind. */
export interface DmContentFlag {
  /** The matcher family (Phase 2: 'contact_info'). */
  category: string
  /** The matched kind within the family (e.g. 'email', 'phone'). */
  detail: string
}

/** A single content matcher: a category/detail label plus the pattern that raises it. */
export interface DmContentMatcher {
  category: string
  detail: string
  pattern: RegExp
}

/**
 * The content-matcher table (design C.5). Phase 2 covers the `contact_info`
 * category only; the ORDER is significant only for readability (each matcher is
 * independent). Patterns are deliberately NON-global (`.test` is called directly,
 * so there is no `lastIndex` statefulness to reset).
 *
 *   email          — a standard local@domain.tld address.
 *   phone          — a 7+-digit run with typical phone separators, OR a US-style
 *                    3-3-4 grouping. Ordinary short numbers ("3 ideas") do not match.
 *   social_handle  — an @handle at a word boundary (NOT the @ inside an email,
 *                    which is preceded by a non-space local part).
 *   url            — an http(s):// link or a bare www. host (an off-platform move).
 */
export const DM_CONTENT_MATCHERS: readonly DmContentMatcher[] = [
  {
    category: 'contact_info',
    detail: 'email',
    pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  },
  {
    category: 'contact_info',
    detail: 'phone',
    pattern: /(?:\+?\d[\d().\s-]{7,}\d)|(?:\b\d{3}[.\s-]\d{3}[.\s-]\d{4}\b)/,
  },
  {
    category: 'contact_info',
    detail: 'social_handle',
    // An @handle at a word boundary — start-of-string or after whitespace — so the
    // @ inside an email (preceded by the local part) does not match.
    pattern: /(?:^|\s)@[a-z0-9._]{2,}/i,
  },
  {
    category: 'contact_info',
    detail: 'url',
    pattern: /\b(?:https?:\/\/|www\.)\S+/i,
  },
] as const

/**
 * Detect contact-info content flags in a draft body. Returns one {category, detail}
 * per matcher that fires, deduplicated by kind. Empty for ordinary text. PURE.
 */
export function detectDmContentFlags(body: string): DmContentFlag[] {
  const out: DmContentFlag[] = []
  for (const m of DM_CONTENT_MATCHERS) {
    if (m.pattern.test(body)) out.push({ category: m.category, detail: m.detail })
  }
  return out
}
