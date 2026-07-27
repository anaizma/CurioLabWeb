// POST /api/apply — Stage 1 lead capture (frontend-owned surface).
// Thin adapter: parse the body, call LeadService.createLead with the shared
// db client, return the created lead id as a uniform JSON Response.
// Contract: docs/platform/api-reference.md §1.
import { getSql } from '@curiolab/http'
import { LeadService } from '@curiolab/app'
import { sendParentContinueEmail, sendDirectorLeadNotification } from '@/lib/emails/apply-mail'
import { clientIp, verifyTurnstile, turnstileRefusal, TURNSTILE_FIELD } from '@/lib/turnstile'
import { resolveAppUrl } from '@/lib/app-url'
import {
  checkAndRecord,
  emailAndIpBuckets,
  rateLimitRefusal,
  APPLY_EMAIL_LIMIT,
  APPLY_IP_LIMIT,
} from '@/lib/rate-limit'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const chapter = typeof body.chapter === 'string' ? body.chapter.trim() : ''
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : null
  const fillerRole = body.fillerRole === 'student' ? ('student' as const) : ('parent' as const)

  // Input guards (the service does not validate presence; api-reference §1 note).
  if (!/.+@.+\..+/.test(email)) {
    return Response.json({ error: 'invalid_request', field: 'email' }, { status: 400 })
  }
  if (chapter === '') {
    return Response.json({ error: 'invalid_request', field: 'chapter' }, { status: 400 })
  }

  const sql = getSql()
  const ip = clientIp(req)

  // Bot check BEFORE any write or send, so a failed challenge costs nothing.
  const bot = await verifyTurnstile(body[TURNSTILE_FIELD], ip)
  if (!bot.ok) {
    console.warn('[api/apply] turnstile rejected:', bot.errorCodes?.join(',') ?? 'unknown')
    return turnstileRefusal()
  }

  // Throttle second: this endpoint sends two emails per accepted call.
  const limited = await checkAndRecord(
    sql,
    'apply',
    emailAndIpBuckets(email, ip, APPLY_EMAIL_LIMIT, APPLY_IP_LIMIT),
  )
  if (!limited.ok) {
    console.warn(`[api/apply] rate limited on ${limited.exceeded}`)
    return rateLimitRefusal(limited.retryAfterSeconds)
  }

  // The chapter code MUST resolve to a real chapter. Without this the lead is
  // created with a null chapter_id, the family fills in every section, and
  // submitStage2 then refuses (Stage2LeadChapterRequiredError) with a generic
  // 400 they cannot act on — a dead end that strands their work. Rejecting the
  // unknown code up front makes that state unreachable.
  const [known] = await sql`select 1 from chapter where slug = ${chapter} limit 1`
  if (known === undefined) {
    return Response.json({ error: 'invalid_request', field: 'chapter' }, { status: 400 })
  }

  try {
    const result = await new LeadService({ sql }).createLead({
      email,
      chapter,
      source,
      fillerRole,
    })
    // A parent-filler gets the raw token back, so email them the continue link
    // (a student-filler's link is emailed to the parent by the backend, which
    // holds that token). Best-effort: a send failure must not lose the lead.
    if (result.parentToken && process.env.RESEND_API_KEY) {
      const origin = resolveAppUrl(req)
      const continueUrl = `${origin}/apply/parent/${result.parentToken}`
      try {
        await sendParentContinueEmail(email, continueUrl)
      } catch (mailErr) {
        console.error('[api/apply] email send failed (lead still created):', mailErr)
      }
    }

    // Notify the director only for a genuinely NEW lead (a resend reuses an open
    // lead the director already saw, so it does not re-notify). Best-effort: a send
    // failure must not lose the lead, so it is logged and swallowed - identical to
    // the continue-link send above.
    if (!result.resent && process.env.RESEND_API_KEY) {
      const origin = resolveAppUrl(req)
      try {
        await sendDirectorLeadNotification({ leadEmail: email, chapter, fillerRole, source, appUrl: origin })
      } catch (mailErr) {
        console.error('[api/apply] director notification failed (lead still created):', mailErr)
      }
    }

    // parentToken: raw Stage-2 token for a parent-filler (frontend builds the
    // continue link); null for a student-filler and for a suppressed duplicate.
    return Response.json(
      { leadId: result.leadId, suppressed: result.suppressed, parentToken: result.parentToken, resent: result.resent },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/apply]', err)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
