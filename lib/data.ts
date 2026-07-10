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
    tier: "Explorer",
    name: "Alarm Clock",
    desc: "A working alarm clock students designed and built — set and stop alarms, a buzzer for sound, and a snooze function.",
    skills: "Reading button inputs and real-time logic in Arduino C++, controlling a buzzer output, and working with an LCD display to show the current time and alarm state.",
    stack: ["Arduino", "C++", "LCD Display"],
    image: "/images/projects/alarmclock.jpeg",
  },
  {
    tier: "Explorer",
    name: "Pomodoro Timer",
    desc: "A physical timer that runs a Pomodoro-style focus schedule, alternating work and break intervals for study sessions.",
    skills: "Programming timed states and countdowns in C++, driving an LCD display to show live status, and designing a simple, clear physical interface.",
    stack: ["Arduino Nano", "C++", "LCD Display"],
    image: "/images/projects/projects.jpeg",
  },
  {
    tier: "Builder",
    name: "Electronic Safe",
    desc: "A 3D-modeled safe enclosure with a working locking mechanism and passcode entry, built piece by piece from a CAD model.",
    skills: "Constructing individual mechanical parts — the locking mechanism, enclosure, and keypad housing — based on a CAD model, and writing the passcode logic in Arduino C++.",
    stack: ["Arduino", "C++", "CAD"],
    image: "/images/projects/safe.jpeg",
  },
  {
    tier: "Builder",
    name: "Robotic Car",
    desc: "A remote-controlled car students wired and programmed from scratch — drives forward and backward on command.",
    skills: "Motor control and driver circuits, receiving and interpreting remote signals, and debugging real hardware behavior in real time.",
    stack: ["Arduino Nano", "C++", "Motors"],
    image: "/images/projects/projects.jpeg",
  },
];