import Link from "next/link";

const values = [
  {
    kicker: "Substantive Responsibility, Measurable Impact",
    title: "Investments in Next-Generation Leadership",
    body: "At CurioLab, emerging leaders work directly alongside experienced professionals across core institutional functions, including instructional design, technical program management, operations, financial strategy, and strategic communications. Participants do not merely assist; they drive execution, leaving with tangible accomplishments, professional references, and a verified track record of operational impact.",
  },
  {
    kicker: "Professional Capital & Ecosystem Growth",
    title: "Cultivating Skills, Portfolios, and Lifelong Networks",
    body: "As a mission-driven organization, our primary investment is in human capital. Every role within CurioLab is structured to accelerate professional growth, equipping team members with specialized technical competencies, a portfolio of executed initiatives, and enduring connections across higher education, industry, and the social sector. Whether you are a student launching your career or a professional contributing strategic expertise, your contribution drives institutional progress.",
  },
  {
    kicker: "Inclusive Excellence & Collaborative Culture",
    title: "An Ecosystem Built on Diverse Perspectives",
    body: "CurioLab thrives on the synthesis of diverse academic disciplines, professional backgrounds, and personal experiences. We are dedicated to maintaining an inclusive, high-trust environment where contributors at every level, from first-time student coordinators to veteran advisors, are empowered to perform their best work, challenge conventional thinking, and grow together.",
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
      <h1 className="text-3xl md:text-5xl font-bold mb-6 text-balance">
        Shape the Infrastructure of Student Innovation
      </h1>
      <p className="text-black max-w-3xl text-lg mb-20">
        CurioLab is a multi-institutional, student-led nonprofit operating
        across university campuses and educational ecosystems. We pair
        ambitious undergraduate and graduate scholars with seasoned industry
        professionals to execute real-world educational initiatives,
        delivering leadership experience, executive mentorship, and
        operational agency that traditional coursework cannot replicate.
      </p>

      <p className="label-blue mb-8">Value Propositions</p>

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
