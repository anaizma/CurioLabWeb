# Written information security program (DRAFT SKELETON)

> **DRAFT. Not legal advice.** § 312.8(b) of the amended COPPA rule requires a written information security program with five specific elements. This scaffold fills what the platform's design already determines and marks the organizational decisions for the founder ([PLACEHOLDER: name], the designated coordinator) and counsel. Review and complete before adopting. Cross-reference: [../compliance-coppa.md](../compliance-coppa.md) 1.7.

## 1. Designated coordinator (§ 312.8(b)(1))

The coordinator responsible for this program is [PLACEHOLDER: founder name], [PLACEHOLDER: title]. Contact: [PLACEHOLDER]. The coordinator maintains this document, runs the annual assessment, and is the point of contact for a suspected incident (see [incident-runbook.md](incident-runbook.md)).

## 2. Risk assessment (§ 312.8(b)(2)), at least annually

Identify internal and external risks to the confidentiality, security, and integrity of children's personal information. Initial assessment areas:

- **Access by contributors.** University students on semester tenures have code and possibly database access. Risk: over-broad access. Control: Mechanism A database role separation (an analytics role cannot read financial or HR tables), the single authorization code path, and secret rotation on offboarding.
- **The public application surface.** The one unauthenticated write set. Control: the surface collects only a parent email at Stage 1; the enumerated unauthenticated endpoints are each inert (create no authority); rate limiting and a bot check are required at the HTTP edge.
- **Signed enrollment forms.** The most sensitive documents. Control: private object storage, access only through short-lived signed URLs, audited retrieval.
- **Session and credential handling.** Control: argon2id password hashing, opaque server-side sessions, instant revocation on offboarding, no student email collected, no direct messaging between accounts.
- [PLACEHOLDER: counsel and coordinator to add organizational risks — physical, personnel, vendor.]

Last assessment: [PLACEHOLDER: date]. Next due: [PLACEHOLDER].

## 3. Safeguards (§ 312.8(b)(3))

Technical safeguards implemented in the platform:

- Compliance rules enforced in the database (DOB provenance, form-sourced consent, single active membership, append-only audit and consent ledgers, write-once DOB) so application code cannot violate them.
- A single authorization code path; consent gated as a peer of role; deny reasons never leaked to clients.
- Append-only audit log capturing role and consent changes, reads of a minor's record, permission-denied events, and impersonation.
- Encryption at rest (managed Postgres, private object storage); TLS in transit.
- Impersonation for support is admin-only, time-boxed, logged, and never write-impersonation of a minor.

Organizational safeguards: [PLACEHOLDER: access approval process, device and password policy, background checks if any, training].

## 4. Testing and monitoring (§ 312.8(b)(4))

- The authorization guarantees are covered by a failing-first "must not" test suite; the build fails if a mutating route lacks an authorization decision or a capability lacks test coverage.
- [PLACEHOLDER: cadence for reviewing audit logs, especially permission-denied spikes; dependency and vulnerability scanning; the quarterly restore drill from the ops plan.]

## 5. Evaluation and adjustment (§ 312.8(b)(5)), at least annually

The coordinator evaluates this program at least annually and after any material change in data practices, a security incident, or a new subprocessor, and adjusts safeguards accordingly. Evaluation log: [PLACEHOLDER].

## Subprocessors (§ 312.8(c))

Written assurances are required from every third party that handles children's data before use. Tracked in [vendor-dpa-checklist.md](vendor-dpa-checklist.md).
