"use client";

import { useState } from "react";
import type { StudentProfile } from "@/lib/portal/types";

export default function Composer({ p }: { p: StudentProfile }) {
  const [dest, setDest] = useState<"draft" | "community">("community");
  const note = dest === "draft"
    ? "Only you can open this. Mentors can't see drafts."
    : "Everyone signed in to CurioLab can read this. It stays off the public site.";
  return (
    <div className="bg-white border border-black/10 rounded-xl p-5">
      <div className="label mb-2.5">Post an update</div>
      <textarea
        className="w-full border border-black/15 rounded-lg p-3 min-h-[70px] resize-y text-[15px]"
        placeholder="What did you get working? What broke?"
      />
      <div className="flex gap-2 mt-3 flex-wrap">
        {(["draft", "community"] as const).map((d) => {
          const on = dest === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDest(d)}
              className="px-3 py-2 rounded-lg text-sm font-medium border"
              style={on
                ? { color: "var(--pt-accent-fg)", background: "var(--pt-accent-soft)", borderColor: "var(--pt-accent-border)" }
                : { color: "var(--color-muted)", background: "#fff", borderColor: "rgba(0,0,0,.12)" }}
            >
              {d === "draft" ? "Save as draft" : "Post to community"}
            </button>
          );
        })}
      </div>
      <div className="text-[13px] text-muted mt-2.5">{note}</div>
      {dest === "community" && (
        <label className="flex gap-2.5 items-start mt-3 pt-3 border-t border-black/[.06]">
          <input type="checkbox" className="mt-0.5 w-4 h-4" style={{ accentColor: "var(--pt-accent)" }} />
          <span>
            <span className="text-[13.5px]">Also submit to the newsletter</span>
            <span className="block text-[12.5px] text-muted mt-0.5">A mentor reviews it first. If it runs, it goes on the public community page and can be found by search.</span>
          </span>
        </label>
      )}
      <div className="flex items-center justify-between gap-3 mt-3.5 flex-wrap">
        <span className="text-[13px] text-muted">Posting as <b className="text-ink">{p.displayName}</b> · under 18, so last name and school stay hidden</span>
        <button className="px-3.5 py-2 rounded-md text-sm font-medium text-[color:var(--pt-on-accent)]" style={{ background: "var(--pt-accent)" }}>
          {dest === "draft" ? "Save draft" : "Post to community"}
        </button>
      </div>
    </div>
  );
}
