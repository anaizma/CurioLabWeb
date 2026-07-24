export interface GuardianChild {
  id: string;
  displayName: string;
  ageBand: string;
  chapterName: string;
}

export type GrantStatus = "granted" | "needs_form" | "pending" | "expiring" | "revoked";
export type GrantMethod = "click" | "signed_form";

export interface ConsentGrant {
  grantType: string;
  label: string;
  description: string;
  status: GrantStatus;
  method: GrantMethod;
  renewalLabel: string;
  expiresLabel: string;
  revocable: boolean;
}

export interface PublicItem {
  id: string;
  title: string;
  kind: "post" | "project";
  surfaceLabel: string;
  dateLabel: string;
}

export interface Nomination {
  id: string;
  itemTitle: string;
  surfaceLabel: string;
  publishesInLabel: string;
}

export interface GuardianView {
  child: GuardianChild;
  grants: ConsentGrant[];
  publicItems: PublicItem[];
  nominations: Nomination[];
  isSample: boolean;
}
