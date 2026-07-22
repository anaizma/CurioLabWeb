import { projects } from "@/lib/data";

export default function ProjectsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label-blue mb-3">Projects</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">
        Overview of some past projects
      </h1>
      <p className="text-black max-w-2xl mb-16">
        A few of the many projects CurioLab students design, prototype, and get
        working as part of our Exploration and Building stage curriculum — each
        one built from the circuit up, combining hardware, code, and CAD.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {projects.map((p) => (
          <div key={p.name} className="bg-white border border-black/10 rounded-xl p-6">
            <h3 className="font-bold text-xl mb-2">{p.name}</h3>
            <p className="text-muted text-sm mb-4">{p.desc}</p>
            <div className="flex flex-wrap gap-2">
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
