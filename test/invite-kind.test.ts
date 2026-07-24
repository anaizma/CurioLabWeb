import { describe, it, expect } from "vitest";
import { inviteKindToPortal } from "@/lib/portal/director/invite-kind";

describe("inviteKindToPortal", () => {
  it("maps guardian to the parent portal", () => {
    expect(inviteKindToPortal("guardian")).toBe("parent");
  });
  it("maps mentor to the mentor portal", () => {
    expect(inviteKindToPortal("mentor")).toBe("mentor");
  });
  it("maps staff to the director portal", () => {
    expect(inviteKindToPortal("staff")).toBe("director");
  });
  it("maps student to the student portal", () => {
    expect(inviteKindToPortal("student")).toBe("student");
  });
});
