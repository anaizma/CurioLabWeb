import type { GuardianView } from "./types";

export const REPRESENTATIVE_GUARDIAN_VIEW: GuardianView = {
  child: { id: "child_sample_1", displayName: "Ari", ageBand: "Under 13", chapterName: "Case Western Reserve University" },
  grants: [
    { grantType: "program_participation", label: "Program participation", description: "Ari can take part in CurioLab sessions and projects.", status: "granted", method: "click", renewalLabel: "Renews each term", expiresLabel: "Active", revocable: false },
    { grantType: "platform_account", label: "Platform account & internal posting", description: "Ari can have an account and share work inside their chapter.", status: "granted", method: "click", renewalLabel: "Renews each term", expiresLabel: "Active", revocable: true },
    { grantType: "public_publication", label: "Public publication", description: "Lets Ari's work appear in the public newsletter, community page, or profile. Because Ari is under 13, this one needs a signed form.", status: "needs_form", method: "signed_form", renewalLabel: "Renews yearly", expiresLabel: "Not yet on file", revocable: true },
    { grantType: "photo_video_likeness", label: "Photo & video likeness", description: "Ari may appear in photos or videos of their work.", status: "expiring", method: "click", renewalLabel: "Renews yearly", expiresLabel: "Expires in 3 weeks", revocable: true },
    { grantType: "emergency_medical_pickup", label: "Emergency medical & pickup", description: "Emergency contact, medical, and authorized-pickup information. Required to participate.", status: "granted", method: "click", renewalLabel: "Renews each term", expiresLabel: "Active", revocable: false },
    { grantType: "verification_link_sharing", label: "Verification-link sharing", description: "Ari can share a private link that verifies their CurioLab work to a college or program.", status: "granted", method: "click", renewalLabel: "Standing", expiresLabel: "Active", revocable: true },
  ],
  activity: [
    { id: "act_1", title: "Recycling robot — build log #3", kind: "post", visibility: "chapter", visibilityLabel: "Chapter only", dateLabel: "Jul 22" },
    { id: "act_2", title: "Weather station dashboard", kind: "project", visibility: "community", visibilityLabel: "Community page", dateLabel: "Jul 18" },
    { id: "act_3", title: "My first data visualization", kind: "post", visibility: "newsletter", visibilityLabel: "Newsletter", dateLabel: "Jul 10" },
  ],
  messages: [
    { id: "m1", who: "them", name: "Ms. Alvarez (Mentor)", text: "Hi! Ari did great building the sensor circuit today — bring a USB-C cable next Saturday if you have one.", timeLabel: "Mon 4:12 PM" },
    { id: "m2", who: "me", name: "You", text: "Thanks so much! We'll pack one. Quick question — is there a session the week of the 28th?", timeLabel: "Mon 6:40 PM" },
    { id: "m3", who: "them", name: "Dr. Okoro (Director)", text: "Yes — Saturday as usual that week. I'll post the assignment on Sunday.", timeLabel: "Mon 7:05 PM" },
  ],
  nominations: [{ id: "nom_1", itemTitle: "Recycling robot", surfaceLabel: "newsletter", publishesInLabel: "5 days" }],
  isSample: true,
};
