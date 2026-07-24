// POST /api/director/invites — frontend wrapper around the ops invite issue.
// The backend (POST /api/ops/invites) holds the capability check + token
// generation; this wrapper forwards the director's session, then emails the
// resulting link via Resend (§12) so the raw token is mailed server-side.
// Best-effort email: a send failure never voids the already-issued invite.
import { sendInviteEmail, type InviteKind } from "@/lib/emails/invite-mail";

const EMAILABLE: InviteKind[] = ["guardian", "mentor", "staff", "director", "admin"];

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  const chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
  const targetEmail = typeof body.targetEmail === "string" ? body.targetEmail.trim() : "";
  if (!kind || !chapterId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const cookie = req.headers.get("cookie") ?? "";

  const res = await fetch(`${origin}/api/ops/invites`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind, chapterId, targetEmail: targetEmail || undefined }),
    cache: "no-store",
  });
  if (!res.ok) {
    return Response.json({ error: "issue_failed" }, { status: res.status });
  }
  const data = (await res.json()) as { inviteId?: string; token?: string; expiresAt?: string };
  if (!data.token) {
    return Response.json({ error: "issue_failed" }, { status: 502 });
  }

  const inviteUrl = `${origin}/invite/${data.token}`;
  let emailed = false;
  if (targetEmail && EMAILABLE.includes(kind as InviteKind) && process.env.RESEND_API_KEY) {
    try {
      await sendInviteEmail(targetEmail, kind as InviteKind, inviteUrl);
      emailed = true;
    } catch (mailErr) {
      console.error("[api/director/invites] email send failed (invite still issued):", mailErr);
    }
  }
  return Response.json(
    { inviteId: data.inviteId, token: data.token, expiresAt: data.expiresAt, emailed },
    { status: 201 },
  );
}
