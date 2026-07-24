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
