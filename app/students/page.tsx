import TierLadder from "@/components/TierLadder";

export default function StudentsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label mb-3">One program, one path</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">The CurioLab ladder</h1>
      <p className="text-muted max-w-2xl mb-16">
        Every student in grades 6 through 12 starts as an Explorer and
        advances on demonstrated output, not time served. Each rung has
        someone above to learn from and, eventually, someone below to teach.
      </p>

      <TierLadder />

      {/* Two tracks */}
      <div className="mt-16">
        <p className="label mb-3">How the tiers actually work</p>
        <h2 className="text-2xl font-bold mb-6">Two tracks, one program</h2>
        <p className="text-muted max-w-2xl mb-8">
          Every student starts in the education track — no exceptions,
          regardless of background. It's how advancing to the hub gets
          earned by seriousness, not by who already knew how to code coming
          in.
        </p>
        <div className="grid md:grid-cols-2 gap-8 mb-10">
          <div className="bg-white border border-black/10 rounded-xl p-6">
            <p className="label text-coral mb-2">Education track</p>
            <p className="text-sm">
              Structured curriculum teaching students to think and build like
              developers — JavaScript, p5.js, problem decomposition, product
              thinking — through the Explorer, Builder, and Innovator tiers.
              This is where every student starts.
            </p>
          </div>
          <div className="bg-white border border-black/10 rounded-xl p-6">
            <p className="label text-coral mb-2">Hub track</p>
            <p className="text-sm">
              Unlocks at Innovator tier. Connects students to university
              mentors, professors, research labs, and peer co-founders with
              complementary skills. Students bring a real problem; the hub
              gives them the network to do something about it.
            </p>
          </div>
        </div>
        <div className="bg-ivory rounded-xl p-6 md:p-8">
          <p className="label text-coral mb-3">What CurioLab is not</p>
          <p className="text-sm md:text-base font-medium">
            Not a tutoring program. Not a science fair. Not a club. Not a
            coding bootcamp. CurioLab is a sustained environment where
            students learn to build, find the people to build with, and ship
            something that matters to someone in the world.
          </p>
        </div>
      </div>

      <div className="mt-16 text-center">
        <a href="mailto:aizma@curiolab.org" className="inline-block bg-coral text-white px-8 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
          Apply to join →
        </a>
      </div>
    </div>
  );
}