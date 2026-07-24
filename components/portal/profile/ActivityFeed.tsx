"use client";

import { useState } from "react";
import { visibleTo } from "@/lib/portal/visibility";
import type { StudentProfile, TimelineItem, Viewer } from "@/lib/portal/types";

const VIEWERS: { key: Viewer; label: string }[] = [
  { key: "me", label: "Me" },
  { key: "chapter", label: "Chapter" },
  { key: "link", label: "Someone with my link" },
  { key: "public", label: "Public" },
];
const LENS_NOTE: Record<Viewer, string> = {
  me: "Your own view. Drafts included.",
  chapter: "What a chapter member or mentor sees. Drafts are gone.",
  link: "What a teacher or program you sent your link to sees. Newsletter posts only.",
  public: "What anyone on curiolab.org sees. Newsletter posts only.",
};
const BADGE: Record<TimelineItem["visibility"], { t: string; c: string; bg: string; bd: string }> = {
  draft: { t: "Draft", c: "var(--color-muted)", bg: "var(--color-ivory)", bd: "rgba(0,0,0,.1)" },
  community: { t: "Community", c: "var(--pt-accent-fg)", bg: "var(--pt-accent-soft)", bd: "var(--pt-accent-border)" },
  newsletter: { t: "Newsletter", c: "#1B6E3A", bg: "#E7F5EC", bd: "#BFE3CC" },
};

export default function ActivityFeed({ p }: { p: StudentProfile }) {
  const [viewer, setViewer] = useState<Viewer>("me");
  const shown = p.timeline.filter((i) => visibleTo(i.visibility, viewer));
  return (
    <div>
      <div className="label mb-2.5">Activity</div>
      <div className="flex items-center gap-3 bg-white border border-black/10 rounded-lg px-3 py-2.5 mb-3 flex-wrap">
        <span className="label">Viewing as</span>
        <div className="flex border border-black/10 rounded-md overflow-hidden">
          {VIEWERS.map((v) => {
            const on = viewer === v.key;
            return (
              <button key={v.key} type="button" onClick={() => setViewer(v.key)}
                className="px-2.5 py-1.5 text-[12.5px] border-r border-black/10 last:border-r-0"
                style={on ? { background: "var(--color-ink)", color: "#fff", fontWeight: 500 } : { background: "#fff", color: "var(--color-muted)" }}>
                {v.label}
              </button>
            );
          })}
        </div>
        <span className="text-[12.5px] text-muted flex-1 min-w-[200px]">{LENS_NOTE[viewer]}</span>
      </div>

      {shown.length === 0 ? (
        <div className="border border-dashed border-black/15 rounded-xl p-6 text-center text-muted text-[13.5px]">Nothing here for this viewer yet.</div>
      ) : (
        shown.map((i) => {
          const b = BADGE[i.visibility];
          return (
            <div key={i.id} className="bg-white border border-black/10 rounded-xl p-4 mb-2.5" style={i.isDraft ? { borderStyle: "dashed" } : undefined}>
              <div className="flex justify-between gap-2.5 items-start">
                <div>
                  <h4 className="text-sm font-semibold">{i.authorName}</h4>
                  <div className="font-mono text-[11px] text-muted">{i.dateLabel}</div>
                </div>
                <span className="label" style={{ color: b.c, background: b.bg, border: `1px solid ${b.bd}`, padding: "2px 8px", borderRadius: "999px" }}>{b.t}</span>
              </div>
              <p className="text-[14.5px] mt-2">{i.body}</p>
              {i.attachedProject && (
                <div className="mt-3 border border-black/10 rounded-lg flex items-center gap-3 px-3 py-2.5 bg-cream">
                  <span className="w-11 h-8 rounded-md" style={{ background: "linear-gradient(135deg,#0B3A63,#231E54)" }} />
                  <span><b className="text-[13.5px]">{i.attachedProject.title}</b><span className="block text-muted text-[12px]">{i.attachedProject.note}</span></span>
                </div>
              )}
              {i.nomination && (
                <div className="mt-3 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: "#FFF9EC", border: "1px solid #F5DFB0", color: "#6B4A08" }}>
                  <b className="block mb-1" style={{ color: "#5A3D06" }}>{i.nomination.by} nominated this for the newsletter</b>
                  {i.nomination.note}
                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    <button className="text-xs font-medium px-2.5 py-1 rounded-md text-[color:var(--pt-on-accent)]" style={{ background: "var(--pt-accent)" }}>Accept</button>
                    <button className="text-xs font-medium px-2.5 py-1 rounded-md border border-black/15">No thanks</button>
                    <button className="text-xs font-medium px-2.5 py-1 rounded-md border border-black/15">Run it without my name</button>
                  </div>
                </div>
              )}
              <div className="flex gap-1.5 border-t border-black/[.06] mt-3 pt-2.5 text-[12.5px] text-muted">
                {i.isDraft ? (
                  <><button className="px-2 py-1 rounded-full hover:bg-black/[.04]">Continue writing</button><button className="px-2 py-1 rounded-full hover:bg-black/[.04]">Delete</button></>
                ) : (
                  <><button className="px-2 py-1 rounded-full hover:bg-black/[.04]">▲ Useful · {i.usefulCount}</button><button className="px-2 py-1 rounded-full hover:bg-black/[.04]">Comment · {i.commentCount}</button></>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
