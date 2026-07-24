import type { StudentProfile } from "./types";

export const REPRESENTATIVE_PROFILE: StudentProfile = {
  subjectAccountId: "sample",
  displayName: "Maya R.",
  initial: "M",
  tier: "Builder",
  chapterName: "CWRU Chapter",
  joinedLabel: "Joined Oct 2025",
  verified: true,
  stats: { verifiedProjects: 4, sessions: 11, inNewsletter: 2, tier: "Builder" },
  narrative: {
    status: "pending_review",
    body: "I build things that move on screen. Started with p5.js sketches, now I'm working through physics simulation and how game engines resolve collisions. Next I want to write a 2D engine from scratch instead of using a library.",
  },
  skills: ["p5.js", "JavaScript", "Physics sim", "Canvas"],
  projects: [
    { id: "p1", title: "orbit-simulator", summary: "Two-body gravity sim with adjustable mass and velocity. Trails render on a decay buffer.", status: "verified", language: "JavaScript · p5.js", dateLabel: "Mar 4" },
    { id: "p2", title: "maze-generator", summary: "Recursive backtracker with a step-through visualizer so you can watch it carve.", status: "verified", language: "JavaScript", dateLabel: "Feb 24" },
    { id: "p3", title: "sorting-visualizer", summary: "Six sort algorithms racing side by side with comparison counters.", status: "verified", language: "JavaScript", dateLabel: "Jan 20" },
    { id: "p4", title: "reaction-game", summary: "Reaction-time tester that logs your times and plots the distribution.", status: "submitted", language: "JavaScript", dateLabel: "submitted Mar 18" },
  ],
  timeline: [
    { id: "t1", authorName: "Maya R.", dateLabel: "Edited yesterday", visibility: "draft", body: "Notes on numerical integration drift, half written. Euler accumulates error fast — test Verlet before posting.", usefulCount: 0, commentCount: 0, attachedProject: null, nomination: null, isDraft: true },
    { id: "t2", authorName: "Maya R.", dateLabel: "2 days ago", visibility: "community", body: "Collision detection finally works. The bug was checking overlap after moving the sprite instead of before, so anything fast enough tunneled straight through walls. Sweeping the position between frames fixed it.", usefulCount: 7, commentCount: 2, attachedProject: { title: "orbit-simulator", note: "Verified project · updated Mar 20" }, nomination: { by: "Dev K.", note: "Nominated this for the March newsletter. If it runs, it goes on the public community page and can be found by search. Your call." }, isDraft: false },
    { id: "t3", authorName: "Maya R.", dateLabel: "Mar 4 · March newsletter", visibility: "newsletter", body: "Orbit Simulator got verified today, which moves me to Builder. Writing up what I learned about numerical integration for the next cohort — the naive version drifts badly and nobody told me why.", usefulCount: 21, commentCount: 6, attachedProject: null, nomination: null, isDraft: false },
    { id: "t4", authorName: "Maya R.", dateLabel: "Feb 26", visibility: "community", body: "Stuck on the maze generator — my recursive backtracker blows the stack on grids bigger than 60x60. Explicit stack, or am I missing something structural?", usefulCount: 4, commentCount: 9, attachedProject: null, nomination: null, isDraft: false },
    { id: "t5", authorName: "Maya R.", dateLabel: "Jan 20 · January newsletter", visibility: "newsletter", body: "Six sorting algorithms racing side by side. Watching bubble sort lose to quicksort on 500 elements taught me more about complexity than the big-O table did.", usefulCount: 33, commentCount: 11, attachedProject: null, nomination: null, isDraft: false },
  ],
  isSample: true,
};
