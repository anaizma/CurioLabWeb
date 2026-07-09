import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-black/10 mt-24">
      <div className="mx-auto max-w-6xl px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-10">
        <div className="col-span-2">
          <div className="flex items-center gap-2 font-bold text-lg mb-3">
            <span className="inline-block w-6 h-6 rounded bg-coral" />
            CurioLab
          </div>
          <p className="text-muted text-sm max-w-xs">
            The infrastructure layer for student-led impact.
          </p>
        </div>

        <div>
          <p className="label mb-3">Program</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/students">The Ladder</Link></li>
            <li><Link href="/projects">Student Work</Link></li>
            <li><Link href="/team">About</Link></li>
            <li><Link href="/mentors">Mentors</Link></li>
          </ul>
        </div>

        <div>
          <p className="label mb-3">Get Involved</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/students">Apply</Link></li>
            <li><Link href="/support">Partners</Link></li>
            <li><Link href="/contact">Contact</Link></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-black/10">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col md:flex-row justify-between text-xs text-muted gap-2">
          <span>© {new Date().getFullYear()} CurioLab. 501(c)(3) nonprofit.</span>
          <span>aizma@curiolab.org · Cleveland, OH</span>
        </div>
      </div>
    </footer>
  );
}