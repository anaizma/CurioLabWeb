// POST /api/director/invites/resend — frontend wrapper around the ops invite
// resend (POST /api/ops/invites/{id}/resend). Forwards the director's session,
// then emails the fresh link via Resend (§12). Body: { inviteId, targetEmail?, kind? }.
// Best-effort email: a send failure never voids the reissued invite.
import { sendInviteEmail, type InviteKind } from "@/lib/emails/invite-mail";

const EMAILABLE: InviteKind[] = ["guardian", "mentor", "staff", "director", "admin"];

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const inviteId = typeof body.inviteId === "string" ? body.inviteId : "";
  const targetEmail = typeof body.targetEmail === "string" ? body.targetEmail.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind : "guardian";
  if (!inviteId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";

  const res = await fetch(`${origin}/api/ops/invites/${inviteId}/resend`, {
    method: "POST",
    headers: { cookie },
    cache: "no-store",
  });
  if (!res.ok) {
    return Response.json({ error: "resend_failed" }, { status: res.status });
  }
  const data = (await res.json()) as { inviteId?: string; token?: string; expiresAt?: string };
  if (!data.token) {
    return Response.json({ error: "resend_failed" }, { status: 502 });
  }

  const inviteUrl = `${origin}/invite/${data.token}`;
  let emailed = false;
  if (targetEmail && EMAILABLE.includes(kind as InviteKind) && process.env.RESEND_API_KEY) {
    try {
      await sendInviteEmail(targetEmail, kind as InviteKind, inviteUrl);
      emailed = true;
    } catch (mailErr) {
      console.error("[api/director/invites/resend] email send failed (invite still reissued):", mailErr);
    }
  }
  return Response.json({ token: data.token, expiresAt: data.expiresAt, emailed }, { status: 201 });
}
