# Third-party written assurances (DRAFT SKELETON)

> **DRAFT.** § 312.8(c) requires taking reasonable steps to release children's personal information only to service providers and third parties capable of maintaining its confidentiality, security, and integrity, and obtaining **written assurances** to that effect before release. This is a tracking checklist. Obtain a Data Processing Agreement (DPA) or equivalent written assurance from each vendor below before any child's data flows through it in production. Cross-reference: [../compliance-coppa.md](../compliance-coppa.md) 1.7.

## What a sufficient written assurance covers

For each subprocessor, the DPA or equivalent should address: confidentiality and security obligations, the purposes for which they may process the data, a prohibition on selling or using it for their own purposes, breach notification to CurioLab, subprocessor flow-down, data location, and deletion or return on termination. [PLACEHOLDER: counsel to confirm the required terms.]

## Subprocessor register

| Vendor | Role | Children's data it touches | Assurance status | Owner |
|---|---|---|---|---|
| [PLACEHOLDER: Postgres host, e.g. Neon or Fly] | Primary database | All operational records, DOB, consents | [ ] DPA obtained — [PLACEHOLDER: date] | Coordinator |
| Cloudflare (R2) | Object storage | Signed enrollment forms, media | [ ] DPA obtained | Coordinator |
| Resend | Transactional and newsletter email | Parent and guardian email, invite content | [ ] DPA obtained | Coordinator |
| Stripe | Payments | Payment status tied to an enrollment (no card data stored by us) | [ ] DPA obtained | Coordinator |
| [PLACEHOLDER: hosting or container platform, e.g. Fly.io] | Application hosting | All, in transit and in memory | [ ] DPA obtained | Coordinator |
| [PLACEHOLDER: bot-check provider, e.g. Cloudflare Turnstile] | Abuse prevention on the public form | Parent email at submission | [ ] DPA obtained | Coordinator |
| Luminent | Learning records under a separate agreement | Per that agreement | [ ] Covered by the licensing agreement — [PLACEHOLDER: confirm] | Founder |

## Rule

No vendor receives a child's personal information in production until its row above is checked and dated. A new subprocessor triggers a review of the information security program (§ 312.8(b)(5)).
