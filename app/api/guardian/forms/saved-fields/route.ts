import { cookies } from 'next/headers'
import { getSql, getSavedFields, SESSION_COOKIE } from '@curiolab/http'

export async function GET() {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const { status, body } = await getSavedFields({ sql: getSql(), sessionToken })
  return Response.json(body, { status })
}
