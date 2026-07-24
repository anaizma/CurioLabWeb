"use client";

import { useState } from "react";
import { visibleTo } from "@/lib/portal/visibility";
import type { StudentProfile, TimelineItem, Viewer } from "@/lib/portal/types";

const VIEWERS: { key: Viewer; label: string }[] = [
  { key: "me", label: "Me" },
  { key: "chapter", label: "Chapter" },
  { key: "link", label: "With my link" },
  { key: "public", label: "Public" },
];
const LENS_NOTE: Record<Viewer, string> = {
  me: "Your own view — drafts included.",
  chapter: "What a chapter member or mentor sees. Drafts are gone.",
  link: "What a teacher or program you sent your link to sees. Newsletter posts only.",
  public: "What anyone on curiolab.org sees. Newsletter posts only.",
};
const BADGE: Record<TimelineItem["visibility"], { t: string; c: string; bg: string; bd: string }> = {
  draft: { t: "Draft", c: "var(--color-muted)", bg: "var(--color-ivory)", bd: "rgba(0,0,0,.1)" },
  community: { t: "Community", c: "var(--pt-accent-fg)", bg: "var(--pt-accent-soft)", bd: "var(--pt-accent-border)" },
  newsletter: { t: "Newsletter", c: "var(--pt-newsletter-fg)", bg: "var(--pt-newsletter-soft)", bd: "var(--pt-newsletter-border)" },
};

export default function ActivityFeed({ p }: { p: StudentProfile }) {
  const [viewer, setViewer] = useState<Viewer>("me");
  const shown = p.timeline.filter((i) => visibleTo(i.visibility, viewer));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 bg-white border border-black/[.08] rounded-lg px-3 py-2 flex-wrap">
        <span className="label text-[10.5px]">Viewing as</span>
        <div className="flex border border-black/[.10] rounded-md overflow-hidden">
          {VIEWERS.map((v) => {
            const on = viewer === v.key;
            return (
              <button key={v.key} type="button" onClick={() => setViewer(v.key)}
                className="px-2.5 py-1 text-[12px] border-r border-black/[.10] last:border-r-0 transition-colors"
                style={on ? { background: "var(--color-ink)", color: "#fff", fontWeight: 600 } : { background: "#fff", color: "var(--color-muted)" }}>
                {v.label}
              </button>
            );
          })}
        </div>
        <span className="text-[12px] text-muted flex-1 min-w-[180px]">{LENS_NOTE[viewer]}</span>
      </div>

      {shown.length === 0 ? (
        <div className="border border-dashed border-black/15 rounded-lg p-6 text-center text-muted text-[13px]">Nothing here for this viewer yet.</div>
      ) : (
        shown.map((i) => {
          const b = BADGE[i.visibility];
          return (
            <div key={i.id} className="bg-white border border-black/[.08] rounded-lg p-4" style={i.isDraft ? { borderStyle: "dashed" } : undefined}>
              <div className="flex justify-between gap-2 items-start">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md grid place-items-center text-white text-[10px] font-bold" style={{ background: "var(--pt-accent)" }}>{p.initial}</div>
                  <div>
                    <h4 className="text-[13px] font-semibold leading-none">{i.authorName}</h4>
                    <div className="font-mono text-[10.5px] text-muted mt-1">{i.dateLabel}</div>
                  </div>
                </div>
                <span className="font-mono text-[9.5px] uppercase tracking-wider" style={{ color: b.c, background: b.bg, border: `1px solid ${b.bd}`, padding: "2px 7px", borderRadius: "999px" }}>{b.t}</span>
              </div>
              <p className="text-[14px] mt-2.5 leading-relaxed">{i.body}</p>
              {i.attachedProject && (
                <div className="mt-3 border border-black/[.08] rounded-md flex items-center gap-3 px-3 py-2" style={{ background: "var(--color-ivory)" }}>
                  <span className="w-10 h-7 rounded" style={{ background: "linear-gradient(135deg,#0B3A63,#231E54)" }} />
                  <span>
                    <b className="font-mono text-[12.5px]">{i.attachedProject.title}</b>
                    <span className="block text-muted text-[11.5px]">{i.attachedProject.note}</span>
                  </span>
                </div>
              )}
              {i.nomination && (
                <div className="mt-3 rounded-md px-3 py-2.5 text-[12.5px]" style={{ background: "#FFF9EC", border: "1px solid #F5DFB0", color: "#6B4A08" }}>
                  <b className="block mb-1" style={{ color: "#5A3D06" }}>{i.nomination.by} nominated this for the newsletter</b>
                  {i.nomination.note}
                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    <button type="button" className="text-[11.5px] font-medium px-2.5 py-1 rounded" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>Accept</button>
                    <button type="button" className="text-[11.5px] font-medium px-2.5 py-1 rounded border border-black/15">No thanks</button>
                    <button type="button" className="text-[11.5px] font-medium px-2.5 py-1 rounded border border-black/15">Run it without my name</button>
                  </div>
                </div>
              )}
              <div className="flex gap-1.5 border-t border-black/[.06] mt-3 pt-2 font-mono text-[11.5px] text-muted">
                {i.isDraft ? (
                  <>
                    <button type="button" className="px-2 py-1 rounded hover:bg-black/[.04]" style={{ color: "var(--pt-accent-fg)" }}>Continue writing</button>
                    <button type="button" className="px-2 py-1 rounded hover:bg-black/[.04]" style={{ color: "#B23B2A" }}>Delete</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="px-2 py-1 rounded hover:bg-black/[.04]">&#9650; Useful · {i.usefulCount}</button>
                    <button type="button" className="px-2 py-1 rounded hover:bg-black/[.04]">Comment · {i.commentCount}</button>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
