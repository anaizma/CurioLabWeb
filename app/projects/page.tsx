import { projects, tierColors } from "@/lib/data";

export default function ProjectsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label mb-3">Projects Built</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">What students actually ship</h1>
      <p className="text-muted max-w-2xl mb-16">
        Real deployed work a student can hand to anyone — an admissions
        officer, a recruiter, a grandparent. Each one is a link that opens
        something that works.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {projects.map((p) => (
          <div key={p.name} className="bg-white border border-black/10 rounded-xl p-6">
            <div className="flex justify-between mb-4">
              <span className={`label rounded px-2 py-1 ${tierColors[p.tier].badge}`}>{p.tier}</span>
              <span className="label bg-coral/10 text-coral rounded px-2 py-1">Built</span>
            </div>
            <h3 className="font-bold text-xl mb-2">{p.name}</h3>
            <p className="text-muted text-sm mb-4">{p.desc}</p>
            <p className="label mb-1">Skills gained</p>
            <p className="text-sm mb-4">{p.skills}</p>
            <div className="flex gap-2">
              {p.stack.map((s) => (
                <span key={s} className="text-xs border border-black/10 rounded px-2 py-1 text-muted">
                  {s}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}