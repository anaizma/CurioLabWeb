// -------------------------------------------------------------------------
// MessagingService — guardian <-> chapter-staff MESSAGING (guardian/director
// portal work order, Feature 3). A guardian and their child's chapter's staff (the
// chapter_director + that chapter's mentors) hold a threaded conversation, retained
// like email. A guardian starts a thread or appends to their own; staff of the
// chapter list/read the threads and reply.
//
// APPEND-ONLY (a platform invariant, migration 0028): a message is a NEW row in the
// append-only `message` log; a thread is INSERT-once. Nothing is edited in place or
// deleted. `last_message_at` is NOT a mutated column — it is DERIVED by the
// `message_thread_current` view as max(sent_at), so it advances forward as replies
// append without any destructive mutation. Every send / reply writes an audit +
// access_ledger row.
//
// sender_role is DERIVED SERVER-SIDE, never trusted from the client: a guardian
// send is always 'guardian'; a staff reply is 'director' (a chapter_director) or
// 'mentor' (a mentor tier), read from the replier's membership in the thread's
// chapter at send time.
//
// Authorization (registry rows):
//   - SEND (guardian): `message.send`, guardian-scoped, matched against
//     ctx.guardianOf; writes:true, so the age-18 bar applies. The "own thread" and
//     "a chapter the guardian has a child in" bounds are enforced here (a service
//     concern on top of the guardian scope): a NEW thread's chapter is resolved from
//     the guardian's verified child, and an APPEND requires the caller to own the
//     thread — a foreign/unresolvable anchor denies out_of_scope (opaque 403).
//   - VIEW_OWN (guardian): `message.view_own`, guardian-scoped read; the guardian's
//     OWN threads + messages. writes:false, no logsRead.
//   - VIEW (staff): `message.view`, chapter-scoped read floor, TEACHING roles; the
//     chapter's threads (list) and one thread (detail). Same-chapter check.
//   - REPLY (staff): `message.reply`, chapter-scoped write, TEACHING roles; a
//     mentor/director appends a reply (a new append-only message). Same-chapter check.
//
// MULTI-CHAPTER DISAMBIGUATION: a guardian with children in several chapters must
// say which one a NEW thread concerns. `childAccountId` (preferred) or `chapterId`
// picks it; with a single eligible chapter neither is needed; with several and
// neither given it is an ambiguous 400. The chosen chapter must be one the guardian
// has a verified child in (the guardian scope + the resolved anchor guarantee it).
//
// Framework-agnostic: the db handle and `authorize` are injected; the thin Next
// adapters + controllers live in packages/http.
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { Sql, TransactionSql } from 'postgres'
import type { AuthContext, Resource, Role } from '@curiolab/core'
import { assertAuthorized, writeAudit, writeAccessLedger, type AuthorizeDeps } from '@curiolab/runtime'
import { MessageThreadNotFoundError, MessagingValidationError } from './errors.js'

type Db = Sql | TransactionSql

/** The four capabilities this service gates on (send / own-read / staff-read / reply). */
export type MessagingCapability =
  | 'message.send'
  | 'message.view_own'
  | 'message.view'
  | 'message.reply'

/** The injected `authorize` dependency, narrowed to this service's capabilities. */
export type MessagingAuthorizeFn = <T = void>(
  ctx: AuthContext,
  capability: MessagingCapability,
  resource: Resource,
  deps: AuthorizeDeps<T>,
) => Promise<T | undefined>

export interface MessagingServiceDeps {
  sql: Sql
  authorize: MessagingAuthorizeFn
}

export type MessageSenderRole = 'guardian' | 'mentor' | 'director'

/** A message object (all surfaces; sentAt ISO-8601 UTC). senderName is the sender's display name. */
export interface Message {
  id: string
  threadId: string
  senderAccountId: string
  senderRole: MessageSenderRole
  senderName: string
  body: string
  sentAt: string
}

/** The neutral thread object (timestamps ISO-8601 UTC). */
export interface MessageThread {
  id: string
  chapterId: string
  guardianAccountId: string
  subject: string | null
  createdAt: string
  lastMessageAt: string
}

/** Guardian read: a thread with its full message list nested. */
export interface GuardianThread extends MessageThread {
  messages: Message[]
}

/** Staff list item: a thread with the guardian's display name + a last-message preview. */
export interface StaffThreadListItem extends MessageThread {
  guardianName: string
  lastMessage: Message | null
}

/** Staff detail: a thread with the guardian name + its full message list. */
export interface StaffThreadDetail extends MessageThread {
  guardianName: string
  messages: Message[]
}

export interface SendMessageInput {
  /** Append to this thread if given (must be the caller's OWN thread); else create a new one. */
  threadId?: string | null
  /** Optional headline for a NEW thread. */
  subject?: string | null
  body: string
  /** Disambiguates a NEW thread's chapter for a multi-chapter guardian (preferred). */
  childAccountId?: string | null
  /** Disambiguates a NEW thread's chapter for a multi-chapter guardian. */
  chapterId?: string | null
}

export interface StaffThreadsQuery {
  chapterId?: string | null
}

const TEACHING_ROLES: readonly Role[] = [
  'junior_mentor',
  'senior_instructor',
  'lead_instructor',
  'chapter_director',
]

// ---- helpers ---------------------------------------------------------------

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString()
}

/** Whole years from `dob` to `at` (birthday-aware, UTC). */
function ageInYears(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear()
  const m = at.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

/** A membership is in force iff active AND active_from <= now < active_until. */
function inForce(m: AuthContext['memberships'][number], now: number): boolean {
  if (m.status !== 'active') return false
  if (m.active_from !== null && m.active_from > now) return false
  if (m.active_until !== null && now >= m.active_until) return false
  return true
}

function toMessage(r: Record<string, unknown>): Message {
  return {
    id: r.id as string,
    threadId: r.thread_id as string,
    senderAccountId: r.sender_account_id as string,
    senderRole: r.sender_role as MessageSenderRole,
    senderName: (r.sender_name as string | null) ?? '',
    body: r.body as string,
    sentAt: iso(r.sent_at),
  }
}

function toThread(r: Record<string, unknown>): MessageThread {
  return {
    id: r.id as string,
    chapterId: r.chapter_id as string,
    guardianAccountId: r.guardian_account_id as string,
    subject: (r.subject as string | null) ?? null,
    createdAt: iso(r.created_at),
    lastMessageAt: iso(r.last_message_at ?? r.created_at),
  }
}

interface EligibleChild {
  childId: string
  chapterId: string
  age: number
}

// ---------------------------------------------------------------------------

export class MessagingService {
  private readonly sql: Sql
  private readonly authorize: MessagingAuthorizeFn

  constructor(deps: MessagingServiceDeps) {
    this.sql = deps.sql
    this.authorize = deps.authorize
  }

  /**
   * The guardian's verified children that resolve to an active chapter, with each
   * child's age (from ctx.now). One row per (child, chapter); the caller groups.
   */
  private async loadEligibleChildren(ctx: AuthContext): Promise<EligibleChild[]> {
    if (ctx.guardianOf.length === 0) return []
    const rows = await this.sql`
      select a.id as child_id, m.chapter_id, a.date_of_birth as dob
      from membership m
      join account a on a.id = m.account_id
      where m.account_id in ${this.sql(ctx.guardianOf)} and m.status = 'active'
    `
    return rows.map((r) => ({
      childId: r.child_id as string,
      chapterId: r.chapter_id as string,
      age: r.dob != null ? ageInYears(new Date(r.dob as string), new Date(ctx.now)) : 0,
    }))
  }

  /** Load a thread's current-state row (with derived last_message_at). */
  private async loadThread(threadId: string): Promise<Record<string, unknown> | null> {
    const [row] = await this.sql`
      select id, chapter_id, guardian_account_id, subject, created_at, last_message_at
      from message_thread_current where id = ${threadId}
    `
    return row ?? null
  }

  /** All messages in a thread (with the sender's display name), oldest first. */
  private async loadMessages(threadIds: readonly string[]): Promise<Message[]> {
    if (threadIds.length === 0) return []
    const rows = await this.sql`
      select m.id, m.thread_id, m.sender_account_id, m.sender_role, m.body, m.sent_at,
             a.display_name as sender_name
      from message m
      join account a on a.id = m.sender_account_id
      where m.thread_id in ${this.sql(threadIds)}
      order by m.seq asc
    `
    return rows.map(toMessage)
  }

  /** Insert one message + its audit/ledger provenance (append-only). */
  private async writeMessage(
    tx: Db,
    ctx: AuthContext,
    args: {
      threadId: string
      chapterId: string
      guardianAccountId: string
      senderRole: MessageSenderRole
      body: string
      senderName: string
      ledgerEvent: 'message.sent' | 'message.replied'
      auditAction: string
    },
  ): Promise<Message> {
    const [row] = await tx`
      insert into message (thread_id, sender_account_id, sender_role, body)
      values (${args.threadId}, ${ctx.account.id}, ${args.senderRole}, ${args.body})
      returning id, thread_id, sender_account_id, sender_role, body, sent_at
    `
    const realActor = ctx.session.impersonation?.real_actor_account_id ?? null
    const detail = { threadId: args.threadId, messageId: row!.id as string, senderRole: args.senderRole }
    await writeAudit(tx, {
      action: args.auditAction,
      subjectType: 'message_thread',
      subjectId: args.threadId,
      actorAccountId: ctx.account.id,
      realActorAccountId: realActor,
      chapterId: args.chapterId,
      detail,
    })
    await writeAccessLedger(tx, {
      event: args.ledgerEvent,
      actorAccountId: ctx.account.id,
      realActorAccountId: realActor,
      subjectAccountId: args.guardianAccountId,
      chapterId: args.chapterId,
      detail,
    })
    return toMessage({ ...row!, sender_name: args.senderName })
  }

  /**
   * POST /guardian/messages — a guardian creates a thread or appends to their OWN
   * thread (`message.send`, guardian-scoped). Resolves the target chapter + an
   * anchor child (the guardian scope's subject); a foreign/unresolvable anchor
   * denies out_of_scope (opaque 403 — another guardian's thread, or a chapter with
   * no child). A NEW thread for a multi-chapter guardian needs childAccountId /
   * chapterId to disambiguate (else an ambiguous 400).
   */
  async sendGuardianMessage(input: SendMessageInput, ctx: AuthContext): Promise<Message> {
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (body === '') throw new MessagingValidationError('body', 'a message requires a non-empty body')

    const eligible = await this.loadEligibleChildren(ctx)
    // Per chapter, keep the YOUNGEST child (most permissive for the write age bar).
    const byChapter = new Map<string, EligibleChild>()
    for (const e of eligible) {
      const cur = byChapter.get(e.chapterId)
      if (cur === undefined || e.age < cur.age) byChapter.set(e.chapterId, e)
    }
    const youngestOverall = eligible.reduce<EligibleChild | null>(
      (min, e) => (min === null || e.age < min.age ? e : min),
      null,
    )

    let threadId: string | null = null
    let targetChapter: string | null = null
    let anchor: EligibleChild | null = null
    let anchorSubject: string | null = null // the authorize subject (may be a foreign id -> deny)
    let subject: string | null = null

    if (input.threadId != null && input.threadId !== '') {
      // Append: the thread must exist and be the caller's OWN.
      const thread = await this.loadThread(input.threadId)
      if (thread === null) throw new MessageThreadNotFoundError(input.threadId)
      threadId = input.threadId
      targetChapter = thread.chapter_id as string
      const owner = (thread.guardian_account_id as string) === ctx.account.id
      // For an owner, anchor on a verified child in the thread's chapter (else any
      // verified child); for a non-owner, no anchor -> authorize denies out_of_scope.
      anchor = owner ? byChapter.get(targetChapter) ?? youngestOverall : null
      anchorSubject = owner ? anchor?.childId ?? null : null
    } else {
      // Create: resolve the chapter + anchor from the disambiguator.
      if (input.childAccountId != null && input.childAccountId !== '') {
        const child = eligible.find((e) => e.childId === input.childAccountId) ?? null
        if (child !== null) {
          anchor = child
          targetChapter = child.chapterId
        }
        // A child not among the guardian's verified children -> deny via authorize.
        anchorSubject = anchor?.childId ?? input.childAccountId
      } else if (input.chapterId != null && input.chapterId !== '') {
        anchor = byChapter.get(input.chapterId) ?? null
        targetChapter = input.chapterId
        anchorSubject = anchor?.childId ?? null
      } else {
        const chapters = [...byChapter.keys()]
        if (chapters.length > 1) {
          throw new MessagingValidationError(
            'chapter',
            'a guardian with children in multiple chapters must specify childAccountId or chapterId',
          )
        }
        anchor = chapters.length === 1 ? byChapter.get(chapters[0]!) ?? null : null
        targetChapter = anchor?.chapterId ?? null
        anchorSubject = anchor?.childId ?? null
      }
      subject = typeof input.subject === 'string' && input.subject.trim() !== '' ? input.subject : null
    }

    const resource: Resource = {
      subjectAccountId: anchorSubject,
      subjectAge: anchor?.age,
      subjectIsMinor: anchor != null ? anchor.age < 18 : undefined,
      chapter_id: targetChapter,
    }
    await this.authorize(ctx, 'message.send', resource, { sql: this.sql })

    // Reachable only on allow, which guaranteed a resolved chapter + verified child.
    const chapterId = targetChapter as string
    const [senderRow] = await this.sql`select display_name from account where id = ${ctx.account.id}`
    const senderName = (senderRow?.display_name as string | null) ?? ''

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      let tid = threadId
      if (tid === null) {
        const newId = randomUUID()
        const [t] = await tx`
          insert into message_thread (id, chapter_id, guardian_account_id, subject)
          values (${newId}, ${chapterId}, ${ctx.account.id}, ${subject})
          returning id
        `
        tid = t!.id as string
      }
      return this.writeMessage(tx, ctx, {
        threadId: tid,
        chapterId,
        guardianAccountId: ctx.account.id,
        senderRole: 'guardian',
        body,
        senderName,
        ledgerEvent: 'message.sent',
        auditAction: 'message.sent',
      })
    }) as Promise<Message>
  }

  /**
   * GET /guardian/messages — the guardian's OWN threads + nested messages
   * (`message.view_own`, guardian-scoped read). A session with no verified child
   * denies out_of_scope. Threads newest-activity first.
   */
  async viewGuardianThreads(ctx: AuthContext): Promise<{ items: GuardianThread[] }> {
    const anchor = ctx.guardianOf[0]
    const resource: Resource =
      anchor != null ? { subjectAccountId: anchor } : { subjectAccountId: null }
    await this.authorize(ctx, 'message.view_own', resource, { sql: this.sql })

    const threadRows = await this.sql`
      select id, chapter_id, guardian_account_id, subject, created_at, last_message_at
      from message_thread_current
      where guardian_account_id = ${ctx.account.id}
      order by last_message_at desc
    `
    const threads = threadRows.map(toThread)
    const messages = await this.loadMessages(threads.map((t) => t.id))
    const byThread = new Map<string, Message[]>()
    for (const m of messages) {
      const arr = byThread.get(m.threadId) ?? []
      arr.push(m)
      byThread.set(m.threadId, arr)
    }
    return { items: threads.map((t) => ({ ...t, messages: byThread.get(t.id) ?? [] })) }
  }

  /**
   * GET /ops/messages — the staff thread list (`message.view`, chapter-scoped).
   * Resolves the chapter(s): an explicit chapterId (a cross-chapter caller denies
   * out_of_scope), else the caller's in-force teaching chapters, else (a platform
   * reader) all. Each thread carries the guardian's display name + a last-message
   * preview. Threads newest-activity first.
   */
  async listStaffThreads(
    ctx: AuthContext,
    query: StaffThreadsQuery = {},
  ): Promise<{ items: StaffThreadListItem[] }> {
    const sql = this.sql
    const requested = query.chapterId

    let chapters: string[] | null
    if (requested != null && requested !== '') {
      await this.authorize(ctx, 'message.view', { chapter_id: requested }, { sql })
      chapters = [requested]
    } else {
      const teaching = this.teachingChapters(ctx)
      if (teaching.length > 0) {
        await this.authorize(ctx, 'message.view', { chapter_id: teaching[0]! }, { sql })
        chapters = teaching
      } else {
        await this.authorize(ctx, 'message.view', {}, { sql })
        chapters = null
      }
    }

    const threadRows = await sql`
      select mtc.id, mtc.chapter_id, mtc.guardian_account_id, mtc.subject, mtc.created_at,
             mtc.last_message_at, ga.display_name as guardian_name
      from message_thread_current mtc
      join account ga on ga.id = mtc.guardian_account_id
      where ${chapters === null ? sql`true` : sql`mtc.chapter_id in ${sql(chapters)}`}
      order by mtc.last_message_at desc
    `
    const threads = threadRows.map((r) => ({
      thread: toThread(r),
      guardianName: r.guardian_name as string,
    }))

    // The latest message per thread (the list preview), in one query.
    const ids = threads.map((t) => t.thread.id)
    const lastByThread = new Map<string, Message>()
    if (ids.length > 0) {
      const rows = await sql`
        select distinct on (m.thread_id)
          m.id, m.thread_id, m.sender_account_id, m.sender_role, m.body, m.sent_at,
          a.display_name as sender_name
        from message m
        join account a on a.id = m.sender_account_id
        where m.thread_id in ${sql(ids)}
        order by m.thread_id, m.seq desc
      `
      for (const r of rows) lastByThread.set(r.thread_id as string, toMessage(r))
    }

    return {
      items: threads.map((t) => ({
        ...t.thread,
        guardianName: t.guardianName,
        lastMessage: lastByThread.get(t.thread.id) ?? null,
      })),
    }
  }

  /**
   * GET /ops/messages/:threadId — one thread with its full message list
   * (`message.view`, chapter-scoped; same-chapter check). An unknown thread is a
   * typed not-found; a thread in another chapter denies out_of_scope.
   */
  async getStaffThread(threadId: string, ctx: AuthContext): Promise<StaffThreadDetail> {
    const thread = await this.loadThread(threadId)
    if (thread === null) throw new MessageThreadNotFoundError(threadId)

    await this.authorize(
      ctx,
      'message.view',
      { id: threadId, chapter_id: thread.chapter_id as string },
      { sql: this.sql },
    )

    const guardianAccountId = thread.guardian_account_id as string
    const [ga] = await this.sql`select display_name from account where id = ${guardianAccountId}`
    const messages = await this.loadMessages([threadId])
    return {
      ...toThread(thread),
      guardianName: (ga?.display_name as string | null) ?? '',
      messages,
    }
  }

  /**
   * POST /ops/messages/:threadId/reply — a mentor/director appends a reply
   * (`message.reply`, chapter-scoped write; same-chapter check). sender_role is
   * DERIVED from the replier's membership in the thread's chapter (director vs
   * mentor); never trusted from the client. A new append-only message.
   */
  async replyStaffMessage(
    threadId: string,
    input: { body: string },
    ctx: AuthContext,
  ): Promise<Message> {
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (body === '') throw new MessagingValidationError('body', 'a reply requires a non-empty body')

    const thread = await this.loadThread(threadId)
    if (thread === null) throw new MessageThreadNotFoundError(threadId)
    const chapterId = thread.chapter_id as string

    await this.authorize(ctx, 'message.reply', { id: threadId, chapter_id: chapterId }, { sql: this.sql })

    const senderRole = this.deriveStaffRole(ctx, chapterId)
    const [senderRow] = await this.sql`select display_name from account where id = ${ctx.account.id}`
    const senderName = (senderRow?.display_name as string | null) ?? ''

    return this.sql.begin(async (tx) => {
      assertAuthorized()
      return this.writeMessage(tx, ctx, {
        threadId,
        chapterId,
        guardianAccountId: thread.guardian_account_id as string,
        senderRole,
        body,
        senderName,
        ledgerEvent: 'message.replied',
        auditAction: 'message.replied',
      })
    }) as Promise<Message>
  }

  /** In-force chapters where the actor holds a teaching role. */
  private teachingChapters(ctx: AuthContext): string[] {
    const out = new Set<string>()
    for (const m of ctx.memberships) {
      if (!inForce(m, ctx.now) || !TEACHING_ROLES.includes(m.role)) continue
      out.add(m.chapter_id)
    }
    return [...out]
  }

  /**
   * The server-derived sender_role for a staff reply: 'director' if the replier
   * holds a chapter_director membership in the thread's chapter, else 'mentor' for a
   * mentor tier. A platform override with no chapter membership falls back to
   * 'director' (a platform reader acts with director-level authority).
   */
  private deriveStaffRole(ctx: AuthContext, chapterId: string): MessageSenderRole {
    let isTeaching = false
    for (const m of ctx.memberships) {
      if (!inForce(m, ctx.now) || m.chapter_id !== chapterId) continue
      if (m.role === 'chapter_director') return 'director'
      if (TEACHING_ROLES.includes(m.role)) isTeaching = true
    }
    return isTeaching ? 'mentor' : 'director'
  }
}
