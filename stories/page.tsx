const groups = [
  {
    label: "Students",
    people: [
      { name: "Name, Explorer-tier student", quote: "[Add a real quote once you have one]" },
      { name: "Name, Builder-tier student", quote: "[Add a real quote once you have one]" },
    ],
  },
  {
    label: "Parents & guardians",
    people: [
      { name: "Name, parent of a CurioLab student", quote: "[Add a real quote once you have one]" },
    ],
  },
  {
    label: "University mentors",
    people: [
      { name: "Name, university mentor", quote: "[Add a real quote once you have one]" },
    ],
  },
  {
    label: "Partners & funders",
    people: [
      { name: "Name, organization", quote: "[Add a real quote once you have one]" },
    ],
  },
];

export default function StoriesPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-20">
      <p className="label mb-3">In their own words</p>
      <h1 className="text-3xl md:text-5xl font-bold mb-6">Stories from the CurioLab community</h1>
      <p className="text-muted max-w-2xl mb-16">
        The data tells you what happened. These are the people it happened to.
      </p>

      {groups.map((g) => (
        <div key={g.label} className="mb-16">
          <p className="label mb-6">{g.label}</p>
          <div className="grid md:grid-cols-2 gap-6">
            {g.people.map((p) => (
              <div key={p.name} className="bg-white border border-black/10 rounded-xl p-6 flex gap-6">
                <div className="w-24 h-24 shrink-0 bg-ivory rounded-lg flex items-center justify-center text-muted text-xs text-center px-2">
                  [Photo]
                </div>
                <div>
                  <p className="text-sm italic mb-3">"{p.quote}"</p>
                  <p className="label">{p.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}