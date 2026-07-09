export const tierColors: Record<
  string,
  { dot: string; border: string; badge: string; text: string }
> = {
  Explorer: { dot: "bg-sage", border: "border-sage/30", badge: "bg-sage/15 text-sage", text: "text-sage" },
  Builder: { dot: "bg-teal", border: "border-teal/30", badge: "bg-teal/15 text-teal", text: "text-teal" },
  Innovator: { dot: "bg-lavender", border: "border-lavender/30", badge: "bg-lavender/15 text-lavender", text: "text-lavender" },
  University: { dot: "bg-blue", border: "border-blue/30", badge: "bg-blue/15 text-blue", text: "text-blue" },
};

export const tiers = [
  {
    name: "Explorer",
    meta: "grades 5–12 · semester 1",
    builds: "Foundational coding and prototyping. Assigned practice projects to consolidate skills.",
    gains: "A first published project at a real URL, and belonging to a program with culture.",
  },
  {
    name: "Builder",
    meta: "semester 2+",
    builds: "Chooses a practical project and builds independently, with weekly mentor check-ins.",
    gains: "Full ownership of a complete project and a direct relationship with a university mentor.",
  },
  {
    name: "Innovator",
    meta: "multi-semester commitment",
    builds: "A real solution to a chosen community problem — deployed, or entered in an external competition.",
    gains: "A near-peer mentor role, a college-application narrative, and university lab support.",
  },
  {
    name: "University",
    meta: "undergrad & graduate roles",
    builds: "Teaches, runs operations, or builds the platform — in a real, paid, company-like role.",
    gains: "A stipend, a CurioLab credential backed by data, and genuine team experience.",
  },
];

export const projects = [
  {
    tier: "Builder",
    name: "Pantry Count",
    desc: "An inventory tracker a local food pantry uses to flag low-stock items before they run out.",
    skills: "Data persistence with localStorage, translating a vague nonprofit ask into a working spec, designing for a non-technical end user.",
    stack: ["JavaScript", "localStorage"],
    url: "curiolab.org/p/pantry-count",
  },
  {
    tier: "Explorer",
    name: "MedRemind",
    desc: "A medication reminder built so a 13-year-old's grandmother stops missing her evening doses.",
    skills: "Browser notification APIs, thinking through edge cases for someone else's daily routine, first deployed project.",
    stack: ["JavaScript", "Notifications"],
    url: "curiolab.org/p/medremind",
  },
  {
    tier: "Innovator",
    name: "BusETA",
    desc: "A school-bus arrival estimator for a neighborhood with no district tracking app.",
    skills: "Working with a third-party API, handling messy real-world data, shipping something a whole neighborhood actually uses.",
    stack: ["JavaScript", "Maps API"],
    url: "curiolab.org/p/buseta",
  },
  {
    tier: "Builder",
    name: "StudyLoop",
    desc: "A spaced-repetition flashcard tool a student made for her own AP Bio class, now used by her whole pod.",
    skills: "React state management, spaced-repetition algorithm logic, building a tool other people actually rely on.",
    stack: ["React", "IndexedDB"],
    url: "curiolab.org/p/studyloop",
  },
  {
    tier: "Innovator",
    name: "Compost Route",
    desc: "A pickup-route optimizer for a student-run compost service serving six blocks in her neighborhood.",
    skills: "Basic route-optimization logic, working within a real community organization's constraints, Python scripting.",
    stack: ["Python", "OR-Tools"],
    url: "curiolab.org/p/compost-route",
  },
  {
    tier: "Explorer",
    name: "Assembly Notes",
    desc: "A live-captioning display built for a hard-of-hearing classmate to follow school assemblies in real time.",
    skills: "Speech-to-text APIs, accessibility-first design thinking, building for one specific person's real need.",
    stack: ["JavaScript", "Web Speech API"],
    url: "curiolab.org/p/assembly-notes",
  },
];