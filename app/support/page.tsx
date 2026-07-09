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

const tiers = [
  {
    name: "Supporter",
    benefits: [
      "Your name or logo listed as a program supporter",
      "Invitation to our annual Demo Day",
    ],
  },
  {
    name: "Partner",
    benefits: [
      "Everything in Supporter",
      "A branded project track for the semester",
      "First-look recruiting access to Technical-track students at Demo Day",
      "A quarterly outcomes summary",
    ],
  },
  {
    name: "Founding Partner",
    benefits: [
      "Everything in Partner",
      "Direct input on which community problems students tackle that semester",
      "Premier logo placement across the program",
      "A dedicated annual impact report",
    ],
  },
];

export default function SupportPage() {
  return (
    <div>
      <section className="bg-indigo text-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="label text-white/60 mb-3">What makes this fundable</p>
          <h1 className="font-editorial font-light text-3xl md:text-5xl max-w-2xl mb-6">
            A program that produces evidence, not anecdotes.
          </h1>
          <p className="text-white/70 max-w-2xl mb-12">
            Most STEM grant narratives describe activities. CurioLab's
            platform, Luminent, produces documented proof of work at every
            level — which is rare in the 5th–12th grade STEM space, and the
            reason CurioLab competes above its weight class for funding.
          </p>

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

      {/* Sponsorship tiers */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="label mb-3">Sponsor a cohort</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-4">
          Fund a project track, meet builders before anyone else recruits them
        </h2>
        <p className="text-muted max-w-2xl mb-12">
          Put your name on real, deployed student work — not a flyer.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {tiers.map((t) => (
            <div key={t.name} className="bg-white border border-black/10 rounded-xl p-6">
              <h3 className="font-bold text-lg mb-1">{t.name}</h3>
              <ul className="space-y-2 text-sm">
                {t.benefits.map((b) => (
                  <li key={b} className="border-b border-black/10 pb-2">{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <a href="mailto:hello@curiolab.org" className="text-coral font-medium hover:underline block mt-8">
          Sponsor inquiry →
        </a>
      </section>

      {/* Other ways to get involved */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="label mb-3">Get involved</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-12">
          Other ways to back student builders
        </h2>
        <div className="space-y-10">
          <div className="border-b border-black/10 pb-10">
            <h3 className="text-xl font-bold mb-2">Start a chapter</h3>
            <p className="text-muted max-w-2xl mb-4">
              We're just beginning to explore bringing CurioLab to additional
              universities beyond CWRU. If you're interested in starting a
              chapter at your school, we'd love to talk early — nothing
              formal yet, just a conversation.
            </p>
            <a href="mailto:hello@curiolab.org" className="text-coral font-medium hover:underline">
              Get in touch about starting a chapter →
            </a>
          </div>
          <div className="border-b border-black/10 pb-10">
            <h3 className="text-xl font-bold mb-2">Refer a student</h3>
            <p className="text-muted max-w-2xl mb-4">
              Teachers and counselors are our most trusted pipeline. If a
              student you know wants to build, send them our way.
            </p>
            <a href="mailto:hello@curiolab.org" className="text-coral font-medium hover:underline">
              Refer a student →
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}