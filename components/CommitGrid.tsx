export default function CommitGrid({ variant = "grid" }: { variant?: "grid" | "row" }) {
  const count = variant === "row" ? 60 : 126;
  const cells = Array.from({ length: count }, () => Math.random());
  const shade = (v: number) => {
    if (v > 0.85) return "bg-coral";
    if (v > 0.65) return "bg-coral/60";
    if (v > 0.45) return "bg-coral/30";
    return "bg-coral/10";
  };

  if (variant === "row") {
    return (
      <div className="grid grid-flow-col auto-cols-fr gap-1">
        {cells.map((v, i) => (
          <div key={i} className={`h-5 rounded-sm ${shade(v)}`} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-18 gap-1.5">
      {cells.map((v, i) => (
        <div key={i} className={`w-4 h-4 rounded-sm ${shade(v)}`} />
      ))}
    </div>
  );
}