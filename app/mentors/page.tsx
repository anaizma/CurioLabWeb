import Link from "next/link";

type Pillar = {
  number: string;
  heading: string;
  epigraph: string;
  philosophy: string;
  practice: string;
};

const pillars: Pillar[] = [
  {
    number: "01",
    heading: "Psychological Safety & Relational Trust",
    epigraph:
      "Cultivating an environment where vulnerability precedes intellectual growth.",
    philosophy:
      "Sustained technical and personal development requires an environment anchored in mutual respect and psychological safety. True learning occurs when students feel empowered to articulate knowledge gaps, stress-test unrefined ideas, and view technical friction not as personal failure, but as essential data.",
    practice:
      "CurioLab mentors establish rigorous standards of active listening and confidentiality. By leading with empathy, they transform high-stakes problem-solving into a collaborative, low-risk space for exploration.",
  },
  {
    number: "02",
    heading: "Structured Accountability & Goal Alignment",
    epigraph:
      "Bridging ambitious inquiry with deliberate, objective-driven execution.",
    philosophy:
      "Unstructured inspiration quickly dissipates without systematic discipline. Mentees excel when provided with clear, measurable trajectories and a deep understanding of how each milestone contributes to their broader trajectory.",
    practice:
      "Every mentorship session operates on a mentee-driven agenda. Meetings begin with a critical review of prior commitments, address current technical bottlenecks, and conclude with three actionable deliverables for the upcoming cycle. Mentees maintain ownership of the process, while mentors ensure structural accountability.",
  },
  {
    number: "03",
    heading: "Socratic Guidance & Intellectual Integrity",
    epigraph:
      "Illuminating underlying principles without usurping student agency.",
    philosophy:
      "Authentic mentorship resists the impulse to provide immediate solutions, focusing instead on cultivating critical thinking and analytical rigour. Mentors serve as truth-tellers who offer candid, constructive critique, encouraging students to evaluate their own assumptions.",
    practice:
      "Rather than executing fixes directly, mentors utilize targeted questioning to help students decompose complex systems, audit architectural decisions, and navigate technical obstacles independently. The mentor guides the process; the student owns the solution.",
  },
  {
    number: "04",
    heading: "Cascading Leadership within a Near-Peer Ecosystem",
    epigraph:
      "Institutionalizing growth through multi-tiered, reciprocal knowledge exchange.",
    philosophy:
      "Mastery is demonstrated through the ability to translate complex concepts to others. Mentorship should not operate as a rigid, top-down hierarchy, but rather as an interconnected ecosystem where learning continuously converts into leadership.",
    practice:
      "CurioLab leverages a multi-tiered infrastructure: university scholars guide high school and middle school builders, while advanced participants step up to coach incoming cohorts. This near-peer framework reinforces foundational knowledge for senior students while offering younger peers relatable models of success.",
  },
  {
    number: "05",
    heading: "Cultivating Autonomous Graduates, Not Dependents",
    epigraph: "Measuring success by the ultimate obsolescence of the mentor.",
    philosophy:
      "The definitive measure of impactful mentorship is the mentee’s transition to complete self-efficacy. Our objective is not to build ongoing reliance, but to instill the cognitive resilience and strategic agency required to navigate complex, novel challenges independently.",
    practice:
      "Over time, the mentor’s stance deliberately shifts from direct instruction to strategic advising, and ultimately to high-level consultation. We don’t merely guide students through a single project; we equip them to operate as autonomous creators for life.",
  },
];

export default function MentorshipPage() {
  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16">
        <div className="grid md:grid-cols-12 gap-8 items-end">
          <div className="md:col-span-7">
            <p className="label-blue mb-3">How We Mentor</p>
            <h1 className="text-3xl md:text-5xl font-bold leading-tight text-balance">
              True intellectual growth is a cumulative, long-term endeavor.
            </h1>
          </div>
          <div className="md:col-span-5 space-y-4">
            <p className="text-muted leading-relaxed">
              Young builders rarely benefit from passive instruction or
              pre-packaged answers. Instead, they require sustained
              partnerships: mentors who invest the time to understand their
              cognitive framework, identify their trajectory, and challenge
              them to navigate increasingly complex problems.
            </p>
            <p className="text-blue leading-relaxed font-medium">
              At CurioLab, every student collaborates with mentors who deeply
              understand their academic ambitions, technical projects,
              emerging strengths, and the specific hurdles they are learning
              to overcome.
            </p>
          </div>
        </div>

        <div className="mt-16 flex items-center gap-6">
          <div className="h-px flex-1 bg-black/10" />
          <span className="label">Five pillars of mentorship</span>
          <div className="h-px flex-1 bg-black/10" />
        </div>
      </section>

      {/* Pillars */}
      <div className="mx-auto max-w-6xl px-6">
        {pillars.map((pillar, i) => (
          <article
            key={pillar.number}
            className={`py-14 md:py-16 border-black/10 ${
              i === pillars.length - 1 ? "" : "border-b"
            }`}
          >
            <div className="grid md:grid-cols-12 gap-8 md:gap-16">
              {/* Identity column: number, name, and the governing idea. */}
              <div className="md:col-span-4">
                <div className="md:sticky md:top-28">
                  <div className="flex items-baseline gap-3 mb-3">
                    <span className="font-mono text-coral text-sm">
                      {pillar.number}
                    </span>
                    <span className="h-px flex-1 bg-coral/25" />
                  </div>
                  <h2 className="text-2xl md:text-[1.75rem] font-bold leading-snug tracking-tight text-balance">
                    {pillar.heading}
                  </h2>
                </div>
              </div>

              {/* Argument column: epigraph, then philosophy, then application. */}
              <div className="md:col-span-8">
                <blockquote className="font-editorial font-light italic text-lg md:text-xl leading-snug pl-5 border-l-2 border-coral">
                  {pillar.epigraph}
                </blockquote>

                <div className="mt-8">
                  <p className="label mb-2">The Philosophy</p>
                  <p className="text-black leading-relaxed">
                    {pillar.philosophy}
                  </p>
                </div>

                <div className="mt-6 bg-ivory rounded-xl p-6 md:p-7">
                  <p className="label mb-2">In Practice</p>
                  <p className="text-black leading-relaxed">
                    {pillar.practice}
                  </p>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* CTA */}
      <section className="mt-8 bg-ink text-white">
        <div className="mx-auto max-w-6xl px-6 py-20 grid md:grid-cols-12 gap-10 items-center">
          <div className="md:col-span-7">
            <p className="label text-white/60 mb-3">
              Find your next challenge
            </p>
            <h2 className="font-editorial font-light text-2xl md:text-4xl leading-tight">
              Join CurioLab and work alongside mentors who will help you turn
              curiosity into capability.
            </h2>
          </div>
          <div className="md:col-span-5 md:pt-2 space-y-4">
            <p className="text-white/70 leading-relaxed">
              And capability into something real.
            </p>
            <Link
              href="/students"
              className="inline-block text-white font-medium hover:underline"
            >
              Explore the program →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
