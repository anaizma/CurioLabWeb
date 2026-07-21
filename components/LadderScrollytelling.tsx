"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tiers, heroVerbHex } from "@/lib/data";

const TIER_VH = 250;
const GRAY_TEXT = "#7c8798";
const GRAY_BORDER = "rgba(255,255,255,0.22)";

export default function LadderScrollytelling() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const nameRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const imgRefs = useRef<Array<HTMLDivElement | null>>([]);
  const buildsRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const gainsRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const [unlocked, setUnlocked] = useState(false);
  const unlockSnapshot = useRef<{ scrollY: number; oldHeight: number } | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setUnlocked(true);
      return;
    }

    let ticking = false;
    let completed = false;

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    function update() {
      ticking = false;
      if (completed) return;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const vh = window.innerHeight;
      const rect = wrapper.getBoundingClientRect();
      const scrollable = wrapper.offsetHeight - vh;
      const overall = clamp(-rect.top / scrollable, 0, 1);

      if (overall >= 1) {
        completed = true;
        unlockSnapshot.current = { scrollY: window.scrollY, oldHeight: wrapper.offsetHeight };
        setUnlocked(true);
        return;
      }

      // clear-out transition: the outgoing tier fades to nothing, then there's
      // a brief dark gap with no tier content at all, then the next tier
      // surfaces — rather than the two overlapping in a crossfade.
      const fadeDur = 0.04;
      const gapDur = 0.05;
      const rampIn = (x: number, from: number, dur: number) => clamp((x - from) / dur, 0, 1);
      const rampOut = (x: number, until: number, dur: number) => clamp((until - x) / dur, 0, 1);

      tiers.forEach((_, i) => {
        const start = i / tiers.length;
        const end = (i + 1) / tiers.length;
        const local = clamp((overall - start) / (end - start), 0, 1);
        const isFirst = i === 0;
        const isLast = i === tiers.length - 1;

        let opacity = 1;
        if (!isFirst) opacity = Math.min(opacity, rampIn(overall, start + gapDur, fadeDur));
        if (!isLast) opacity = Math.min(opacity, rampOut(overall, end, fadeDur));

        const row = rowRefs.current[i];
        if (row) row.style.opacity = String(opacity);

        const locked = local > 0.08;
        const showBuilds = local > 0.42;
        const showGains = local > 0.62;

        const name = nameRefs.current[i];
        const img = imgRefs.current[i];
        const builds = buildsRefs.current[i];
        const gains = gainsRefs.current[i];
        const accent = heroVerbHex[tiers[i].name];

        if (name) name.style.color = locked ? accent : GRAY_TEXT;
        if (img) img.style.borderColor = locked ? `${accent}59` : GRAY_BORDER;

        if (builds) {
          builds.style.opacity = showBuilds ? "1" : "0";
          builds.style.transform = showBuilds ? "none" : "translateY(14px)";
        }
        if (gains) {
          gains.style.opacity = showGains ? "1" : "0";
          gains.style.transform = showGains ? "none" : "translateY(14px)";
        }
      });
    }

    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // once the section collapses from its tall pinned height down to its
  // natural static height, compensate scroll position so the viewport
  // doesn't jump — without this, the sudden height drop leaves scrollY
  // pointing far past the (now much shorter) document, and the browser
  // clamps it straight to the bottom of the page.
  useLayoutEffect(() => {
    if (!unlocked) return;
    const snapshot = unlockSnapshot.current;
    const wrapper = wrapperRef.current;
    if (!snapshot || !wrapper) return;

    const newHeight = wrapper.offsetHeight;
    const delta = snapshot.oldHeight - newHeight;
    // the site sets `scroll-behavior: smooth` globally, which hijacks even
    // the legacy scrollTo(x, y) form — without an explicit instant behavior
    // this correction visibly animates (the "jump down, slide back up" glitch)
    // instead of landing invisibly before the next paint.
    window.scrollTo({ top: snapshot.scrollY - delta, left: 0, behavior: "instant" });
  }, [unlocked]);

  return (
    <div
      ref={wrapperRef}
      className="relative"
      style={{ height: unlocked ? "auto" : `${TIER_VH * tiers.length}vh` }}
    >
      <div className={unlocked ? "" : "sticky top-0 h-screen overflow-hidden flex flex-col"}>
        <div className="shrink-0 mx-auto max-w-6xl w-full px-6 pt-24 pb-20">
          <h2 className="text-2xl md:text-4xl font-bold text-white mb-4">The CurioLab Ladder</h2>
          <p className="text-white/70 max-w-2xl">
            Every student starts as an Explorer and advances on demonstrated
            output. Each rung has someone above to learn from
            and, eventually, someone below to teach.
          </p>
        </div>

        <div className={unlocked ? "" : "relative flex-1"}>
        {tiers.map((t, i) => {
          const number = String(i + 1).padStart(2, "0");
          const accent = heroVerbHex[t.name];

          const image = (
            <div
              ref={(el) => {
                imgRefs.current[i] = el;
              }}
              className="aspect-[4/3] rounded-2xl border-2 border-dashed bg-white/5 flex items-center justify-center p-6"
              style={{
                borderColor: unlocked ? `${accent}59` : GRAY_BORDER,
                transition: unlocked ? undefined : "border-color 0.6s ease",
              }}
            >
              <span className="font-mono text-xs uppercase tracking-widest text-center opacity-70 text-white/60">
                [Photo placeholder — {t.name}-tier students]
              </span>
            </div>
          );

          const text = (
            <div>
              <div className="mb-10">
                <p className="font-mono text-xs uppercase tracking-widest text-white/50 mb-2">{t.meta}</p>
                <div className="flex items-center gap-4">
                  <span className="font-editorial font-bold text-6xl md:text-7xl leading-none text-white/20">{number}</span>
                  <p
                    ref={(el) => {
                      nameRefs.current[i] = el;
                    }}
                    className="font-editorial text-3xl md:text-4xl font-bold"
                    style={{
                      color: unlocked ? accent : GRAY_TEXT,
                      transition: unlocked ? undefined : "color 0.6s ease",
                    }}
                  >
                    {t.name}
                  </p>
                </div>
              </div>
              <p
                ref={(el) => {
                  buildsRefs.current[i] = el;
                }}
                className="text-white/90 text-lg leading-relaxed mb-3 max-w-[46ch]"
                style={
                  unlocked
                    ? { opacity: 1, transform: "none" }
                    : { transition: "opacity 0.8s ease, transform 0.8s ease", opacity: 0, transform: "translateY(14px)" }
                }
              >
                {t.builds}
              </p>
              <p
                ref={(el) => {
                  gainsRefs.current[i] = el;
                }}
                className="text-sm text-white/70 leading-relaxed max-w-[46ch]"
                style={
                  unlocked
                    ? { opacity: 1, transform: "none" }
                    : { transition: "opacity 0.8s ease, transform 0.8s ease", opacity: 0, transform: "translateY(14px)" }
                }
              >
                <span className="font-mono text-xs uppercase tracking-widest text-white/50 mr-2">Gains</span>
                {t.gains}
              </p>
            </div>
          );

          const rowContent = (
            <>
              {i % 2 === 0 ? (
                <>
                  {text}
                  {image}
                </>
              ) : (
                <>
                  {image}
                  {text}
                </>
              )}
            </>
          );

          if (unlocked) {
            return (
              <div
                key={t.name}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-8 md:gap-12 items-center py-12 first:pt-0 last:pb-20 border-t border-white/10 first:border-t-0"
              >
                {rowContent}
              </div>
            );
          }

          return (
            <div
              key={t.name}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className="absolute inset-0 flex items-center"
              style={{ opacity: i === 0 ? 1 : 0 }}
            >
              <div className="max-w-6xl mx-auto px-6 w-full grid md:grid-cols-2 gap-8 md:gap-12 items-center">
                {rowContent}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
