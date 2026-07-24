export type ProjectStatus = "draft" | "submitted" | "verified" | "public_listed";
export type PostVisibility = "draft" | "community" | "newsletter";
export type Viewer = "me" | "chapter" | "link" | "public";

export interface StudentProject {
  id: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  language: string | null;
  dateLabel: string;
}

export interface TimelineItem {
  id: string;
  authorName: string;
  dateLabel: string;
  visibility: PostVisibility;
  body: string;
  usefulCount: number;
  commentCount: number;
  attachedProject: { title: string; note: string } | null;
  nomination: { by: string; note: string } | null;
  isDraft: boolean;
}

export interface StudentProfile {
  subjectAccountId: string;
  displayName: string;
  initial: string;
  tier: string | null;
  chapterName: string;
  joinedLabel: string;
  verified: boolean;
  stats: { verifiedProjects: number; sessions: number; inNewsletter: number; tier: string };
  narrative: { body: string; status: "published" | "pending_review" } | null;
  skills: string[];
  projects: StudentProject[];
  timeline: TimelineItem[];
  isSample: boolean;
}
