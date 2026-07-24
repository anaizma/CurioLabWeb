// -------------------------------------------------------------------------
// The access-ledger writer (admin/director backend §8; `access_ledger` in
// @curiolab/db migration 0022).
//
// A PEER of writeAudit, not a replacement. audit_entry is the authorization
// DECISION log; access_ledger is the account-ORIGINATION + ACCESS-PROVENANCE
// record — who invited whom, the token issuance, the redemption (with the client
// IP), the consent artifact + method referenced at accept-student, membership
// activation, and mentor-assisted credential resets. Append-only (role REVOKE +
// the reject_append_only_mutation() trigger backstop in @curiolab/db): this
// writer only ever INSERTs; a correction is a NEW row.
//
// `detail` holds REFERENCES, not PII (ids, methods, event kinds) — never a name,
// narrative, or contact. `clientIp` is threaded from the HTTP layer for a
// request-bound event, and is null for a system/job event. Passing a transaction
// handle as `sql` appends inside a caller's transaction, so the ledger row commits
// atomically with the origination step it records.
// -------------------------------------------------------------------------

import type { Db, JSONValue } from './db.js'

/** The account-origination / access-provenance events the ledger records. */
export type AccessLedgerEvent =
  | 'invite.issued'
  | 'invite.redeemed'
  | 'accept_student.consent'
  | 'membership.activated'
  | 'recovery.guardian_routed'
  | 'recovery.mentor_assisted'
  // Two-factor auth (§10): 2FA enrollment activated, and a 2FA-gated login (the
  // second factor was supplied and a full session minted). Origination/access
  // provenance, like the recovery events — who proved a second factor, and when.
  | 'totp.enrolled'
  | 'login.two_factor'
  // Time-boxing (admin/director backend §7): a privileged (non-student) membership
  // whose term ended (or whose eligibility lapsed) is auto-revoked by the sweep —
  // its access closes rather than lingering. actor is null (a system job); the
  // subject is the membership's account; detail carries the reason (term_ended /
  // eligibility_lapsed) and the membership id.
  | 'membership.time_box_revoked'
  // Mentor eligibility as state (admin/director backend §6). A director/ops actor
  // RECORDED a mentor's eligibility component clearance (background check,
  // mandatory-reporter training, CWRU affiliation, signed code of conduct) — an
  // access-provenance event, like the recovery events. actor is the recording
  // director; subject is the mentor's account; detail carries the membershipId,
  // component, and expiry (never PII).
  | 'mentor.eligibility_recorded'
  // Consent grant ledger (admin/director backend §5). Every grant capture,
  // renewal, revocation, notify-and-object notification + outcome, and the
  // 18th-birthday transfer is recorded here with its method + artifact reference
  // — the audit/complaint defense. actor is the capturing guardian (or the
  // now-adult on a self-grant; null on a system job). detail carries the
  // grant_type, method, artifact ref, and outcome.
  | 'grant.captured'
  | 'grant.renewed'
  | 'grant.revoked'
  | 'grant.transferred'
  | 'publication.notified'
  | 'publication.objected'
  | 'publication.released'
  | 'publication.withheld'
  // Shared chapter calendar (guardian/director portal, Feature 1). A director
  // created, edited (a new revision), or canceled (a tombstone) a chapter calendar
  // event — an access-provenance event, like the org-structure writes. actor is the
  // recording director; the chapter is the event's chapter; detail carries the
  // eventId, the audience set, and (for an edit/cancel) the version bump — never PII.
  | 'calendar.created'
  | 'calendar.edited'
  | 'calendar.canceled'
  // Attendance & make-up check-ins (guardian/director portal, Feature 2). A
  // guardian submitted an attendance exception (an absent/late over a chapter
  // session), or a mentor/director completed a make-up check-in (a new append-only
  // revision, makeup_status -> completed) — an access-provenance event, like the
  // calendar writes. For a submission the actor is the guardian and the subject the
  // student; for a completion the actor is the resolving staff member. detail
  // carries the exceptionId, sessionEventId, type, and make-up status — never PII.
  | 'attendance.exception_submitted'
  | 'attendance.makeup_completed'

export interface AccessLedgerInput {
  event: AccessLedgerEvent
  /** Who caused the event (issuer / accepting account / assisting mentor); null for a system job. */
  actorAccountId?: string | null
  realActorAccountId?: string | null
  /** The subject the event concerns (the invited/target student or account). */
  subjectAccountId?: string | null
  /** The verified guardian a credential/consent is routed through (§3/§9). */
  guardianAccountId?: string | null
  chapterId?: string | null
  inviteId?: string | null
  inviteKind?: string | null
  targetEmail?: string | null
  /** The consent artifact + method referenced at accept-student (§8/§3). */
  consentRef?: string | null
  consentMethod?: string | null
  /** The trusted client IP threaded from the HTTP layer; null for a system event. */
  clientIp?: string | null
  /** References only, never PII. */
  detail?: Record<string, unknown>
}

/** Append one access_ledger row. Returns the new row id. */
export async function writeAccessLedger(sql: Db, entry: AccessLedgerInput): Promise<string> {
  const [row] = await sql`
    insert into access_ledger (
      event, actor_account_id, real_actor_account_id, subject_account_id,
      guardian_account_id, chapter_id, invite_id, invite_kind, target_email,
      consent_ref, consent_method, client_ip, detail
    ) values (
      ${entry.event}, ${entry.actorAccountId ?? null}, ${entry.realActorAccountId ?? null},
      ${entry.subjectAccountId ?? null}, ${entry.guardianAccountId ?? null}, ${entry.chapterId ?? null},
      ${entry.inviteId ?? null}, ${entry.inviteKind ?? null}, ${entry.targetEmail ?? null},
      ${entry.consentRef ?? null}, ${entry.consentMethod ?? null}, ${entry.clientIp ?? null},
      ${sql.json((entry.detail ?? {}) as unknown as JSONValue)}
    ) returning id
  `
  return row!.id as string
}
