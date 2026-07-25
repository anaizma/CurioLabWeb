// -------------------------------------------------------------------------
// Student notification-email settings controllers (DARK, COUNSEL-GATED) — the
// student-facing PRIMARY/SECONDARY self-service surface
// (StudentNotificationSettingsService).
//
//   viewNotificationEmail  GET  /api/portal/student/notification-email
//                          own-scoped read (student.view_notification_email) — the
//                          settings-screen model { primary, secondary }.
//   setNotificationEmail   PUT  /api/portal/student/notification-email
//                          own-scoped write (student.set_notification_email) — set /
//                          update / clear the PRIMARY. Body { email: string | null }
//                          (null clears, reverting to parent-only).
//
// Both act on the acting student's OWN account (the own scope binds the subject to
// ctx.account.id). The write is refused opaque 403 unless the flag is on AND the
// student is 13+ AND an active student_notification_email grant is on file; a
// malformed email is a 400 (checked after the gate). DARK by default.
// -------------------------------------------------------------------------

import {
  StudentNotificationSettingsService,
  type NotificationEmailSettings,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

function settingsService(sql: AuthedInputBase['sql']): StudentNotificationSettingsService {
  return new StudentNotificationSettingsService({ sql, authorize })
}

export type ViewNotificationEmailInput = AuthedInputBase

/**
 * GET /api/portal/student/notification-email — the settings-screen model for the
 * acting student (student.view_notification_email, own). Returns
 * `{ primary: { email, isOwn, editable }, secondary: { email, editable: false } }`.
 */
export function viewNotificationEmail(
  input: ViewNotificationEmailInput,
): Promise<ControllerResult<NotificationEmailSettings>> {
  return runAuthed(input, async (ctx, sql) => {
    const body = await settingsService(sql).viewSettings(ctx, { now: input.now })
    return { status: 200, body }
  })
}

export interface SetNotificationEmailInput extends AuthedInputBase {
  /** `{ email: string | null }` — a string sets/updates the primary, null clears it. */
  body: { email?: unknown }
}

/**
 * PUT /api/portal/student/notification-email — set / update / clear the acting
 * student's OWN primary notification email (student.set_notification_email, own).
 * A string value sets it; `null` (or an absent/non-string value) clears it,
 * reverting to parent-only. Refused opaque 403 unless the flag is on + 13+ + an
 * active student_notification_email grant; a malformed address is a 400.
 */
export function setNotificationEmail(
  input: SetNotificationEmailInput,
): Promise<ControllerResult<NotificationEmailSettings>> {
  return runAuthed(input, async (ctx, sql) => {
    const raw = input.body?.email
    const email = typeof raw === 'string' ? raw : null
    const body = await settingsService(sql).setPrimaryEmail(email, ctx, { now: input.now })
    return { status: 200, body }
  })
}
