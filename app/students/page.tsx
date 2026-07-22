import TierLadder from "@/components/TierLadder";

export default function StudentsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label-blue mb-3">How students grow</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">The CurioLab ladder</h1>
      <p className="text-black max-w-2xl mb-16">
        Every student in grades 6 through 12 starts as an Explorer and
        advances on demonstrated output, not time served. 
        As they progress, they learn from more experienced mentors and eventually become a 
        qualified junior mentor to help teach newer students.
      </p>

      <TierLadder />



      <div className="mt-16 text-center">
        <a href="mailto:aizma@curiolab.org" className="inline-block bg-coral text-white px-8 py-3 rounded-md font-medium hover:bg-coral-dark transition-colors">
          Application →
        </a>
      </div>
    </div>
  );
}