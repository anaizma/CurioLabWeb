// POST /api/auth/totp/enroll — begin forced TOTP enrollment for a
// `totpEnrollmentRequired` login. Returns the secret + otpauth:// provisioning
// URI (no QR image; the frontend renders it). Mints no session.
import { getSql, beginTotpEnrollment, readJson } from '@curiolab/http'

export async function POST(req: Request) {
  const body = await readJson(req)
  const result = await beginTotpEnrollment({ sql: getSql(), body })
  return Response.json(result.body, { status: result.status })
}
