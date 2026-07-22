const staff = [
  {
    name: "Emily Song",
    role: "Founder, CEO & Co-President",
    bio: "Add bio.",
  },
  {
    name: "Ana Izma",
    role: "COO and Co-President",
    bio: "Add bio.",
  },
  {
    name: "Vinh-Khang Luu",
    role: "CFO",
    bio: "Add bio.",
  },
  {
    name: "Esmerelda Qiang",
    role: "CMO",
    bio: "Add bio.",
  },
  {
    name: "Tienna Zeng",
    role: "Mentor & Student Relations",
    bio: "Add bio.",
  },
];

export default function TeamPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label-blue mb-3">Who runs CurioLab</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">The Team</h1>
      <p className="text-black max-w-2xl mb-16">
        CurioLab is run by a student-led team, a rotating bench of
        near-peer student mentors, and a university lab that supervises
        Innovator and University-tier work.
      </p>

      <div className="grid md:grid-cols-3 gap-8 mb-20">
        {staff.map((s) => (
          <div key={s.name} className="bg-white border border-black/10 rounded-xl p-6">
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