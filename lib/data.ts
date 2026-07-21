export const tierColors: Record<
  string,
  { dot: string; border: string; badge: string; text: string }
> = {
  Explorer: { dot: "bg-sage", border: "border-sage/30", badge: "bg-sage/15 text-sage", text: "text-sage" },
  Builder: { dot: "bg-teal", border: "border-teal/30", badge: "bg-teal/15 text-teal", text: "text-teal" },
  Innovator: { dot: "bg-lavender", border: "border-lavender/30", badge: "bg-lavender/15 text-lavender", text: "text-lavender" },
};

// Matches the hero title's "learn / build / make" accent colors, used for
// the tier name and imagery in the dark Ladder section specifically.
export const heroVerbColors: Record<string, string> = {
  Explorer: "text-[#2ec5ca]",
  Builder: "text-[#7a9efa]",
  Innovator: "text-marigold",
};

export const heroVerbHex: Record<string, string> = {
  Explorer: "#2ec5ca",
  Builder: "#7a9efa",
  Innovator: "#FBAE36",
};

export const tiers = [
  {
    name: "Explorer",
    meta: "SEMESTER 1-2",
    builds: "Learn foundational programming and engineering concepts. Focused on understanding and practice to consolidate skills.",
    gains: "Complete small checkpoint projects, and learn from personal mentor throughout the program.",
  },
  {
    name: "Builder",
    meta: "SEMESTER 3-4",
    builds: "Chooses a practical project and builds independently, with weekly mentor support.",
    gains: "Full ownership of a complete project and a portfolio-ready artifact.",
  },
  {
    name: "Innovator",
    meta: "multi-semester commitment",
    builds: "Develop a real solution to a chosen community problem — deployed, or entered in an external competition.",
    gains: "Experience the full product development cycle, from ideation to deployment, and gain real-world experience in problem-solving and innovation.",
  },
];

export const projects = [
  {
    tier: "Explorer",
    name: "Alarm Clock",
    desc: "A digital alarm clock with timer and alarm + snooze functionality.",
    skills: "Reading button inputs and real-time logic in Arduino, controlling a buzzer output, and working with an LCD display to show the current time and alarm state.",
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
    desc: "A 3D-modeled safe enclosure with a working locking mechanism and passcode entry, built piece by piece from the circuit to the CAD model.",
    skills: "Constructing individual mechanical parts — the locking mechanism, enclosure, and keypad housing — based on a CAD model, and writing the passcode logic in Arduino C++.",
    stack: ["Arduino", "C++", "CAD"],
    image: "/images/projects/safe.jpeg",
  },
  {
    tier: "Builder",
    name: "Robotic Car",
    desc: "A remote-controlled car students wired and programmed to drive forward and backward on command.",
    skills: "Motor control and driver circuits, receiving and interpreting remote signals, and debugging real hardware behavior in real time.",
    stack: ["Arduino Nano", "C++", "Motors"],
    image: "/images/projects/projects.jpeg",
  },
];