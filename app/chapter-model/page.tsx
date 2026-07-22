import Link from "next/link";

const terms = [
  {
    k: "Term",
    v: "One semester, renewable. Most fellows stay for several semesters and move through more than one role.",
  },
  {
    k: "Commitment",
    v: "Part-time, designed to sit alongside a full course load — weekly training, a Saturday session, and preparation time.",
  },
  {
    k: "Supervision",
    v: "Every fellow reports to a named supervisor. Escalation reaches full-time CurioLab staff, not just a peer.",
  },
  {
    k: "Review",
    v: "A written review at the end of each semester covering delivered outcomes, readiness for more responsibility, and areas to develop.",
  },
  {
    k: "Advancement",
    v: "Based on demonstrated work, not time served. Roles above the volunteer baseline carry a stipend.",
  },
];

const tracks = [
  {
    kicker: "Mentorship",
    title: "Instruction",
    desc: "Fellows lead a fixed group of students for a full semester and are accountable for their progress.",
    flow: ["prepare", "teach", "assess", "record"],
    roles: ["Junior Mentor", "Senior Instructor", "Lead Instructor"],
  },
  {
    kicker: "Operations",
    title: "Administration",
    desc: "Fellows manage enrollment, family communication, partnerships, and chapter records.",
    flow: ["recruit", "enroll", "support", "report"],
    roles: ["Communications Associate", "Chapter Relations Manager", "Chapter Director"],
  },
  {
    kicker: "Development",
    title: "Technical",
    desc: "Fellows contribute to the platform the chapters run on — in a production environment, with review.",
    flow: ["specify", "build", "review", "release"],
    roles: ["Data Analyst", "Product Manager", "Product Lead"],
  },
];

const support = [
  {
    t: "Observation before responsibility",
    d: "New fellows attend their first sessions as observers before taking on a group of their own.",
  },
  {
    t: "Weekly training",
    d: "Staff-led sessions covering the week ahead, common difficulties, and instructional technique.",
  },
  {
    t: "Direct supervision",
    d: "A named supervisor for every role — present during sessions, not reviewing them afterward.",
  },
  {
    t: "Documented feedback",
    d: "The semester review that informs advancement is also the record a fellow can point to later.",
  },
];

const develop = [
  {
    t: "Mentorship",
    d: "Explaining difficult material clearly, giving feedback a younger student can act on, leading a session, and being accountable for outcomes that aren't solely your own.",
  },
  {
    t: "Operations",
    d: "Communicating on behalf of an organization, managing a pipeline against deadlines, working with external partners, and maintaining records others rely on.",
  },
  {
    t: "Development",
    d: "Contributing to a shared codebase under review, writing specifications others build from, shipping to real users, and handing work over cleanly at the end of a term.",
  },
];

const ways = [
  {
    title: "University students",
    desc: "Apply to a chapter in mentorship, operations, or development. Open to all majors.",
    cta: "Explore roles",
    href: "/careers",
  },
  {
    title: "Universities",
    desc: "Host a chapter and connect student development to sustained community engagement.",
    cta: "Partner with us",
    href: "/support",
  },
  {
    title: "Sponsors",
    desc: "Support a project track and meet the students who deliver it.",
    cta: "Sponsor a chapter",
    href: "/support",
  },
  {
    title: "Prospective founders",
    desc: "Establish a CurioLab chapter at a new university and build its first team.",
    cta: "Start a chapter",
    href: "/support#get-involved",
  },
];

export default function ChapterModelPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      {/* Hero */}
      <p className="label-blue mb-3">Chapter Model</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6 max-w-[20ch]">
        The CurioLab Fellowship
      </h1>
      <p className="text-black text-lg leading-relaxed max-w-3xl">
        University students join a chapter in mentorship, operations, or
        development, holding a defined role alongside a full course load. Fellows
        work under full-time CurioLab staff and take on more responsibility as
        they demonstrate readiness. A chapter is an operating unit of the
        organization — and fellows are the people who run it.
      </p>

      {/* Structure */}
      <section className="mt-20 pt-16 border-t border-black/10">
        <p className="label-blue mb-3">Structure</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4">
          How the appointment works
        </h2>
        <p className="text-black max-w-2xl mb-10">
          Fellowships are held for a semester and renewed. The terms are the same
          across all three tracks.
        </p>
        <dl className="border-t border-black/10">
          {terms.map((t) => (
            <div
              key={t.k}
              className="grid md:grid-cols-[200px_1fr] gap-2 md:gap-12 py-5 border-b border-black/10"
            >
              <dt className="label pt-1">{t.k}</dt>
              <dd className="text-muted max-w-2xl">{t.v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Tracks */}
      <section className="mt-20 pt-16 border-t border-black/10">
        <p className="label-blue mb-3">Tracks</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4">
          Three areas of responsibility
        </h2>
        <p className="text-black max-w-2xl mb-10">
          A chapter needs instruction, administration, and technical work. Fellows
          apply to one track and can move between them over time.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {tracks.map((tr) => (
            <div
              key={tr.title}
              className="bg-white border border-black/10 rounded-xl p-6 flex flex-col"
            >
              <p className="label text-coral mb-2">{tr.kicker}</p>
              <h3 className="font-bold text-xl mb-2">{tr.title}</h3>
              <p className="text-muted text-sm mb-5">{tr.desc}</p>
              <div className="flex flex-wrap items-center gap-1.5 mb-6">
                {tr.flow.map((s, i) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] bg-ivory border border-black/10 rounded px-2 py-1 text-muted">
                      {s}
                    </span>
                    {i < tr.flow.length - 1 && (
                      <span className="font-mono text-xs text-stone">→</span>
                    )}
                  </span>
                ))}
              </div>
              <ul className="mt-auto border-t border-black/10 pt-4 space-y-1.5">
                {tr.roles.map((r, i) => (
                  <li
                    key={r}
                    className={i === 0 ? "text-sm font-medium" : "text-sm text-muted"}
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Progression */}
      <section className="mt-20 pt-16 border-t border-black/10">
        <p className="label-blue mb-3">Progression</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4">
          Responsibility grows with demonstrated readiness
        </h2>
        <p className="text-black max-w-2xl mb-10">
          Each role includes the responsibilities of the one before it.
          Advancement follows the written semester review, not seniority.
        </p>
        <div className="rounded-2xl border border-black/10 bg-white p-5 md:p-6">
          <p className="label text-coral mb-1">Lead Instructor</p>
          <p className="text-muted text-sm mb-5">
            Owns the teaching team and cohort outcomes.
          </p>
          <div className="rounded-xl border border-black/10 bg-ivory p-5 md:p-6">
            <p className="label mb-1">Senior Instructor</p>
            <p className="text-muted text-sm mb-5">
              Trains mentors and maintains curriculum quality.
            </p>
            <div className="rounded-xl border border-black/10 bg-white p-5 md:p-6">
              <p className="label mb-1">Junior Mentor</p>
              <p className="text-ink text-sm">
                Leads one pod of students for a full semester.
              </p>
              <p className="text-muted text-sm mt-1">
                Entry role — no prior teaching experience required.
              </p>
            </div>
          </div>
        </div>
        <p className="text-muted text-sm mt-6 max-w-2xl">
          Shown for the mentorship track. Operations and development follow the
          same structure, with responsibility widening from a single function to a
          whole area of the chapter.
        </p>
      </section>

      {/* Training and supervision */}
      <section className="mt-20 pt-16 border-t border-black/10">
        <p className="label-blue mb-3">Training and supervision</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4">
          Fellows are trained, not assigned
        </h2>
        <p className="text-black max-w-2xl mb-10">
          Full-time CurioLab staff run training, set standards, and supervise
          directly. The aim is that a fellow leaves with professional experience
          they can describe precisely — not just a title.
        </p>
        <div className="grid md:grid-cols-2 gap-10 md:gap-16">
          <div>
            <h3 className="font-bold text-lg mb-4">How support is provided</h3>
            <ul>
              {support.map((s, i) => (
                <li
                  key={s.t}
                  className={`py-3 ${i === 0 ? "" : "border-t border-black/10"}`}
                >
                  <span className="block font-medium text-ink mb-0.5">{s.t}</span>
                  <span className="text-muted text-sm">{s.d}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-lg mb-4">What fellows develop</h3>
            <ul>
              {develop.map((s, i) => (
                <li
                  key={s.t}
                  className={`py-3 ${i === 0 ? "" : "border-t border-black/10"}`}
                >
                  <span className="block font-medium text-ink mb-0.5">{s.t}</span>
                  <span className="text-muted text-sm">{s.d}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Get involved */}
      <section id="involved" className="mt-20 pt-16 border-t border-black/10">
        <p className="label-blue mb-3">Get involved</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-8">Ways to take part</h2>
        <div className="grid md:grid-cols-2 gap-6">
          {ways.map((w) => (
            <div
              key={w.title}
              className="bg-white border border-black/10 rounded-xl p-6"
            >
              <h3 className="font-bold text-lg mb-2">{w.title}</h3>
              <p className="text-muted text-sm mb-4">{w.desc}</p>
              <Link
                href={w.href}
                className="text-coral font-medium hover:underline text-sm"
              >
                {w.cta} →
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
