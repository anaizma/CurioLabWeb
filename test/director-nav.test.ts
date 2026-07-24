import { describe, it, expect } from "vitest";
import { activeFrom } from "@/lib/portal/director/nav";

describe("activeFrom", () => {
  it("matches the dashboard exactly", () => {
    expect(activeFrom("/portal/director")).toBe("/portal/director");
  });
  it("highlights a section for its own page", () => {
    expect(activeFrom("/portal/director/invites")).toBe("/portal/director/invites");
  });
  it("highlights the section for a nested detail route", () => {
    expect(activeFrom("/portal/director/applications/abc123")).toBe("/portal/director/applications");
  });
  it("falls back to the dashboard for an unknown path", () => {
    expect(activeFrom("/portal/director/nope")).toBe("/portal/director");
  });
});
