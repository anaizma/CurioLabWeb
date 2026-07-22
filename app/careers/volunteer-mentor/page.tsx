"use client";

import Link from "next/link";

const responsibilities = [
  "Weekly meetings with 1–2 Builder or Innovator-tier students",
  "Code review and technical unblocking",
  "Helping students scope a project down to something shippable in a semester",
  "Supervising a student's entry into an external competition",
];

const timeline = [
  { step: "1", title: "Apply", desc: "Fill out the mentor application form." },
  { step: "2", title: "Interview", desc: "A short conversation with our team to find the right fit." },
  { step: "3", title: "Onboarding & training", desc: "Get up to speed on the curriculum and coaching approach before your first session." },
  { step: "4", title: "Matched with a pod", desc: "Start mentoring with weekly prep meetings and Saturday sessions with your students." },
];

export default function VolunteerMentorPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label-blue mb-3">
        <Link href="/careers" className="hover:text-coral transition-colors">
          Careers
        </Link>{" "}
        / Volunteer Mentor
      </p>
      <h1 className="text-3xl md:text-5xl font-bold mb-4">
        Undergrad and Grad Students, Mentoring the Next Builders
      </h1>
      <p className="label text-coral mb-6">Applications open now</p>
      <p className="text-black max-w-2xl mb-12">
        CurioLab pairs Builder and Innovator-tier students with mentors from
        our university lab — people who were recently in their shoes and can
        speak to what the next step actually looks like.
      </p>

      <div className="mb-16">
        <a
          href="https://forms.gle/q6sis4exvarcpn1r9"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-coral text-white px-8 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
        >
          Apply to be a mentor →
        </a>
      </div>

      <div className="mb-16">
        <p className="label-blue mb-6">How it works</p>
        <div className="grid md:grid-cols-4 gap-6">
          {timeline.map((t) => (
            <div key={t.step} className="bg-white border border-black/10 rounded-xl p-6">
              <p className="font-mono text-coral text-sm mb-2">{t.step}</p>
              <h3 className="font-bold mb-2">{t.title}</h3>
              <p className="text-sm text-muted">{t.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-10 mb-20">
        <div>
          <p className="label-blue mb-4">What mentors do</p>
          <ul className="space-y-3 text-sm">
            {responsibilities.map((r) => (
              <li key={r} className="border-b border-black/10 pb-3">{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="label-blue mb-4">What mentors get</p>
          <ul className="space-y-3 text-sm">
            <li className="border-b border-black/10 pb-3">A stipend for confirmed hours</li>
            <li className="border-b border-black/10 pb-3">Documented mentorship experience for grad school or industry applications</li>
            <li className="border-b border-black/10 pb-3">A pipeline into CurioLab&apos;s University-tier paid roles</li>
            <li className="border-b border-black/10 pb-3">A low-commitment way to give back to the community</li>
          </ul>
        </div>
      </div>

      {/* Register mentor status */}
      <div className="bg-white border border-black/10 rounded-2xl p-8 md:p-12 mb-16">
        <p className="label text-coral mb-3">Already a mentor?</p>
        <h2 className="text-2xl font-bold mb-4">Register your mentor status</h2>
        <p className="text-black max-w-xl mb-8">
          If you&apos;re mentoring with CurioLab this semester, confirm your
          status here so we can keep our records current.
        </p>
        <form className="space-y-6 max-w-xl" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label className="label block mb-2">Name</label>
            <input className="w-full border border-black/20 rounded-md px-4 py-3 bg-cream" type="text" required />
          </div>
          <div>
            <label className="label block mb-2">Email</label>
            <input className="w-full border border-black/20 rounded-md px-4 py-3 bg-cream" type="email" required />
          </div>
          <div>
            <label className="label block mb-2">Mentor status</label>
            <select className="w-full border border-black/20 rounded-md px-4 py-3 bg-cream">
              <option>New mentor — starting this semester</option>
              <option>Returning mentor</option>
              <option>No longer mentoring</option>
            </select>
          </div>
          <div>
            <label className="label block mb-2">Semester / cohort</label>
            <input className="w-full border border-black/20 rounded-md px-4 py-3 bg-cream" type="text" placeholder="e.g. Fall 2026" />
          </div>
          <button type="submit" className="bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
            Submit
          </button>
          <p className="text-xs text-muted">
           Backend currently being worked on, will be depolyed and live soon
          </p>
        </form>
      </div>

      <div className="bg-indigo text-white rounded-2xl p-8 md:p-12">
        <h2 className="text-2xl font-bold mb-4">Questions before applying?</h2>
        <p className="text-white/70 max-w-xl mb-6">
          Reach out and we&apos;ll walk you through what a semester with CurioLab looks
          like.
        </p>
        <a href="mailto:aizma@curiolab.org" className="inline-block bg-white text-indigo px-6 py-3 rounded-md font-medium hover:bg-white/90 transition-colors">
          Email us →
        </a>
      </div>
    </div>
  );
}
