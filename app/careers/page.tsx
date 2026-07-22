import Link from "next/link";

const values = [
  {
    kicker: "Real-world experience",
    title: "We invest in the people who build CurioLab",
    body: "Students work shoulder-to-shoulder with experienced, full-time colleagues on work that actually ships — teaching, mentoring, operations, finance, and communications. You'll leave with development resources, real mentorship, and a track record you can point to.",
  },
  {
    kicker: "What you'll gain",
    title: "Skills, a portfolio, and a network that lasts",
    body: "As a nonprofit, our rewards are experience and growth. Every role is built to help you develop tangible skills, a portfolio of real work, a professional network, and references from people who have seen you deliver — whether you're a student exploring a career or a professional giving back.",
  },
  {
    kicker: "Bring your authentic self",
    title: "A place to be yourself",
    body: "CurioLab is built by a mix of students and professionals from many backgrounds, and we are better for it. We are committed to a welcoming, inclusive culture where everyone — first-time volunteers and seasoned experts alike — can do their best work.",
  },
];

const roles = [
  {
    title: "Volunteer Mentor",
    href: "/careers/volunteer-mentor",
    desc: "Guide 1–2 students through a semester project with weekly check-ins and code review.",
  },
  {
    title: "Instructor",
    href: "/contact",
    desc: "Teach foundational programming and engineering to Explorer-tier students.",
  },
  {
    title: "Lead Instructor",
    href: "/contact",
    desc: "Own a cohort's curriculum and coordinate the instructor team.",
  },
  {
    title: "Communications",
    href: "/contact",
    desc: "Tell CurioLab's story across social, the newsletter, and press.",
  },
  {
    title: "Finance",
    href: "/contact",
    desc: "Keep the books, budgets, and grant reporting on track.",
  },
  {
    title: "Sales",
    href: "/contact",
    desc: "Build partnerships with schools, sponsors, and families.",
  },
  {
    title: "Operations",
    href: "/contact",
    desc: "Keep programs, scheduling, and logistics running smoothly.",
  },
  {
    title: "Development",
    href: "/contact",
    desc: "Build and maintain the CurioLab website and internal tools.",
  },
];

export default function CareersPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label-blue mb-3">Join the team</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">Careers</h1>
      <p className="text-black max-w-3xl text-lg mb-20">
        CurioLab is a student-led nonprofit with chapters at universities and
        educational institutions. Undergraduate and graduate students run real
        programs alongside full-time professionals — gaining hands-on career
        experience, mentorship, and skills that a classroom alone can&apos;t
        provide.
      </p>

      {/* Value sections — text alternating with an image on each row. */}
      <div className="space-y-16 mb-24">
        {values.map((v, i) => {
          const flipped = i % 2 === 1;
          return (
            <div
              key={v.kicker}
              className="grid md:grid-cols-2 gap-8 md:gap-12 items-center"
            >
              <div className={flipped ? "md:order-2" : ""}>
                <p className="label text-coral mb-3">{v.kicker}</p>
                <h2 className="text-2xl md:text-3xl font-bold mb-4">{v.title}</h2>
                <p className="text-black">{v.body}</p>
              </div>
              <div
                className={`flex items-center justify-center aspect-[4/3] rounded-2xl bg-ivory border border-black/10 ${
                  flipped ? "md:order-1" : ""
                }`}
              >
                <span className="label">Photo</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Open roles */}
      <p className="label-blue mb-3">Open roles</p>
      <h2 className="text-2xl md:text-3xl font-bold mb-8">Where you can help</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        {roles.map((r) => (
          <Link
            key={r.title}
            href={r.href}
            className="group flex flex-col bg-white border border-black/10 rounded-xl p-6 hover:border-coral/40 hover:shadow-sm transition-all"
          >
            <h3 className="font-bold text-lg mb-3">{r.title}</h3>
            <p className="text-sm text-muted flex-1">{r.desc}</p>
            <span className="mt-4 text-sm font-medium text-coral">
              Learn more →
            </span>
          </Link>
        ))}
      </div>

      <div className="bg-ivory rounded-2xl p-8 md:p-12">
        <p className="label text-coral mb-3">Don&apos;t see a fit?</p>
        <h2 className="text-2xl font-bold mb-4">Reach out anyway</h2>
        <p className="text-sm max-w-2xl mb-6">
          We&apos;re always glad to meet people who want to get involved. Tell
          us what you&apos;d like to do and we&apos;ll find a place for you.
        </p>
        <Link
          href="/contact"
          className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
        >
          Get in touch
        </Link>
      </div>
    </div>
  );
}
