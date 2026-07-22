// -------------------------------------------------------------------------
// Consent block composition — VALUES, not code (compliance-coppa.md Part 3,
// "Configuration, not code"; Part 2 Stage 2, the three separable blocks).
//
// The paper consent form is three blocks. Their composition, separability, and
// notice-text keys are DATA here so a legal answer on separability or wording
// becomes a value change, not a migration or a code edit:
//
//   Block A — required to participate — `enrollment`, `data_collection`.
//             Captured on the signed form (coupling D), not digitally grantable.
//   Block B — optional, participation — `platform_participation`.
//   Block C — optional, disclosure, separately signable (§ 312.5(a)(2)) —
//             `public_profile`, `photo_media`, `external_publication`.
//
// Block C is the § 312.5(a)(2) separate consent: visually and physically
// separate, its own signature, and declining it must not affect A or B. That is
// encoded as `disclosure: true` + `separable: true`. § 312.7 (no gating of
// participation on disclosure) is enforced separately in `tier-progression.ts`.
// -------------------------------------------------------------------------

import type { ConsentType } from '@curiolab/core'

export type ConsentBlockId = 'A' | 'B' | 'C'

export interface ConsentBlockDef {
  id: ConsentBlockId
  /** Human-facing purpose of the block (form heading). */
  label: string
  /** Required to participate (Block A). */
  required: boolean
  /** A § 312.5(a)(2) disclosure block needing its own signature (Block C). */
  disclosure: boolean
  /** Separable from the required block — declining it costs the student nothing. */
  separable: boolean
  /**
   * Where these consents are captured: `signed_form` (Block A, coupling D) or
   * `digital` (Blocks B and C, captured by ConsentService after verification).
   */
  source: 'signed_form' | 'digital'
  /** The consent types composing this block. */
  types: readonly ConsentType[]
  /**
   * Placeholder notice-text keys per type — VALUES, not code. The Stage-1 direct
   * notice (§ 312.4(c)(1)) wiring lands later; the keys are stable now so the
   * legal wording is a value swap, never a code change.
   */
  noticeTextKeys: Readonly<Partial<Record<ConsentType, string>>>
}

/**
 * The three blocks of the consent form, as data. Order is the form order:
 * required first, then optional participation, then optional disclosure.
 */
export const CONSENT_BLOCKS: readonly ConsentBlockDef[] = [
  {
    id: 'A',
    label: 'Required to participate',
    required: true,
    disclosure: false,
    separable: false,
    source: 'signed_form',
    types: ['enrollment', 'data_collection'],
    noticeTextKeys: {
      enrollment: 'consent.block_a.enrollment',
      data_collection: 'consent.block_a.data_collection',
    },
  },
  {
    id: 'B',
    label: 'Optional — platform participation',
    required: false,
    disclosure: false,
    separable: true,
    source: 'digital',
    types: ['platform_participation'],
    noticeTextKeys: {
      platform_participation: 'consent.block_b.platform_participation',
    },
  },
  {
    id: 'C',
    label: 'Optional — public disclosure (separate signature)',
    required: false,
    disclosure: true,
    separable: true,
    source: 'digital',
    types: ['public_profile', 'photo_media', 'external_publication'],
    noticeTextKeys: {
      public_profile: 'consent.block_c.public_profile',
      photo_media: 'consent.block_c.photo_media',
      external_publication: 'consent.block_c.external_publication',
    },
  },
] as const

/**
 * The consent types that must name the specific item they scope to
 * (`external_publication` is per-item, never blanket — compliance-coppa.md Part 2
 * Stage 2; enforced at the DB by `consent_external_pub_scope_ref`). A value, not
 * a literal in the service, so the rule is inspectable and config-driven.
 */
export const SCOPED_CONSENT_TYPES: readonly ConsentType[] = ['external_publication'] as const

/** The block a consent type belongs to, or undefined if it is not in any block. */
export function blockOf(type: ConsentType): ConsentBlockDef | undefined {
  return CONSENT_BLOCKS.find((b) => b.types.includes(type))
}

/**
 * Whether a type is granted digitally by ConsentService (Blocks B and C) rather
 * than captured on the signed form (Block A, coupling D). Config-driven off the
 * block `source`, so moving a type between the form and the digital flow is a
 * value change.
 */
export function isDigitallyGrantable(type: ConsentType): boolean {
  return blockOf(type)?.source === 'digital'
}

/** Whether a digital grant of this type must carry a `scope_ref`. */
export function consentTypeRequiresScopeRef(type: ConsentType): boolean {
  return SCOPED_CONSENT_TYPES.includes(type)
}
