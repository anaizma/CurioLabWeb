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
  // --- Phase 3 grooming-pattern categories (design C.5) --------------------
  // Each is a single data-driven row per category; `detail` is a fixed KIND
  // label, never the raw match. These route to the safety officer's reading
  // queue exactly like contact_info — a flag, never an auto-block. The patterns
  // are deliberately TUNABLE (a false-positive is a config edit here, not code)
  // and biased toward the language of grooming while leaving ordinary mentoring
  // text (praising work, referencing on-program sessions) un-flagged.
  //
  // secrecy_framing — "just between us", "don't tell", "our thing/secret",
  // "delete this": the language that manufactures a private, unobserved space.
  {
    category: 'secrecy_framing',
    detail: 'secrecy_framing',
    pattern:
      /\b(?:between us|just between you and me|don'?t tell|our little secret|our secret|our thing|keep this (?:a )?secret|keep it (?:a )?secret|delete this|erase this)\b/i,
  },
  // in_person_arrangement — meeting outside program events, offers of rides or
  // gifts, hanging out one-on-one off-platform.
  {
    category: 'in_person_arrangement',
    detail: 'in_person_arrangement',
    pattern:
      /\b(?:give you a ride|get you a ride|a ride to|pick you up|meet up|meet me (?:after|outside|somewhere)|outside (?:of )?the program|hang out|just the two of us|just us two|got you a gift|a gift for you|bring you a gift|a present for you|gift)\b/i,
  },
  // romantic_appearance — romantic or appearance-focused language directed at
  // the student.
  {
    category: 'romantic_appearance',
    detail: 'romantic_appearance',
    pattern:
      /\b(?:beautiful|gorgeous|(?:so |really )?cute|sexy|attractive|crush on|love you|in love with|kiss(?:es)?|mature for your (?:age|years)|so mature|special to me)\b/i,
  },
  // home_life_probing — probing the student's home life in a way that reads as
  // testing for isolation / unsupervised access. Bounded so ordinary "did you
  // test it at home" stays clear (no bare "home"/"by yourself").
  {
    category: 'home_life_probing',
    detail: 'home_life_probing',
    pattern:
      /\b(?:home alone|home by yourself|home all alone|anyone else (?:there|home|around)|(?:parents|mom|dad) (?:not|aren'?t|isn'?t) home|when are your parents|are your parents (?:home|around|there)|get along with your (?:parents|mom|dad|family)|check your phone|do your parents check)\b/i,
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
