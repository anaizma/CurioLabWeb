import Link from "next/link";

type Section = {
  number: string;
  heading: string;
  body: string[];
  list?: string[];
  bodyAfter?: string[];
  pullQuote?: string;
};

const sections: Section[] = [
  {
    number: "01",
    heading: "Someone who knows their progress",
    body: [
      "Students should not have to start over with a new instructor every few weeks.",
      "Throughout the program, mentors build an ongoing understanding of each student: what they are curious about, where they struggle, how they respond to challenges, and when they are ready for greater independence.",
      "Because the relationship continues across projects and semesters, mentors can support more than the task immediately in front of them. They can recognize growth that students may not yet see in themselves.",
    ],
  },
  {
    number: "02",
    heading: "Support without taking over",
    body: [
      "A CurioLab mentor does not build the project for the student.",
      "Mentors ask questions, explain difficult ideas, review work, and help students find a path forward when they are stuck. As students develop, that support gradually changes.",
      "At first, a mentor may provide structure and demonstrate how to approach a problem. Later, the mentor steps back, allowing the student to make decisions, test ideas, recover from mistakes, and take ownership of the result.",
    ],
    pullQuote: "The goal is independence, not dependence.",
  },
  {
    number: "03",
    heading: "Built through real work",
    body: [
      "Mentorship happens while students are designing, programming, building, and improving projects that matter to them.",
    ],
    list: [
      "Turn broad ideas into achievable next steps",
      "Understand unfamiliar technical concepts",
      "Review code, designs, and project decisions",
      "Work through mistakes without losing momentum",
      "Reflect on what they learned and what comes next",
    ],
    bodyAfter: [
      "Students are not only told that they are capable. They build evidence of that capability through work they can see, explain, and continue improving.",
    ],
  },
  {
    number: "04",
    heading: "A ladder of people supporting one another",
    body: [
      "CurioLab uses a near-peer mentorship model. Students learn from people who are further along, but still close enough to remember what it felt like to begin.",
      "University mentors support younger students. Experienced students begin helping newer participants. Mentor leads and professional staff guide the entire system.",
      "As students advance, they move from receiving support to contributing it. Teaching someone else strengthens their own understanding while showing them that their knowledge has value.",
    ],
    pullQuote:
      "Mentorship becomes a culture of people growing and helping others grow, together.",
  },
  {
    number: "05",
    heading: "Growth that continues beyond one project",
    body: [
      "A finished project matters, but it is not the final outcome.",
      "Over time, students learn how to approach uncertainty, ask stronger questions, communicate their thinking, accept feedback, and persist through work that initially feels beyond them.",
      "They begin to see themselves differently: not only as students completing instructions, but as people capable of understanding difficult things and creating something of their own.",
    ],
    pullQuote: "That change requires patience, trust, and continuity.",
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
            <h1 className="text-3xl md:text-5xl font-bold leading-tight">
              Potential is not unlocked in a single semester.
            </h1>
          </div>
          <div className="md:col-span-5 space-y-4">
            <p className="text-muted leading-relaxed">
              Young people rarely need someone to hand them all the answers.
              They need someone who stays long enough to understand how they
              think, notices how they are growing, and challenges them to
              take the next step.
            </p>
            <p className="text-black leading-relaxed">
              At CurioLab, every student works alongside mentors who know
              their goals, their projects, their strengths, and the
              obstacles they are still learning to overcome.
            </p>
          </div>
        </div>

        <div className="mt-16 flex items-center gap-6">
          <div className="h-px flex-1 bg-black/10" />
          <span className="label">Five principles</span>
          <div className="h-px flex-1 bg-black/10" />
        </div>
      </section>

      {/* Principles */}
      <div className="mx-auto max-w-6xl px-6">
        {sections.map((section, i) => (
          <article
            key={section.number}
            className={`py-14 md:py-16 border-black/10 ${
              i === sections.length - 1 ? "" : "border-b"
            }`}
          >
            <div className="grid md:grid-cols-12 gap-8 md:gap-16">
              <div className="md:col-span-4">
                <p className="font-mono text-coral text-sm mb-2">
                  {section.number}
                </p>
                <h2 className="text-2xl md:text-3xl font-bold leading-snug">
                  {section.heading}
                </h2>
              </div>

              <div className="md:col-span-8">
                <div className="space-y-4">
                  {section.body.map((p, j) => (
                    <p key={j} className="text-black leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>

                {section.list && (
                  <ul className="mt-6 space-y-3">
                    {section.list.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-coral" />
                        <span className="text-black leading-relaxed">
                          {item}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {section.bodyAfter && (
                  <div className="mt-6 space-y-4">
                    {section.bodyAfter.map((p, j) => (
                      <p key={j} className="text-black leading-relaxed">
                        {p}
                      </p>
                    ))}
                  </div>
                )}

                {section.pullQuote && (
                  <blockquote className="font-editorial font-light italic text-lg md:text-xl leading-snug mt-8 pl-5 border-l-2 border-coral">
                    {section.pullQuote}
                  </blockquote>
                )}
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
