// PATCH  /api/ops/calendar/:id — edit an event (a new revision; calendar.manage).
// DELETE /api/ops/calendar/:id — cancel an event (a tombstone; calendar.manage).
import { cookies } from 'next/headers'
import { getSql, editCalendarEvent, cancelCalendarEvent, SESSION_COOKIE } from '@curiolab/http'

export async function PATCH(req: Request, ctx: RouteContext<'/api/ops/calendar/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const { status, body: out } = await editCalendarEvent({ sql: getSql(), sessionToken, params, body })
  return Response.json(out, { status })
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/ops/calendar/[id]'>) {
  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null
  const params = await ctx.params
  const { status, body: out } = await cancelCalendarEvent({ sql: getSql(), sessionToken, params })
  return Response.json(out, { status })
}
