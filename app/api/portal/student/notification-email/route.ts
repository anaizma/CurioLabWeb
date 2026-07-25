// Student notification-email settings (DARK — COUNSEL-GATED).
// GET /api/portal/student/notification-email — the settings-screen model
//   (student.view_notification_email, own).
// PUT /api/portal/student/notification-email — set/update/clear the OWN primary
//   (student.set_notification_email, own); body { email: string | null }.
import { cookies } from 'next/headers'
import { getSql, viewNotificationEmail, setNotificationEmail, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await viewNotificationEmail({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}

export async function PUT(req: Request) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await setNotificationEmail({ sql: getSql(), sessionToken, body })
  return Response.json(out, { status })
}
