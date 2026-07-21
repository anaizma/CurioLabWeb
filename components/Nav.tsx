"use client";
import Image from "next/image";


import Link from "next/link";
import { useState } from "react";

const links = [
  { href: "/projects", label: "Student Work" },
  { href: "/team", label: "Team" },
  { href: "/mentors", label: "Mentors" },
  { href: "/support", label: "Get Involved" },
  { href: "/contact", label: "Contact" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-black/10 bg-cream sticky top-0 z-50">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <Image src="/images/projects/logoo.png" alt="CurioLab logo" width={28} height={28} />

          CurioLab
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-coral transition-colors">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:block">
          <Link
            href="/students"
            className="bg-coral text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-coral-dark transition-colors"
          >
            Apply
          </Link>
        </div>

        <button
          className="md:hidden border border-black/20 rounded px-3 py-1.5 text-sm"
          onClick={() => setOpen(!open)}
        >
          menu
        </button>
      </div>

      {open && (
        <nav className="md:hidden border-t border-black/10 px-6 py-4 flex flex-col gap-4 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <Link href="/students" className="font-medium text-coral">
            Apply →
          </Link>
        </nav>
      )}
    </header>
  );
}