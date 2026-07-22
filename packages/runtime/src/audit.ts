// -------------------------------------------------------------------------
// The audit writer (02-data-model.md `audit_entry`; 03-authorization.md).
//
// `audit_entry` is append-only (role-level REVOKE plus a trigger backstop in
// @curiolab/db). This writer only ever INSERTs. `detail` holds REFERENCES, not
// PII: ids, capability names, reasons — never a name, narrative, or contact.
// Passing a transaction handle as `sql` runs the append inside a caller's
// transaction, which is what makes the minor_record.read obligation atomic with
// the guarded read (must-not #25).
// -------------------------------------------------------------------------

import type { Db, JSONValue } from './db.js'

export interface AuditEntryInput {
  action: string
  subjectType: string
  subjectId?: string | null
  actorAccountId?: string | null
  realActorAccountId?: string | null
  chapterId?: string | null
  /** References only, never PII. */
  detail?: Record<string, unknown>
}

/** Append one audit_entry row. Returns the new row id. */
export async function writeAudit(sql: Db, entry: AuditEntryInput): Promise<string> {
  const [row] = await sql`
    insert into audit_entry (
      actor_account_id, real_actor_account_id, action,
      subject_type, subject_id, chapter_id, detail
    ) values (
      ${entry.actorAccountId ?? null}, ${entry.realActorAccountId ?? null}, ${entry.action},
      ${entry.subjectType}, ${entry.subjectId ?? null}, ${entry.chapterId ?? null},
      ${sql.json((entry.detail ?? {}) as unknown as JSONValue)}
    ) returning id
  `
  return row!.id as string
}
