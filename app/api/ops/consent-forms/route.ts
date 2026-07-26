// GET /api/ops/consent-forms — the consent catalog summaries (consent.form.read).
import { cookies } from 'next/headers'
import { getSql, listConsentForms, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await listConsentForms({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
