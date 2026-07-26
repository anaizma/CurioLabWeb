const impact = [
  {
    n: "01",
    title: "Consistent mentorship",
    desc: "Support mentors who work closely with students each week, understand their progress, and help them take on increasingly ambitious challenges.",
  },
  {
    n: "02",
    title: "Accessible learning opportunities",
    desc: "Help provide equipment, software, materials, meals, transportation support, and program access for students regardless of their financial circumstances.",
  },
  {
    n: "03",
    title: "Projects students can call their own",
    desc: "Give students the resources and guidance to move beyond classroom exercises and build complete projects that reflect their interests, ideas, and abilities.",
  },
  {
    n: "04",
    title: "Stronger university chapters",
    desc: "Help CurioLab train university mentors, strengthen local chapter operations, and bring the program to more students and communities.",
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
        <div className="mx-auto max-w-6xl px-6 pt-20 pb-24">
          <p className="label text-white/60 mb-3">Support Our Mission</p>
          <h1 className="font-editorial font-light text-3xl md:text-5xl leading-tight max-w-2xl mb-8">
            Help young people discover what they are capable of.
          </h1>
          <div className="max-w-2xl space-y-5">
            <p className="text-white/70">
              CurioLab gives students in grades 6–12 the time, mentorship,
              and tools to grow from curious beginners into independent
              builders.
            </p>
            <p className="text-white/70">
              Through consistent, multi-semester support, students learn to
              design, program, solve difficult problems, and turn their own
              ideas into real projects. At the same time, university
              students grow as mentors, leaders, and community builders by
              helping deliver the program.
            </p>
            <p className="text-white font-medium pt-2">
              Your support helps us make this long-term growth possible.
            </p>
          </div>
        </div>
      </section>

      {/* What support makes possible — darker navy, distinct from the mission statement above */}
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-editorial font-light text-2xl md:text-4xl max-w-2xl mb-12">
            What your support makes possible
          </h2>

          <div className="grid md:grid-cols-2 gap-x-12 gap-y-8">
            {impact.map((i) => (
              <div key={i.n} className="border-t border-white/20 pt-4">
                <p className="font-mono text-marigold text-sm mb-2">{i.n}</p>
                <h3 className="font-bold text-lg mb-1">{i.title}</h3>
                <p className="text-white/60 text-sm">{i.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sponsorship tiers */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-2xl md:text-4xl font-bold mb-6 max-w-2xl">
          Support that creates lasting growth
        </h2>
        <div className="max-w-2xl space-y-4 mb-12">
          <p className="text-black">
            A contribution to CurioLab does more than fund a single workshop
            or activity. It supports relationships that continue across
            semesters, projects that become more ambitious over time, and
            young people who begin to recognize new strengths and
            possibilities within themselves.
          </p>
        </div>
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

        <div className="mt-16 pt-10 border-t border-black/10">
          <h3 className="text-xl md:text-2xl font-bold mb-3">Build the next generation with us</h3>
          <p className="text-black max-w-2xl mb-6">
            Partner with CurioLab to help more young people find the
            guidance, confidence, and opportunity to turn their curiosity
            into something real.
          </p>
          <a href="mailto:aizma@curiolab.org" className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
            Sponsor inquiry →
          </a>
        </div>
      </section>

      {/* Other ways to get involved */}
      <section id="get-involved" className="mx-auto max-w-6xl px-6 py-20 scroll-mt-24">
        <p className="label-blue mb-3">Get involved</p>
        <h2 className="text-2xl md:text-4xl font-bold mb-12">
          Other ways to back student builders
        </h2>
        <div className="space-y-10">
          <div className="border-b border-black/10 pb-10">
            <h3 className="text-xl font-bold mb-2">Start a chapter</h3>
            <p className="text-black max-w-2xl mb-4">
              We're just beginning to explore bringing CurioLab to additional
              universities beyond CWRU. If you're interested in starting a
              chapter at your school, we'd love to talk early — nothing
              formal yet, just a conversation.
            </p>
            <a href="mailto:aizma@curiolab.org" className="text-coral font-medium hover:underline">
              Get in touch about starting a chapter →
            </a>
          </div>
          <div className="border-b border-black/10 pb-10">
            <h3 className="text-xl font-bold mb-2">Refer a student</h3>
            <p className="text-black max-w-2xl mb-4">
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