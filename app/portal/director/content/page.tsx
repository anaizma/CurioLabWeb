import { getContentView } from "@/lib/portal/director/content-data";
import SampleBanner from "@/components/portal/SampleBanner";
import { requireDirector } from "@/lib/portal/director/guard";

export default async function ContentPage() {
  // Gate first: nothing below this line runs for a non-director (see guard.ts).
  await requireDirector();
  const { newsletters, reviews, isSample } = await getContentView();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Newsletter & reviews</h1>
        <p className="text-ink/60 text-sm mt-1">Draft the chapter newsletter and review student narratives and projects for publication.</p>
      </div>
      {isSample && <SampleBanner />}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink/70">Newsletters</h2>
          <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">New draft</button>
        </div>
        <div className="rounded-sm border border-ink/10 bg-white divide-y divide-ink/5">
          {newsletters.map((n) => (
            <div key={n.id} className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
              <span className="font-medium">{n.title}</span>
              <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: n.status === "published" ? "#e7f2ea" : "var(--pt-accent-soft)", color: "#44515f" }}>{n.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-ink/70">Awaiting review</h2>
        <div className="rounded-sm border border-ink/10 bg-white divide-y divide-ink/5">
          {reviews.map((r) => (
            <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{r.title}</div>
                <div className="text-xs text-ink/50">{r.type} · by {r.author}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">Review</button>
                <button type="button" disabled className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-ink/15 text-ink/40 disabled:opacity-60">Publish</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-ink/40">Connects to the newsletter, narrative-review, and project-publish endpoints in a later phase.</p>
    </div>
  );
}
