import { describe, it, expect } from "vitest";
import { pickDirectorChapter } from "@/lib/portal/director/pick-chapter";

describe("pickDirectorChapter", () => {
  it("returns the chapterId of a chapter_director membership", () => {
    expect(
      pickDirectorChapter([
        { role: "student", chapterId: "c1" },
        { role: "chapter_director", chapterId: "c2" },
      ]),
    ).toBe("c2");
  });
  it("returns null when there is no director membership", () => {
    expect(pickDirectorChapter([{ role: "student", chapterId: "c1" }])).toBeNull();
  });
  it("returns null for an empty list", () => {
    expect(pickDirectorChapter([])).toBeNull();
  });
});
