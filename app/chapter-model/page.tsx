import Link from "next/link";

const terms = [
  {
    k: "Term",
    v: "One semester, renewable. Most fellows stay for several semesters and move through more than one role.",
  },
  {
    k: "Commitment",
    v: "Part-time, designed to sit alongside a full-time student course load",
  },
  {
    k: "Supervision",
    v: "Every fellow works closely with a direct supervising staff member. This encourages learning, cooperation, and accountability, and ensures that the chapter is run to CurioLab standards.",
  },
  {
    k: "Review",
    v: "A written review at the end of each semester covering delivered outcomes, readiness for more responsibility, and areas to develop.",
  },
  {
    k: "Advancement",
    v: "Based on demonstrated work. Roles above the volunteer baseline carry compensation.",
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

const supported = [
  {
    t: "Observation before responsibility",
    d: "New fellows begin by observing. No one is given a function to run before they have seen it run.",
  },
  {
    t: "Training",
    d: "Staff-led sessions throughout the semester covering the period ahead, recurring difficulties, and professional standards.",
  },
  {
    t: "Direct supervision",
    d: "Close cooperation and guidance from a supervising staff member — enough to run their function well and grow into operational and technical projects they take on independently.",
  },
  {
    t: "Written review each semester",
    d: "A candid read on what a fellow has grown into and what to take on next — grounded in the work they delivered, and the basis for advancement rather than time served.",
  },
];

const competencies = [
  {
    t: "Ownership of a defined function",
    d: "carrying both the authority to make decisions within it and accountability for the result.",
  },
  {
    t: "Working to organizational standards",
    d: "set by someone else, in place of individual preference or improvisation.",
  },
  {
    t: "Accountability for shared outcomes",
    d: "outcomes that depend on other people, including work delegated to those they supervise.",
  },
  {
    t: "Professional external communication",
    d: "with families, institutional partners, and funders, on behalf of the organization rather than as an individual.",
  },
  {
    t: "Operating within a reporting structure",
    d: "knowing when to escalate, documenting decisions, and maintaining records others depend on.",
  },
  {
    t: "Acting on structured feedback",
    d: "receiving a formal assessment and demonstrating change against it in a subsequent term.",
  },
  {
    t: "Continuity through transition",
    d: "handing responsibility to a successor so the function survives the person holding it.",
  },
];

const leads = [
  {
    t: "Progression into senior roles",
    d: "Advancement is determined by the semester review and reflects demonstrated capability rather than tenure. Each role carries wider responsibility than the last.",
  },
  {
    t: "A reference for what comes next",
    d: "A fellow's responsibilities, supervision, and outcomes are documented throughout. CurioLab actively supports fellows to build strong applications for graduate school, job opportunities, and long-term career development.",
  },
  {
    t: "Consideration for staff roles",
    d: "As the organization grows, senior fellows are the first candidates considered for full-time positions.",
  },
  {
    t: "Direct exposure to supporting employers",
    d: "Fellows engage with sponsoring employers while delivering the program, for genuine professional network.",
  },
];

export default function ChapterModelPage() {
  return (
    <div>
      {/* Hero — cool-toned dark banner, full-bleed. Deliberately distinct from
          the indigo/purple dark sections elsewhere on the site. */}
      <div className="relative overflow-hidden bg-[#0A1524]">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-32 h-[560px] w-[560px] rounded-full blur-3xl opacity-25 bg-[radial-gradient(circle,#1CABB0_0%,transparent_68%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full blur-3xl opacity-20 bg-[radial-gradient(circle,#3E6DD6_0%,transparent_70%)]"
        />
        <div className="relative mx-auto max-w-6xl px-6 py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8FBFF5] mb-3">
            Chapter Model
          </p>
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-6 max-w-[20ch]">
            CurioLab Chapter Fellowships
          </h1>
          <p className="text-[#CBD8EA] text-lg leading-relaxed max-w-3xl">
            University students join a chapter in mentorship, operations, or
            development, holding a defined role alongside a full course load.
            Undergraduate and Graduate fellows work directly with CurioLab staffs and take on
            responsibility as they demonstrate readiness. A chapter is an
            operating unit of the organization and fellows are the people who
            run it.
          </p>
        </div>
      </div>

      {/* Body — standard light site style. */}
      <div className="mx-auto max-w-6xl px-6 py-20">
        {/* Structure */}
        <section>
          <p className="label-blue mb-3">Structure</p>
          <h2 className="text-2xl md:text-4xl font-bold mb-4">
            How the student fellowship works
          </h2>
          <p className="text-black max-w-2xl mb-10">
            Fellowships are held for a semester and renewed. The terms are the
            same across all three tracks.
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
            A chapter needs instruction, administration, and technical work.
            Fellows apply to one track and can move between them over time.
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
                      className={
                        i === 0 ? "text-sm font-medium" : "text-sm text-muted"
                      }
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

      </div>

      {/* Development & advancement — distinct full-bleed panel, cool tint to
          set it apart from the plain white sections above and below. */}
      <div className="bg-[#EDF1F7] border-y border-black/10">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="label-blue mb-3">Growth</p>
          <h2 className="text-2xl md:text-4xl font-bold mb-4">
            Development and advancement
          </h2>
          <p className="text-black max-w-3xl mb-14">
            Full-time CurioLab staff run training, set standards, and supervise
            directly. Fellows are given a function to own rather than a list of
            tasks to complete, and the support to carry it. What a fellow
            delivers is documented as they go, so the record of their work is
            specific, verifiable, and theirs to keep.
          </p>

          {/* How fellows are supported */}
          <h3 className="font-bold text-xl mb-6">How fellows are supported</h3>
          <div className="grid md:grid-cols-2 gap-4 mb-16">
            {supported.map((s, i) => (
              <div
                key={s.t}
                className="bg-white border border-black/10 rounded-xl p-5"
              >
                <p className="font-mono text-coral text-sm mb-2">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h4 className="font-bold mb-1">{s.t}</h4>
                <p className="text-muted text-sm">{s.d}</p>
              </div>
            ))}
          </div>

          {/* Professional competencies */}
          <h3 className="font-bold text-xl mb-2">Professional competencies</h3>
          <p className="text-muted max-w-2xl mb-8">
            Across all three tracks, fellows develop the practices a professional
            environment assumes rather than teaches.
          </p>
          <div className="grid md:grid-cols-2 gap-x-10 gap-y-5 border-t border-black/10 pt-8 mb-16">
            {competencies.map((c) => (
              <div key={c.t} className="flex gap-3">
                <span className="mt-[7px] h-2 w-2 shrink-0 rounded-[2px] bg-[#5d7ed1]" />
                <p className="text-sm text-muted">
                  <span className="font-medium text-ink">{c.t}</span> — {c.d}
                </p>
              </div>
            ))}
          </div>

          {/* Where the fellowship leads */}
          <h3 className="font-bold text-xl mb-6">Where the fellowship leads</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {leads.map((l) => (
              <div
                key={l.t}
                className="bg-white border border-black/10 rounded-xl p-5"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-coral font-mono text-sm">→</span>
                  <h4 className="font-bold">{l.t}</h4>
                </div>
                <p className="text-muted text-sm">{l.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Body — continued */}
      <div className="mx-auto max-w-6xl px-6 py-20">
        {/* Get involved */}
        <section id="involved">
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
    </div>
  );
}
