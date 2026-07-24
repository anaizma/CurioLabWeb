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

export type ActivityVisibility = "chapter" | "community" | "newsletter";

export interface ActivityItem {
  id: string;
  title: string;
  kind: "post" | "project";
  visibility: ActivityVisibility;
  visibilityLabel: string;
  dateLabel: string;
}

export interface ChatMessage {
  id: string;
  who: "me" | "them";
  name: string;
  text: string;
  timeLabel: string;
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
  activity: ActivityItem[];
  messages: ChatMessage[];
  nominations: Nomination[];
  isSample: boolean;
}
