'use client';

import { useState, useEffect, useRef } from 'react';

const staff = [
  {
    name: "Emily Song",
    role: "Founder, CEO & Co-President",
    bio: "Emily sets CurioLab's long-term vision, organizational strategy, and standards for program quality. She leads partnerships, chapter expansion, and the development of a sustainable model that supports both young learners and university fellows.",
  },
  {
    name: "Ana Izma",
    role: "COO & Co-President",
    bio: "Ana oversees CurioLab's day-to-day operations and ensures that its programs, teams, and university chapters run effectively. She translates organizational goals into clear systems, coordinated execution, and a consistent experience across the organization.",
  },
  {
    name: "Vinh-Khang Luu",
    role: "Chief Financial Officer",
    bio: "Vinh-Khang leads CurioLab's financial planning, budgeting, and resource management. He works to maintain responsible financial practices and ensure that the organization's growth remains sustainable and aligned with its mission.",
  },
  {
    name: "Esmerelda Qiang",
    role: "Chief Marketing Officer",
    bio: "Esmerelda leads CurioLab's brand, communications, and community outreach. She shapes how the organization shares its mission, engages families and partners, and builds awareness among students, universities, and supporters.",
  },
  {
    name: "Tienna Zeng",
    role: "Director of Mentor & Student Relations",
    bio: "Tienna oversees the experience and development of CurioLab's students and mentors. She supports onboarding, relationship-building, and ongoing communication to create a welcoming, dependable, and growth-oriented program community.",
  },
];

export default function TeamPage() {
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpandedName(null);
      }
    }

    if (expandedName) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [expandedName]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label-blue mb-3">Who runs CurioLab</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">The Team</h1>
      <p className="text-black max-w-2xl mb-16">
        CurioLab is run by a student-led team, a rotating bench of
        near-peer student mentors, and a university lab that supervises
        Innovator and University-tier work.
      </p>

      <div
        ref={containerRef}
        className="grid md:grid-cols-3 gap-8 mb-20 auto-rows-max"
      >
        {staff.map((s) => (
          <div
            key={s.name}
            role="button"
            tabIndex={0}
            onClick={() => setExpandedName(s.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpandedName(s.name);
              }
            }}
            aria-expanded={expandedName === s.name}
            className={`
              bg-white border border-black/10 rounded-xl p-6 cursor-pointer
              transition-all duration-300 ease-out
              ${expandedName === s.name ? 'md:col-span-3' : ''}
            `}
          >
            <div className="w-12 h-12 rounded-full bg-ivory mb-4" />
            <h3 className="font-bold text-lg">{s.name}</h3>
            <p className="label mb-3">{s.role}</p>
            <p className="text-sm text-muted">{s.bio}</p>
          </div>
        ))}
      </div>

      <div className="bg-ivory rounded-2xl p-8 md:p-12">
        <p className="label text-coral mb-3">Near-peer structure</p>
        <h2 className="text-2xl font-bold mb-4">Students teach Students</h2>
        <p className="text-sm max-w-2xl">
          We belive that the best way to establish that you knwo something is by teaching it. That's why Innovator-tier students mentor Explorers, University-tier alumni
          mentor Innovators, and staff oversee the whole ladder. But most of the
          day-to-day teaching happens student to student — which is part of
          why it holds up over multiple semesters in cohorts.
        </p>
      </div>
    </div>
  );
}