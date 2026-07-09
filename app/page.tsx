import Link from "next/link";
import Image from "next/image";
import CommitGrid from "@/components/CommitGrid";
import { tiers, tierColors, projects } from "@/lib/data";

const gapRows = [
  {
    schools: "Subject knowledge",
    orgs: "Competitions (Science Olympiad, DECA)",
    curio: "Developer and builder education",
  },
  {
    schools: "No problem-finding frameworks",
    orgs: "Narrow technical tracks (robotics)",
    curio: "Mentors and near-peer co-founders",
  },
  {
    schools: "No builder culture",
    orgs: "One-off events (hackathons)",
    curio: "Access to professors and university labs",
  },
  {
    schools: "No access to real mentors",
    orgs: "No support after the event",
    curio: "A structured path from idea to deployed product",
  },
];

const evidence = [
  {
    n: "01",
    title: "Learner progression records",
    desc: "Tier advancement, project completion, and attendance for every 5th–12th grade student.",
  },
  {
    n: "02",
    title: "Deployed project artifacts",
    desc: "Real work that exists at a live URL — clickable evidence, not a slide.",
  },
  {
    n: "03",
    title: "Mentor hours & outcomes",
    desc: "Documented student outcomes tied to each university mentor.",
  },
  {
    n: "04",
    title: "Cohort-over-cohort data",
    desc: "Now in our 4th cohort at Case Western Reserve University, with outcomes tracked every semester.",
  },
];

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-12 grid md:grid-cols-2 gap-12 items-start">
        <div>
          <p className="label mb-4">501(c)(3) nonprofit / The infrastructure layer for student-led impact</p>
          <h1 className="font-editorial font-light text-4xl md:text-5xl leading-tight mb-6">
            Students learn to build, find people to build with, and ship
            something real.
          </h1>
          <p className="text-muted mb-8">
            CurioLab takes students in grades 5 through 12 from curiosity to a
            deployed project — with structured curriculum, near-peer mentors,
            co-founders, and access to a university lab. Curiosity is the only
            requirement.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/students" className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
              Apply to join →
            </Link>
            <Link href="/support" className="border border-ink/20 px-6 py-3 rounded-md font-medium hover:bg-ink/5 transition-colors">
              For funders & partners
            </Link>
          </div>
        </div>

        <div className="bg-white border border-black/10 rounded-2xl p-8">
          <div className="flex justify-between items-baseline mb-6">
            <p className="label">Build log // since Explorer tier</p>
            <p className="font-mono text-coral font-semibold">127 commits</p>
          </div>
          <CommitGrid />
          <p className="text-muted text-sm mt-6">
            Every student commits from their first project. By the time they
            apply to college, the history is real — and anyone can see it.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="flex gap-10 flex-wrap text-sm">
          <div><span className="text-coral font-bold text-lg">5–12</span> grades served</div>
          <div><span className="text-coral font-bold text-lg">4</span> tiers, one path</div>
          <div><span className="text-coral font-bold text-lg">1</span> deployed project, minimum</div>
        </div>
      </section>

      {/* Gap */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <p className="label mb-3">The gap we fill</p>
        <h2 className="text-2xl md:text-4xl font-bold max-w-2xl">
          Schools teach subjects. Clubs build narrow skills. Hackathons last a day.
        </h2>
        <p className="text-muted mt-4 max-w-2xl">
          The students who figure it out anyway usually had a parent who was
          an entrepreneur, a teacher who went off-script, or got lucky.
          CurioLab removes the luck dependency.
        </p>

        <div className="grid md:grid-cols-3 gap-6 mt-10">
          <div>
            <p className="label mb-4">Schools provide</p>
            <ul className="space-y-3 text-sm border-t border-black/10 pt-4">
              {gapRows.map((r, i) => (
                <li key={i} className="border-b border-black/10 pb-3">{r.schools}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label mb-4">Existing orgs provide</p>
            <ul className="space-y-3 text-sm border-t border-black/10 pt-4">
              {gapRows.map((r, i) => (
                <li key={i} className="border-b border-black/10 pb-3">{r.orgs}</li>
              ))}
            </ul>
          </div>
          <div className="bg-coral/10 rounded-xl p-5 -mt-1">
            <p className="label text-coral mb-4">CurioLab provides</p>
            <ul className="space-y-3 text-sm border-t border-coral/20 pt-4">
              {gapRows.map((r, i) => (
                <li key={i} className="border-b border-coral/20 pb-3 font-medium">{r.curio}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Full Ladder */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <p className="label mb-3">One program, one path</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4">The CurioLab Ladder</h2>
        <p className="text-muted max-w-2xl mb-10">
          Every student starts as an Explorer and advances on demonstrated
          output. Each rung has someone above to learn from
          and, eventually, someone below to teach.
        </p>

        <div className="border border-black/10 rounded-2xl bg-white p-8 md:p-12 divide-y divide-black/10">
          <p className="font-mono text-sm text-muted pb-6">CurioLab/</p>
          {tiers.map((t) => {
            const c = tierColors[t.name];
            return (
              <div key={t.name} className={`py-8 pl-4 md:pl-8 border-l-2 ${c.border}`}>
                <div className="flex items-center gap-3 mb-1">
                  <span className={`w-2.5 h-2.5 rounded-sm ${c.dot}`} />
                  <h3 className="text-2xl font-bold">{t.name}</h3>
                  <span className={`label rounded px-2 py-0.5 ${c.badge}`}>{t.name}</span>
                </div>
                <p className="label mb-6">{t.meta}</p>
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <p className="label mb-2">Builds</p>
                    <p className="text-sm">{t.builds}</p>
                  </div>
                  <div>
                    <p className="label mb-2">Gains</p>
                    <p className="text-sm">{t.gains}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Full Projects */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <p className="label mb-3">Projects Built</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4">What students actually ship</h2>
        <p className="text-muted max-w-2xl mb-10">
          Real deployed work a student can hand to anyone — an admissions
          officer, a recruiter, a parent or peer. Each one is a link that opens
          something that works.
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          {projects.map((p) => (
            <div key={p.name} className="bg-white border border-black/10 rounded-xl overflow-hidden">
              <div className="relative w-full aspect-video bg-ivory">
                <Image src={p.image} alt={p.name} fill className="object-cover" />
              </div>
              <div className="p-6">
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
            </div>
          ))}
        </div>
      </section>

      {/* Voices — teaser, links to full /stories page */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <p className="label mb-3">In their own words</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-10">Real people, real experiences</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border border-black/10 rounded-xl p-6">
              <div className="w-full aspect-square bg-ivory rounded-lg mb-4 flex items-center justify-center text-muted text-xs text-center px-4">
                [Photo placeholder]
              </div>
              <p className="text-sm italic mb-3">"[Add quote]"</p>
              <p className="label">Name, role — e.g. Explorer-tier student</p>
            </div>
          ))}
        </div>
        <Link href="/stories" className="text-coral font-medium hover:underline block mt-8">
          Read more stories →
        </Link>
      </section>

      {/* Fundable — dark section */}
      <section className="bg-indigo text-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="label text-white/60 mb-3">What makes this fundable</p>
          <h2 className="font-editorial font-light text-2xl md:text-4xl max-w-2xl mb-6">
            A program that produces evidence, not anecdotes.
          </h2>
          <p className="text-white/70 max-w-2xl mb-8">
            Most STEM grant narratives describe activities. CurioLab's
            platform, Luminent, produces documented proof of work at every
            level — which is rare in the 5th–12th grade STEM space, and the
            reason CurioLab competes above its weight class for funding.
          </p>
          <Link href="/support" className="inline-block bg-white text-indigo px-6 py-3 rounded-md font-medium hover:bg-white/90 transition-colors mb-12">
            Partner with us →
          </Link>

          <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
            {evidence.map((e) => (
              <div key={e.n} className="border-t border-white/20 pt-4">
                <p className="font-mono text-marigold text-sm mb-2">{e.n}</p>
                <h3 className="font-bold text-lg mb-1">{e.title}</h3>
                <p className="text-white/60 text-sm">{e.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Get involved — condensed teaser, full detail lives on /support */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <p className="text-muted">
          Want to get involved as a funder, a school, or a family?{" "}
          <Link href="/support" className="text-coral font-medium hover:underline">
            See how to partner with CurioLab →
          </Link>
        </p>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20 text-center">
        <p className="label mb-4">Fall 2026 Cohort · Applications Open</p>
        <h2 className="font-editorial font-light text-3xl md:text-5xl leading-tight max-w-2xl mx-auto mb-6">
          Ready to see what your student could build?
        </h2>
        <p className="text-muted max-w-xl mx-auto mb-8">
          Applications for the Fall 2026 cohort are open now. No experience
          required — just curiosity.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/students" className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
            Start an application →
          </Link>
          <Link href="/support" className="border border-ink/20 px-6 py-3 rounded-md font-medium hover:bg-ink/5 transition-colors">
            Explore partnership options →
          </Link>
        </div>
      </section>
    </div>
  );
}