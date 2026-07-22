import Link from "next/link";

const groups = [
  {
    name: "Students",
    blurb:
      "Curious students working through the ladder, from their first line of code to a real, deployed project.",
  },
  {
    name: "Mentors",
    blurb:
      "Near-peer and university mentors who guide students week to week and keep them unblocked.",
  },
  {
    name: "Alumni",
    blurb:
      "Students who finished the program and stay connected — mentoring, sharing their work, and opening doors.",
  },
];

export default function CommunityPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label-blue mb-3">Our community</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">Community</h1>
      <p className="text-black max-w-2xl mb-16">
        CurioLab is more than a curriculum — it&apos;s a community of curious
        students, near-peer mentors, and alumni spread across university
        chapters. Here&apos;s who makes it run.
      </p>

      <div className="grid md:grid-cols-3 gap-8">
        {groups.map((g) => (
          <div
            key={g.name}
            className="bg-white border border-black/10 rounded-xl p-6 flex flex-col"
          >
            <div className="w-full aspect-square bg-ivory rounded-lg mb-4 flex items-center justify-center">
              <span className="label">Photo</span>
            </div>
            <h3 className="font-bold text-lg mb-2">{g.name}</h3>
            <p className="text-sm text-muted flex-1">{g.blurb}</p>
          </div>
        ))}
      </div>

      <div className="bg-ivory rounded-2xl p-8 md:p-12 mt-16">
        <p className="label text-coral mb-3">Join us</p>
        <h2 className="text-2xl font-bold mb-4">Become part of the community</h2>
        <p className="text-sm max-w-2xl mb-6">
          Whether you want to learn, mentor, or help build CurioLab, there&apos;s
          a place for you here.
        </p>
        <Link
          href="/students"
          className="inline-block bg-coral text-white px-6 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors"
        >
          Apply →
        </Link>
      </div>
    </div>
  );
}
