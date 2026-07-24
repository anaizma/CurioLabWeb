import { describe, it, expect } from "vitest";
import { visibleTo } from "@/lib/portal/visibility";
import type { Viewer } from "@/lib/portal/types";

describe("visibleTo", () => {
  it("shows drafts only to me", () => {
    expect(visibleTo("draft", "me")).toBe(true);
    (["chapter", "link", "public"] as Viewer[]).forEach((v) =>
      expect(visibleTo("draft", v)).toBe(false),
    );
  });
  it("shows community to me and chapter only", () => {
    expect(visibleTo("community", "me")).toBe(true);
    expect(visibleTo("community", "chapter")).toBe(true);
    expect(visibleTo("community", "link")).toBe(false);
    expect(visibleTo("community", "public")).toBe(false);
  });
  it("shows newsletter to everyone", () => {
    (["me", "chapter", "link", "public"] as Viewer[]).forEach((v) =>
      expect(visibleTo("newsletter", v)).toBe(true),
    );
  });
});
