import type { StudentProfile } from "./types";

// This module used to export a fully fleshed-out invented student ("Maya R.",
// with projects, build logs and newsletter entries) that was served whenever the
// profile could not be read. Showing a fabricated child's work as though it were
// the signed-in student's is not an acceptable failure mode, so the fixture is
// gone and what remains is an EMPTY profile: no name, no projects, no timeline.
// The portal renders it behind SampleBanner, which says the data could not be
// loaded.
//
// The export name is unchanged so the existing call sites need no churn.
export const REPRESENTATIVE_PROFILE: StudentProfile = {
  subjectAccountId: "",
  displayName: "",
  initial: "",
  tier: null,
  chapterName: "",
  joinedLabel: "",
  verified: false,
  stats: { verifiedProjects: 0, sessions: 0, inNewsletter: 0, tier: "" },
  narrative: null,
  skills: [],
  projects: [],
  timeline: [],
  isSample: true,
};
