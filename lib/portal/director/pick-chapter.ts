export interface SessionMembership {
  chapterId?: string;
  role?: string;
  status?: string;
}

/** The chapterId of the caller's chapter_director membership, or null. */
export function pickDirectorChapter(memberships: SessionMembership[]): string | null {
  const m = memberships.find((x) => x.role === "chapter_director");
  return m?.chapterId ?? null;
}
