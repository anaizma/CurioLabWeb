// POST /api/public/stage2/submit — 2C submit (parent token only); mints the application.
//
// After the application row is committed, the director is emailed the completed
// application. That mail is both the arrival notice and an INDEPENDENT COPY of
// the submission, held somewhere that does not share failure modes with the
// application database (see lib/emails/apply-mail.ts).
//
// The send is strictly best-effort and happens AFTER the transaction: the family
// has submitted, the row exists, and no mail problem may turn that into an error
// for them. A failure is logged loudly instead, because a silent failure here
// would quietly cost the off-site copy.
import { getSql, submitStage2 } from '@curiolab/http'
import { resolveAppUrl } from '@/lib/app-url'
import { sendApplicationSubmittedNotification } from '@/lib/emails/apply-mail'
import { labelAnswers, DUPLICATE_PARENT_KEYS } from '@/lib/emails/label-answers'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const sql = getSql()
  const { status, body: out } = await submitStage2({ sql, body })

  const applicationId = (out as { applicationId?: string }).applicationId
  if (status === 201 && applicationId !== undefined && process.env.RESEND_API_KEY) {
    try {
      const [app] = await sql`
        select a.applicant_name, a.guardian_name, a.guardian_email,
               d.parent_answers, d.student_answers, f.definition
        from application a
        left join application_draft d on d.converted_application_id = a.id
        left join application_form f on f.id = a.form_id
        where a.id = ${applicationId}
      `
      if (app !== undefined) {
        await sendApplicationSubmittedNotification({
          applicationId,
          studentName: (app.applicant_name as string | null) ?? null,
          guardianName: (app.guardian_name as string | null) ?? null,
          guardianEmail: (app.guardian_email as string | null) ?? null,
          parentAnswers: labelAnswers(app.definition, 'parent', app.parent_answers, DUPLICATE_PARENT_KEYS),
          studentAnswers: labelAnswers(app.definition, 'student', app.student_answers),
          appUrl: resolveAppUrl(req),
        })
      }
    } catch (err) {
      // Loud: the application is safe, but the off-site copy did not get made.
      console.error(
        `[stage2/submit] submitted-application email FAILED for ${applicationId} — the application is stored, but no email copy exists:`,
        err,
      )
    }
  }

  return Response.json(out, { status })
}
