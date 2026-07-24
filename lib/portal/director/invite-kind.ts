export type InviteKind = "guardian" | "mentor" | "staff" | "student";
export type PortalName = "parent" | "mentor" | "director" | "student";

/** Which portal an accepted invite of each kind ultimately lands the account in. */
export function inviteKindToPortal(kind: InviteKind): PortalName {
  switch (kind) {
    case "guardian":
      return "parent";
    case "mentor":
      return "mentor";
    case "staff":
      return "director";
    case "student":
      return "student";
  }
}
