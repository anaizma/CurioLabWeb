import Link from "next/link";
import { getThreadsView } from "@/lib/portal/director/messages-data";
import SampleBanner from "@/components/portal/SampleBanner";

export default async function DirectorMessagesPage() {
  const { threads, isSample } = await getThreadsView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Messages</h1>
        <p className="text-ink/60 text-sm mt-1">Guardian conversations for this chapter. Threads are kept on the record — reply in-thread.</p>
      </div>
      {isSample && <SampleBanner />}
      {threads.length === 0 ? (
        <p className="text-sm text-ink/50">No messages yet.</p>
      ) : (
        <ul className="rounded-sm border border-ink/10 bg-white divide-y divide-ink/5">
          {threads.map((t) => (
            <li key={t.id}>
              <Link href={`/portal/director/messages/${t.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-cream transition-colors">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.guardianName}{t.subject ? <span className="text-ink/40 font-normal"> · {t.subject}</span> : null}</div>
                  <div className="text-xs text-ink/50 truncate">{t.lastPreview}</div>
                </div>
                <span className="text-xs text-ink/40 shrink-0">{t.lastLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
