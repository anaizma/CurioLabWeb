// POST /api/apply — Stage 1 lead capture (frontend-owned surface).
// Thin adapter: parse the body, call LeadService.createLead with the shared
// db client, return the created lead id as a uniform JSON Response.
// Contract: docs/platform/api-reference.md §1.
import { getSql } from '@curiolab/http'
import { LeadService } from '@curiolab/app'
import { sendParentContinueEmail } from '@/lib/emails/apply-mail'

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

  try {
    const result = await new LeadService({ sql: getSql() }).createLead({
      email,
      chapter,
      source,
      fillerRole,
    })
    // A parent-filler gets the raw token back, so email them the continue link
    // (a student-filler's link is emailed to the parent by the backend, which
    // holds that token). Best-effort: a send failure must not lose the lead.
    if (result.parentToken && process.env.RESEND_API_KEY) {
      const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin
      const continueUrl = `${origin}/apply/parent/${result.parentToken}`
      try {
        await sendParentContinueEmail(email, continueUrl)
      } catch (mailErr) {
        console.error('[api/apply] email send failed (lead still created):', mailErr)
      }
    }

    // parentToken: raw Stage-2 token for a parent-filler (frontend builds the
    // continue link); null for a student-filler and for a suppressed duplicate.
    return Response.json(
      { leadId: result.leadId, suppressed: result.suppressed, parentToken: result.parentToken },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/apply]', err)
    return Response.json({ error: 'server_error' }, { status: 500 })
  }
}
