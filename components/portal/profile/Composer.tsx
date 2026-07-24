"use client";

import { useState } from "react";
import type { StudentProfile } from "@/lib/portal/types";

export default function Composer({ p }: { p: StudentProfile }) {
  const [dest, setDest] = useState<"draft" | "community">("community");
  const note = dest === "draft"
    ? "Only you can open this. Mentors can't see drafts."
    : "Everyone signed in to CurioLab can read this. Stays off the public site.";
  return (
    <div className="bg-white border border-black/[.08] rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md grid place-items-center text-white text-[11px] font-bold" style={{ background: "var(--pt-accent)" }}>{p.initial}</div>
        <div className="label text-[10.5px]">Post an update</div>
      </div>
      <textarea className="w-full border border-black/[.12] rounded-md p-3 min-h-[90px] resize-y text-[14px] focus:outline-none focus:border-black/25" placeholder="What did you get working? What broke?" />
      <div className="flex gap-2 mt-3 flex-wrap">
        {(["draft", "community"] as const).map((d) => {
          const on = dest === d;
          return (
            <button key={d} type="button" onClick={() => setDest(d)}
              className="px-3 py-1.5 rounded-md text-[12.5px] font-medium border transition-colors"
              style={on ? { color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", borderColor: "var(--pt-accent-border)" } : { color: "var(--color-muted)", background: "#fff", borderColor: "rgba(0,0,0,.12)" }}>
              {d === "draft" ? "Save as draft" : "Post to community"}
            </button>
          );
        })}
      </div>
      <div className="text-[12.5px] text-muted mt-2">{note}</div>
      {dest === "community" && (
        <label className="flex gap-2.5 items-start mt-3 pt-3 border-t border-black/[.06]">
          <input type="checkbox" className="mt-0.5 w-4 h-4" style={{ accentColor: "var(--pt-accent)" }} />
          <span>
            <span className="text-[13px]">Also submit to the newsletter</span>
            <span className="block text-[12px] text-muted mt-0.5">A mentor reviews first. If it runs, it goes public on the CurioLab site.</span>
          </span>
        </label>
      )}
      <div className="flex items-center justify-between gap-3 mt-3.5 flex-wrap">
        <span className="text-[12.5px] text-muted">Posting as <b className="text-ink">{p.displayName}</b> · <span style={{ color: "var(--pt-accent-fg)" }}>under 18 — name &amp; school stay hidden</span></span>
        <button type="button" className="px-4 py-1.5 rounded-md text-[12.5px] font-semibold" style={{ background: "var(--pt-accent)", color: "var(--pt-on-accent)" }}>{dest === "draft" ? "Save draft" : "Post"}</button>
      </div>
    </div>
  );
}
