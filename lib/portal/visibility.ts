import type { PostVisibility, Viewer } from "./types";

const RULES: Record<Viewer, PostVisibility[]> = {
  me: ["draft", "community", "newsletter"],
  chapter: ["community", "newsletter"],
  link: ["newsletter"],
  public: ["newsletter"],
};

/** Preview of what each audience sees — mirrors the platform visibility model. */
export function visibleTo(visibility: PostVisibility, viewer: Viewer): boolean {
  return RULES[viewer].includes(visibility);
}
