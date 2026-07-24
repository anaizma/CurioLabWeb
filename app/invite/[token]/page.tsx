import { headers } from "next/headers";
import AcceptClient from "./accept-client";
import { inviteKindToPortal } from "@/lib/portal/director/invite-kind";

interface InviteInfo {
  usable: boolean;
  kind: "guardian" | "student" | "mentor" | "staff" | null;
  chapter: string | null;
}

async function fetchInvite(token: string): Promise<InviteInfo> {
  try {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "http";
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? (host ? `${proto}://${host}` : "");
    if (!origin) return { usable: false, kind: null, chapter: null };
    const res = await fetch(`${origin}/api/invites/${token}`, { cache: "no-store" });
    if (!res.ok) return { usable: false, kind: null, chapter: null };
    return (await res.json()) as InviteInfo;
  } catch {
    return { usable: false, kind: null, chapter: null };
  }
}

export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await fetchInvite(token);
  return (
    <div data-portal={info.kind ? inviteKindToPortal(info.kind) : "director"} className="min-h-screen bg-cream text-ink grid place-items-center px-6 py-16">
      <div className="w-full max-w-md">
        {!info.usable || !info.kind ? (
          <div className="rounded-2xl border border-ink/10 bg-white p-8 text-center">
            <h1 className="text-xl font-bold">This invite link isn&apos;t valid</h1>
            <p className="text-ink/60 text-sm mt-2">
              It may have expired or already been used. Ask your Chapter Director to send a new one.
            </p>
          </div>
        ) : (
          <AcceptClient token={token} kind={info.kind} chapter={info.chapter} />
        )}
      </div>
    </div>
  );
}
