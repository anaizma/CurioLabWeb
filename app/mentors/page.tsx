import Link from "next/link";

export default function MentorshipPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <p className="label-blue mb-3">How we mentor</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">
        How CurioLab Mentors Students
      </h1>
      <p className="text-black max-w-2xl mb-12">
        Every student works alongside a mentor throughout the program.
        Mentorship is the backbone of the CurioLab Ladder — it&apos;s how
        students stay unblocked, build real projects, and grow with each tier.
      </p>

      <div className="space-y-10 max-w-2xl">
        <section>
          <p className="label-blue mb-3">Near-peer model</p>
          <h2 className="text-2xl font-bold mb-3">
            Students learn from people who were recently in their shoes
          </h2>
          <p className="text-sm text-black">
            Innovator-tier students mentor Explorers, university-tier alumni
            mentor Innovators, and staff oversee the whole ladder. Most of the
            day-to-day coaching happens student to student — which is part of
            why it holds up across multiple semesters.
          </p>
        </section>

        <section>
          <p className="label-blue mb-3">What a semester looks like</p>
          <h2 className="text-2xl font-bold mb-3">Weekly, hands-on, project-driven</h2>
          <p className="text-sm text-black">
            Mentors meet with 1–2 students each week for check-ins, code
            review, and help scoping a project down to something shippable in a
            semester — all the way through to a finished, portfolio-ready build.
          </p>
        </section>

        <section>
          <p className="label-blue mb-3">What students get</p>
          <ul className="space-y-3 text-sm">
            <li className="border-b border-black/10 pb-3">
              A consistent mentor who knows their project and progress
            </li>
            <li className="border-b border-black/10 pb-3">
              Code review and technical unblocking every week
            </li>
            <li className="border-b border-black/10 pb-3">
              Support taking a project from an idea to something real
            </li>
          </ul>
        </section>
      </div>

      <div className="bg-ivory rounded-2xl p-8 md:p-12 mt-16">
        <p className="label text-coral mb-3">Ready to start?</p>
        <h2 className="text-2xl font-bold mb-4">Join CurioLab as a student</h2>
        <p className="text-sm max-w-2xl mb-6">
          Apply to the program and get matched with a mentor for your first
          tier of the ladder.
        </p>
        <Link
          href="/students"
          className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
        >
          Apply →
        </Link>
      </div>

      <p className="text-sm text-muted mt-8">
        Interested in mentoring instead?{" "}
        <Link
          href="/careers/volunteer-mentor"
          className="text-coral font-medium hover:underline"
        >
          See the Volunteer Mentor role →
        </Link>
      </p>
    </div>
  );
}
