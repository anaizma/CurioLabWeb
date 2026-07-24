// -------------------------------------------------------------------------
// Guardian <-> chapter-staff messaging controllers (guardian/director portal work
// order, Feature 3). Thin adapters over the framework-agnostic MessagingService:
// resolve the session to an AuthContext (runAuthed), then call the service, which
// gates through `authorize` and reads/writes the append-only message log.
//
//   submitMessage        POST /api/guardian/messages                (message.send)
//   viewGuardianMessages GET  /api/guardian/messages                (message.view_own; GET-exempt)
//   listStaffMessages    GET  /api/ops/messages                     (message.view; GET-exempt)
//   getStaffThread       GET  /api/ops/messages/:threadId           (message.view; GET-exempt)
//   replyStaffMessage    POST /api/ops/messages/:threadId/reply     (message.reply)
//
// A null session is an opaque 403 (runAuthed); a cross-guardian / non-staff /
// cross-chapter caller is an opaque 403 from the service's authorize (Forbidden).
// sender_role is DERIVED server-side by the service (a client-supplied role is
// ignored) — the controllers never read a role from the body.
// -------------------------------------------------------------------------

import type { Sql } from 'postgres'
import {
  MessagingService,
  type GuardianThread,
  type Message,
  type SendMessageInput,
  type StaffThreadDetail,
  type StaffThreadListItem,
} from '@curiolab/app'
import { authorize } from '@curiolab/runtime'
import { runAuthed } from '../run.js'
import { optStr, reqStr } from '../respond.js'
import type { AuthedInputBase, ControllerResult } from '../types.js'

type QueryValue = string | string[] | null | undefined

function svc(sql: Sql) {
  return new MessagingService({ sql, authorize })
}

export interface SubmitMessageInput extends AuthedInputBase {
  body: {
    threadId?: unknown
    subject?: unknown
    body?: unknown
    childAccountId?: unknown
    chapterId?: unknown
  }
}

/** POST /api/guardian/messages — a guardian creates a thread or appends to their own. */
export function submitMessage(input: SubmitMessageInput): Promise<ControllerResult<Message>> {
  return runAuthed(input, async (ctx, sql) => {
    const b = input.body ?? {}
    // sender_role is intentionally NOT read from the body — the service derives it.
    const payload: SendMessageInput = {
      threadId: optStr(b.threadId),
      subject: optStr(b.subject),
      body: reqStr(b.body, 'body'),
      childAccountId: optStr(b.childAccountId),
      chapterId: optStr(b.chapterId),
    }
    const message = await svc(sql).sendGuardianMessage(payload, ctx)
    return { status: 201, body: message }
  })
}

/** GET /api/guardian/messages — the guardian's own threads + nested messages. */
export function viewGuardianMessages(
  input: AuthedInputBase,
): Promise<ControllerResult<{ items: GuardianThread[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).viewGuardianThreads(ctx)
    return { status: 200, body: result }
  })
}

export interface StaffMessagesInput extends AuthedInputBase {
  query?: Record<string, QueryValue>
}

/** GET /api/ops/messages — the staff thread list for a chapter (?chapterId=). */
export function listStaffMessages(
  input: StaffMessagesInput,
): Promise<ControllerResult<{ items: StaffThreadListItem[] }>> {
  return runAuthed(input, async (ctx, sql) => {
    const result = await svc(sql).listStaffThreads(ctx, { chapterId: optStr(input.query?.chapterId) })
    return { status: 200, body: result }
  })
}

export interface StaffThreadInput extends AuthedInputBase {
  params: { threadId?: unknown }
}

/** GET /api/ops/messages/:threadId — one thread with its full message list. */
export function getStaffThread(input: StaffThreadInput): Promise<ControllerResult<StaffThreadDetail>> {
  return runAuthed(input, async (ctx, sql) => {
    const threadId = reqStr(input.params?.threadId, 'threadId')
    const result = await svc(sql).getStaffThread(threadId, ctx)
    return { status: 200, body: result }
  })
}

export interface ReplyMessageInput extends AuthedInputBase {
  params: { threadId?: unknown }
  body: { body?: unknown }
}

/** POST /api/ops/messages/:threadId/reply — a mentor/director appends a reply. */
export function replyStaffMessage(input: ReplyMessageInput): Promise<ControllerResult<Message>> {
  return runAuthed(input, async (ctx, sql) => {
    const threadId = reqStr(input.params?.threadId, 'threadId')
    const body = reqStr(input.body?.body, 'body')
    const message = await svc(sql).replyStaffMessage(threadId, { body }, ctx)
    return { status: 201, body: message }
  })
}
