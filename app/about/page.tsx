export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <p className="label-blue mb-3">Who we are</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">About CurioLab</h1>
      <p className="text-black max-w-2xl mb-12">
        CurioLab is a student-led program that guides curious students from
        their first line of code to shipping a real project — one rung of the
        ladder at a time.
      </p>

      <div className="space-y-8 max-w-2xl">
        <section>
          <h2 className="text-2xl font-bold mb-3">Our mission</h2>
          <p className="text-sm text-black">
            Add mission statement. We help students build the confidence and
            skills to make things that matter, learning alongside near-peer
            mentors who were recently in their shoes.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-3">How it works</h2>
          <p className="text-sm text-black">
            Add overview. Students progress through the CurioLab Ladder —
            Explorer, Builder, and Innovator — each tier building on the last,
            from foundational concepts to a deployed, real-world project.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold mb-3">Our story</h2>
          <p className="text-sm text-black">
            Add the story behind CurioLab — why it started and where it&apos;s
            headed.
          </p>
        </section>
      </div>
    </div>
  );
}
