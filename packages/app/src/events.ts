import type { Sql, TransactionSql } from 'postgres'

/** A connection or an open transaction; the event insert runs in either. */
export type Db = Sql | TransactionSql

/** One `application_event` row: (application_id, from, to, actor, note, at). */
export interface ApplicationEventInput {
  applicationId: string
  fromStatus: string | null
  toStatus: string
  actorId: string | null
  note?: string | null
}

/** The injectable event-append seam (defaults to {@link writeApplicationEvent}). */
export type EventWriter = (db: Db, event: ApplicationEventInput) => Promise<string>

/**
 * Append one `application_event`. Passing a transaction handle as `db` runs the
 * insert inside the caller's transaction, which is what makes the status change
 * and the event insert commit together (atomic transition).
 */
export const writeApplicationEvent: EventWriter = async (db, event) => {
  const [row] = await db`
    insert into application_event (application_id, from_status, to_status, actor_id, note)
    values (
      ${event.applicationId}, ${event.fromStatus}, ${event.toStatus},
      ${event.actorId}, ${event.note ?? null}
    ) returning id
  `
  return row!.id as string
}
