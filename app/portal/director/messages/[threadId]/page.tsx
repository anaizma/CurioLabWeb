import Link from "next/link";
import { getThreadDetail } from "@/lib/portal/director/messages-data";
import SampleBanner from "@/components/portal/SampleBanner";
import ReplyClient from "./reply-client";

export default async function DirectorThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const { detail, isSample } = await getThreadDetail(threadId);
  if (!detail) {
    return <p className="text-sm text-ink/50">Thread not found.</p>;
  }
  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <Link href="/portal/director/messages" className="text-xs font-semibold" style={{ color: "var(--pt-accent)" }}>← All messages</Link>
      <div>
        <h1 className="text-2xl font-bold">{detail.guardianName}</h1>
        {detail.subject && <p className="text-ink/60 text-sm mt-1">{detail.subject}</p>}
      </div>
      {isSample && <SampleBanner />}
      <div className="rounded-sm border border-ink/10 bg-white p-5 flex flex-col gap-3">
        {detail.messages.map((m) => (
          <div key={m.id} className={m.who === "staff" ? "self-end max-w-[80%] flex flex-col items-end" : "self-start max-w-[80%] flex flex-col items-start"}>
            <span className="text-[11px] text-ink/50 mb-0.5 px-1">{m.name}</span>
            <div
              className={m.who === "staff" ? "px-3 py-2 rounded-2xl text-sm" : "px-3 py-2 rounded-2xl text-sm bg-cream border border-ink/10 text-ink"}
              style={m.who === "staff" ? { background: "var(--pt-accent)", color: "var(--pt-on-accent)", borderBottomRightRadius: 4 } : { borderBottomLeftRadius: 4 }}
            >
              {m.text}
            </div>
            <span className="text-[10px] text-ink/40 mt-0.5 px-1">{m.timeLabel}</span>
          </div>
        ))}
      </div>
      {isSample ? (
        <p className="text-xs text-ink/40">Replies go live once you&apos;re signed in as chapter staff.</p>
      ) : (
        <ReplyClient threadId={detail.id} />
      )}
    </div>
  );
}
