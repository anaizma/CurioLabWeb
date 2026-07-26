import { tierColors } from "@/lib/data";

const ladderStages = [
  {
    n: "01",
    name: "Explorer",
    desc: "Students build foundational skills, learn how technical systems work, and complete guided projects with close mentor support.",
  },
  {
    n: "02",
    name: "Builder",
    desc: "Students begin making more decisions for themselves, combining their skills to solve larger and less-defined problems.",
  },
  {
    n: "03",
    name: "Innovator",
    desc: "Students lead ambitious projects of their own, work with greater independence, and begin supporting students who are earlier in the journey.",
  },
] as const;

export default function AboutPage() {
  return (
    <div>
      {/* Who we are */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16">
        <p className="label-blue mb-3">Who we are</p>
        <h1 className="text-3xl md:text-5xl font-bold mb-8">About CurioLab</h1>
        <div className="max-w-2xl space-y-4">
          <p className="text-black">
            CurioLab is a nonprofit engineering program where students in
            grades 6–12 grow through ambitious projects, consistent
            mentorship, and increasingly greater independence.
          </p>
          <p className="text-black">
            Students begin with the fundamentals of designing, building, and
            programming. Over multiple semesters, they take on harder
            problems, develop ideas of their own, and learn how to turn
            those ideas into something real.
          </p>
          <p className="text-black">
            The program is delivered through university chapters, where
            university students serve as mentors, leaders, and builders of
            the organization alongside CurioLab&apos;s professional team.
          </p>
        </div>
      </section>

      {/* Our mission — dark, mirrors the mission hero on /support */}
      <section className="bg-indigo text-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="label text-white/60 mb-3">Our mission</p>
          <h2 className="font-editorial font-light text-2xl md:text-4xl leading-tight max-w-2xl mb-8">
            To help young people discover and develop what they are capable
            of.
          </h2>
          <div className="max-w-2xl space-y-4">
            <p className="text-white/70">
              We believe potential is not unlocked through a single class,
              project, or moment of inspiration. It develops when a young
              person receives sustained guidance, meaningful challenges, and
              the time to grow.
            </p>
            <p className="text-white/70">
              CurioLab creates that environment through long-term, near-peer
              mentorship. Students work alongside mentors who understand
              their progress, encourage them through difficulty, and
              gradually help them become more confident and independent.
            </p>
            <p className="text-white/70">
              Our mission extends to our university fellows as well. By
              mentoring students and helping operate a chapter, they develop
              as educators, engineers, leaders, and community builders.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="label-blue mb-3">How it works</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4 max-w-2xl">
          Students grow one challenge at a time.
        </h2>
        <p className="text-black max-w-2xl mb-12">
          Every student enters the CurioLab Ladder and advances through
          three stages:
        </p>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {ladderStages.map((s) => (
            <div key={s.name} className="bg-white border border-black/10 rounded-xl p-6">
              <p className={`font-mono text-xs uppercase tracking-widest mb-3 ${tierColors[s.name].text}`}>
                {s.n}
              </p>
              <h3 className={`font-bold text-lg mb-2 ${tierColors[s.name].text}`}>{s.name}</h3>
              <p className="text-sm text-muted">{s.desc}</p>
            </div>
          ))}
        </div>

        <p className="text-black max-w-2xl">
          Advancement is based on demonstrated readiness, not simply age or
          time spent in the program. Each stage builds on the last while
          giving students the support they need for their next challenge.
        </p>
      </section>

      {/* Our story */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="label-blue mb-3">Our story</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4 max-w-2xl">
          CurioLab began with a simple observation.
        </h2>
        <div className="max-w-2xl space-y-4">
          <p className="text-black">
            Many young people are curious about engineering and technology,
            but too few receive the sustained support needed to move beyond
            introductory activities.
          </p>
          <p className="text-black">
            A short workshop can create excitement. A tutorial can teach a
            new tool. But becoming someone who can independently approach a
            problem, work through uncertainty, and build a meaningful
            solution takes much longer.
          </p>
          <p className="text-black">
            CurioLab began at Case Western Reserve University to create that
            missing path. University mentors worked closely with younger
            students as they learned, experimented, made mistakes, and
            completed projects of their own.
          </p>
          <p className="text-black">
            What began as a local program is now becoming a chapter-based
            nonprofit. Case Western Reserve University serves as
            CurioLab&apos;s first chapter and the foundation for a model
            that can grow across universities and communities.
          </p>
          <p className="text-black">
            As CurioLab expands, the purpose remains the same: build lasting
            communities where young people are challenged, supported, and
            given the opportunity to grow beyond what they initially
            believed was possible.
          </p>
        </div>
      </section>

      {/* Closing statement — darker navy, bookends the mission section above */}
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-editorial font-light text-2xl md:text-4xl max-w-2xl mb-6">
            We grow people who build
          </h2>
          <div className="max-w-2xl space-y-4">
            <p className="text-white/70">
              CurioLab is not only about producing projects.
            </p>
            <p className="text-white/70">
              It is about helping students become capable of creating them,
              and helping university fellows become the mentors and leaders
              who make that growth possible.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
