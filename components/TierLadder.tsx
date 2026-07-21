import { tiers, tierColors, heroVerbColors } from "@/lib/data";

export default function TierLadder({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`divide-y ${dark ? "divide-white/15" : "divide-black/10"}`}>
      {tiers.map((t, i) => {
        const c = tierColors[t.name];
        const number = String(i + 1).padStart(2, "0");

        const image = (
          <div
            className={`relative aspect-[4/3] rounded-2xl border-2 border-dashed ${c.border} flex items-center justify-center p-6 ${
              dark ? "bg-white/5" : c.badge
            }`}
          >
            <span className={`font-mono text-xs uppercase tracking-widest text-center opacity-70 ${dark ? "text-white/60" : "text-muted"}`}>
              [Photo placeholder — {t.name}-tier students]
            </span>
          </div>
        );

        const text = (
          <div>
            <div className="flex items-center gap-4 mb-4">
              <span className={`font-editorial font-bold text-6xl md:text-7xl leading-none opacity-20 ${dark ? "text-white" : c.text}`}>
                {number}
              </span>
              <span className={`h-px w-10 ${c.dot}`} />
              <span className={`font-mono text-xs uppercase tracking-widest ${dark ? "text-white/50" : "text-muted"}`}>{t.meta}</span>
            </div>
            <h3 className={`font-editorial text-3xl md:text-4xl font-bold mb-4 ${dark ? heroVerbColors[t.name] : ""}`}>{t.name}</h3>
            <p className={`mb-3 ${dark ? "text-white/70" : "text-muted"}`}>{t.builds}</p>
            <p className={`text-sm ${dark ? "text-white/70" : "text-muted"}`}>
              <span className={`font-mono text-xs uppercase tracking-widest mr-2 ${dark ? "text-white/50" : "text-muted"}`}>Gains</span>
              {t.gains}
            </p>
          </div>
        );

        return (
          <div key={t.name} className="py-12 first:pt-0 last:pb-0 grid md:grid-cols-2 gap-8 md:gap-12 items-center">
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
      })}
    </div>
  );
}
