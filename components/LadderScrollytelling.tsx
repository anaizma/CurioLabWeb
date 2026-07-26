"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { tiers, heroVerbHex } from "@/lib/data";

const TIER_VH = 150;
const GRAY_TEXT = "#7c8798";
const GRAY_BORDER = "rgba(255,255,255,0.22)";

// Once a tier becomes active, its sub-lines reveal on this timed cadence
// (ms) rather than at scroll offsets — the tier name/figures flip immediately,
// then "builds", then "gains".
const BUILDS_DELAY = 350;
const GAINS_DELAY = 800;
// duration of the opacity/transform reveal transition (matches the CSS below);
// a tier's animation is "complete" once the last line has finished fading in.
const REVEAL_TRANSITION = 800;
const TIER_ANIM_DONE = GAINS_DELAY + REVEAL_TRANSITION;

export default function LadderScrollytelling() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const buildsRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const gainsRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const [unlocked, setUnlocked] = useState(false);
  const unlockSnapshot = useRef<{ scrollY: number; oldHeight: number } | null>(null);
  // tiers whose timed reveal sequence has already been kicked off (one-way latch)
  const startedRef = useRef<boolean[]>([]);
  // tiers whose reveal has fully finished — used to gate scrolling to the next
  const completeRef = useRef<boolean[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setUnlocked(true);
      return;
    }

    let ticking = false;
    let completed = false;

    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

    // Kick off a tier's timed reveal: name/figure accent immediately (via CSS
    // vars on the row, so every figure + the name pick it up), then the
    // "builds" line, then "gains". Each write is a one-way latch, so scrolling
    // away never interrupts or resets it — the sequence always completes and a
    // re-entered tier shows its text instantly (only the row opacity re-fades).
    function playTier(i: number) {
      if (startedRef.current[i]) return;
      startedRef.current[i] = true;

      const accent = heroVerbHex[tiers[i].name];
      const row = rowRefs.current[i];
      if (row) {
        row.style.setProperty("--tier-name-color", accent);
        row.style.setProperty("--tier-fig-border", `${accent}59`);
      }

      const reveal = (el: HTMLParagraphElement | null) => {
        if (!el) return;
        el.style.opacity = "1";
        el.style.transform = "none";
      };
      timersRef.current.push(setTimeout(() => reveal(buildsRefs.current[i]), BUILDS_DELAY));
      timersRef.current.push(setTimeout(() => reveal(gainsRefs.current[i]), GAINS_DELAY));
      // once the last line has finished animating, this tier is "complete" and
      // scrolling past it is unlocked. Nudge update() so the gate lifts even if
      // the user is holding against it.
      timersRef.current.push(
        setTimeout(() => {
          completeRef.current[i] = true;
          onScroll();
        }, TIER_ANIM_DONE),
      );
    }

    function update() {
      ticking = false;
      if (completed) return;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      const vh = window.innerHeight;
      const rect = wrapper.getBoundingClientRect();
      const scrollable = wrapper.offsetHeight - vh;
      let overall = clamp(-rect.top / scrollable, 0, 1);

      // clear-out transition: the outgoing tier fades to nothing, then there's
      // a brief dark gap with no tier content at all, then the next tier
      // surfaces — rather than the two overlapping in a crossfade.
      const fadeDur = 0.04;
      const gapDur = 0.05;
      const rampIn = (x: number, from: number, dur: number) => clamp((x - from) / dur, 0, 1);
      const rampOut = (x: number, until: number, dur: number) => clamp((until - x) / dur, 0, 1);

      // Scroll gate: the user can't advance to the next tier until the current
      // tier's reveal has fully played. Find the first not-yet-complete tier and
      // cap reachable progress at the end of its dwell — just before its fade-out
      // (so it stays fully visible) and, for the last tier, just before unlock.
      let completedCount = 0;
      while (completedCount < tiers.length && completeRef.current[completedCount]) completedCount++;
      const maxOverall =
        completedCount >= tiers.length ? 1 : (completedCount + 1) / tiers.length - fadeDur;
      if (overall > maxOverall) {
        const wrapperTopDoc = rect.top + window.scrollY;
        window.scrollTo({ top: wrapperTopDoc + maxOverall * scrollable, left: 0, behavior: "instant" });
        overall = maxOverall;
      }

      if (overall >= 1) {
        completed = true;
        unlockSnapshot.current = { scrollY: window.scrollY, oldHeight: wrapper.offsetHeight };
        setUnlocked(true);
        return;
      }

      // the section is pinned to the top once its top edge reaches the viewport
      // top; that's the "locked in" state that gates the later tiers.
      const lockedIn = rect.top <= 0;
      // tier 0 fires as soon as the dark segment is prominently in view — once
      // its top has scrolled into the upper part of the viewport — so its title
      // + description auto-play immediately on entry, with no extra scroll (and
      // it still fires even if the scroll momentum stops just shy of the pin).
      const entered = rect.top <= vh * 0.4;

      tiers.forEach((_, i) => {
        const start = i / tiers.length;
        const end = (i + 1) / tiers.length;
        const isFirst = i === 0;
        const isLast = i === tiers.length - 1;

        // Scroll still drives which tier is featured and the fade/gap between
        // tiers — one tier visible at a time, as before.
        let opacity = 1;
        if (!isFirst) opacity = Math.min(opacity, rampIn(overall, start + gapDur, fadeDur));
        if (!isLast) opacity = Math.min(opacity, rampOut(overall, end, fadeDur));

        const row = rowRefs.current[i];
        if (row) row.style.opacity = String(opacity);

        // Trigger the timed reveal: tier 0 on entry; each later tier once the
        // section is pinned and scroll enters its slice (just past the gap, so
        // its row has begun fading in). The sub-lines then auto-play on a timer.
        if (isFirst ? entered : lockedIn && overall >= start + gapDur) playTier(i);
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
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
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
      {/* pin below the sticky site nav (h-16) and shrink the pinned area by
          that height so the section header clears the nav instead of being
          hidden behind it */}
      <div className={unlocked ? "" : "sticky top-16 h-[calc(100vh-4rem)] overflow-hidden flex flex-col"}>
        <div className="shrink-0 mx-auto max-w-6xl w-full px-6 pt-12 pb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">The CurioLab Ladder</h2>
          <p className="text-white/60 text-sm md:text-base max-w-2xl">
            Every student starts as an Explorer and advances on demonstrated
            output. Each rung has someone above to learn from
            and, eventually, someone below to teach.
          </p>
        </div>

        <div className={unlocked ? "" : "relative flex-1"}>
          {tiers.map((t, i) => {
            const number = String(i + 1).padStart(2, "0");
            const accent = heroVerbHex[t.name];

            // ---- STATIC / reduced-motion view: unchanged from the original ----
            // staggered two columns, a single photo, one description block.
            if (unlocked) {
              const image = (
                <div
                  className="aspect-[4/3] rounded-2xl border-2 border-dashed bg-white/5 flex items-center justify-center p-6"
                  style={{ borderColor: `${accent}59` }}
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
                      <p className="font-editorial text-3xl md:text-4xl font-bold" style={{ color: accent }}>
                        {t.name}
                      </p>
                    </div>
                  </div>
                  <p className="text-white/90 text-lg leading-relaxed mb-3 max-w-[46ch]">{t.builds}</p>
                  <p className="text-sm text-white/70 leading-relaxed max-w-[46ch]">
                    <span className="font-mono text-xs uppercase tracking-widest text-white/50 mr-2">Gains</span>
                    {t.gains}
                  </p>
                </div>
              );

              return (
                <div
                  key={t.name}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-8 md:gap-12 items-center py-12 first:pt-0 last:pb-20 border-t border-white/10 first:border-t-0"
                >
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
                </div>
              );
            }

            // ---- ANIMATED / pinned view ----
            // split the "builds" copy into its sentences so each sits on its
            // own line — easier to scan than one wrapped block.
            const buildsLines = t.builds.split(/(?<=\.)\s+/).filter(Boolean);

            const figure = (label: string) => (
              <div
                className="rounded-2xl border-2 border-dashed bg-white/5 flex items-center justify-center p-6 h-full min-h-[160px]"
                style={{
                  borderColor: "var(--tier-fig-border)",
                  transition: "border-color 0.6s ease",
                }}
              >
                <span className="font-mono text-[11px] uppercase tracking-widest text-center opacity-70 text-white/50">
                  {label}
                </span>
              </div>
            );

            const grayVars = {
              "--tier-name-color": GRAY_TEXT,
              "--tier-fig-border": GRAY_BORDER,
            } as CSSProperties;

            return (
              <div
                key={t.name}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className="absolute inset-0 pb-12"
                style={{ opacity: i === 0 ? 1 : 0, ...grayVars }}
              >
                <div className="max-w-6xl mx-auto w-full h-full px-6 py-4">
                  {/* both columns fill the region height so the content
                      elongates to take up the space and never overflows up
                      onto the header. Title and description are pushed apart
                      to open the gap; the figures stretch to full height. */}
                  <div className="grid md:grid-cols-2 gap-10 md:gap-16 h-full items-stretch">
                    <div className="min-w-0 flex flex-col justify-center">
                      <div className="mb-10 md:mb-14">
                        <p className="font-mono text-xs md:text-sm uppercase tracking-widest text-white/50 mb-3">
                          {t.meta}
                        </p>
                        <div className="flex items-baseline gap-4 md:gap-6">
                          <span className="font-editorial font-bold text-6xl md:text-8xl leading-none text-white/15">
                            {number}
                          </span>
                          <p
                            className="font-editorial text-4xl md:text-6xl font-bold"
                            style={{ color: "var(--tier-name-color)", transition: "color 0.6s ease" }}
                          >
                            {t.name}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p
                          ref={(el) => {
                            buildsRefs.current[i] = el;
                          }}
                          className="text-white/90 text-xl md:text-2xl leading-relaxed mb-8"
                          style={{ transition: "opacity 0.8s ease, transform 0.8s ease", opacity: 0, transform: "translateY(14px)" }}
                        >
                          {buildsLines.map((line, k) => (
                            <span key={k} className="block mb-2 last:mb-0">
                              {line}
                            </span>
                          ))}
                        </p>
                        <p
                          ref={(el) => {
                            gainsRefs.current[i] = el;
                          }}
                          className="text-base md:text-lg text-white/70 leading-relaxed"
                          style={{ transition: "opacity 0.8s ease, transform 0.8s ease", opacity: 0, transform: "translateY(14px)" }}
                        >
                          <span className="font-mono text-xs uppercase tracking-widest text-white/50 mr-2">Gains</span>
                          {t.gains}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-rows-2 gap-5 h-full min-h-0">
                      {figure(`[Photo — ${t.name}-tier students]`)}
                      {figure(`[Photo — ${t.name} project]`)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
