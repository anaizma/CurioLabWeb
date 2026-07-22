import Link from "next/link";
import Image from "next/image";
import CommitGrid from "@/components/CommitGrid";
import LadderScrollytelling from "@/components/LadderScrollytelling";
import { tierColors, projects } from "@/lib/data";

const evidence = [
  {
    n: "01",
    title: "Learner progression records",
    desc: "Tier advancement, project completion, and attendance for every 6th–12th grade student.",
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

const voices = [
  {
    quote: "Before this, I'd never written a line of code. Now I have a working alarm clock I built myself, and I actually understand how it works.",
    name: "Maya R., Explorer-tier student",
  },
  {
    quote: "My mentor didn't just help me fix bugs — she helped me figure out what to build in the first place. That's the part school never taught me.",
    name: "Jordan T., Builder-tier student",
  },
  {
    quote: "I went from a random idea to something people in my community actually use. Now I'm mentoring an Explorer through the same thing.",
    name: "Sam K., Innovator-tier student",
  },
];

export default function Home() {
  return (
    <div className="bg-[#FFFDFB]">
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div
          className="ink-blob pointer-events-none absolute -top-[8%] -right-[14%] z-0 w-[58%] aspect-square opacity-90 bg-[linear-gradient(135deg,var(--color-coral)_0%,var(--color-coral-dark)_45%,var(--color-indigo)_100%)]"
          style={{ borderRadius: "42% 58% 65% 35% / 45% 40% 60% 55%" }}
        />

        <div className="relative z-10 mx-auto max-w-6xl px-6 pt-20 pb-16">
          <div className="max-w-2xl">
            <p className="label mb-5 opacity-0 animate-[fade-in_0.8s_ease_50ms_forwards]">501(c)(3) nonprofit</p>
            <h1 className="font-editorial font-bold text-4xl md:text-6xl leading-[1.04] tracking-[-0.015em] max-w-[16ch] mb-6 opacity-0 animate-[fade-in_0.8s_ease_150ms_forwards]">
              <span className="inline-block">
                A place for <span className="text-coral">curiosity</span> to grow.
              </span>
              <span className="block font-normal mt-[0.55em]">
                To <span className="text-teal">learn</span> to{" "}
                <span className="text-[#5d7ed1]">build</span>, and to{" "}
                <span className="text-marigold">make</span> something
                that matters.
              </span>
            </h1>
            <p className="text-[19px] font-medium leading-relaxed text-[#3d3630] max-w-[42ch] mb-8 opacity-0 animate-[fade-in_0.8s_ease_300ms_forwards]">
              CurioLab is a <span className="font-bold">multi-semester</span> engineering program for students in grades 6–12. With <span className="font-bold">continuous university mentorship</span>, real tools and labs, and increasingly ambitious projects, students learn to design, build, and program—developing the skills and independence to turn their own ideas into reality.

            </p>
            <div className="flex flex-wrap gap-4 mb-11 opacity-0 animate-[fade-in_0.8s_ease_420ms_forwards]">
              <Link href="/students" className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
                Apply to join →
              </Link>
              <Link href="/support" className="border border-ink/20 px-6 py-3 rounded-md font-medium hover:bg-ink/5 transition-colors">
                For funders & partners
              </Link>
            </div>
          </div>

          <div className="bg-white/85 backdrop-blur-sm border border-black/10 rounded-2xl p-6 md:p-7 shadow-[0_20px_40px_-24px_rgba(3,35,68,0.25)] grid grid-cols-1 md:grid-cols-[auto_1fr] md:items-center gap-5 md:gap-8 opacity-0 animate-[fade-in_0.8s_ease_250ms_forwards]">
            <div className="whitespace-nowrap">
              <p className="label mb-1">Build log // since Explorer tier</p>
              <p className="font-mono text-coral font-semibold text-sm">127 commits</p>
            </div>
            <CommitGrid variant="row" />
            <p className="md:col-span-2 text-sm text-muted pt-4 border-t border-black/10">
              Every student commits from their first project. By the time they
              apply to college, the history is real — and anyone can see it.
            </p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="flex gap-10 flex-wrap text-sm">
          <div><span className="text-coral font-bold text-lg">6–12</span> grades served</div>
          <div><span className="text-coral font-bold text-lg">3</span> tiers, one path</div>
          <div><span className="text-coral font-bold text-lg">1</span> deployed project, minimum</div>
        </div>
      </section>

      {/* Full Ladder — dark section */}
      <section className="relative bg-[#032344]">
        <LadderScrollytelling />
      </section>

      {/* Full Projects */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-20">
        <h2 className="text-2xl md:text-5xl font-bold mb-10">What students built</h2>
        <p className="text-black max-w-3xl mb-10">
          Projects students designed, prototyped, and got working, with their mentors.
        </p>
        <div className="grid md:grid-cols-2 gap-6">
          {projects.map((p) => (
            <div key={p.name} className="bg-white border border-black/10 rounded-xl overflow-hidden">
              <div className="relative w-full aspect-video bg-ivory">
                <Image src={p.image} alt={p.name} fill className="object-cover" />
              </div>
              <div className="p-6">
              <div className="mb-4">
                <span className={`label rounded px-2 py-1 ${tierColors[p.tier].badge}`}>{p.tier}</span>
              </div>
              <h3 className="font-bold text-xl mb-2">{p.name}</h3>
              <p className="text-muted text-sm mb-4">{p.desc}</p>
              <p className="label mb-1">Skills gained</p>
              <p className="text-sm">{p.skills}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Voices — teaser, links to full /stories page */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <p className="label-blue mb-3">In their own words</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-10">Experiences from current students</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {voices.map((v) => (
            <div key={v.name} className="bg-white border border-black/10 rounded-xl p-6">
              <div className="w-full aspect-square bg-ivory rounded-lg mb-4 flex items-center justify-center text-muted text-xs text-center px-4">
                [Photo placeholder]
              </div>
              <p className="text-sm italic mb-3">"{v.quote}"</p>
              <p className="label">{v.name}</p>
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
            level — which is rare in the 6th–12th grade STEM space, and the
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
        <p className="text-black">
          Want to get involved as a funder, a school, or a family?{" "}
          <Link href="/support" className="text-coral font-medium hover:underline">
            See how to partner with CurioLab →
          </Link>
        </p>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20 text-center">
        <p className="label-blue mb-4">Fall 2026 Cohort · Applications Open</p>
        <h2 className="font-editorial font-light text-3xl md:text-5xl leading-tight max-w-2xl mx-auto mb-6">
          Ready to see what your student could build?
        </h2>
        <p className="text-black max-w-xl mx-auto mb-8">
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