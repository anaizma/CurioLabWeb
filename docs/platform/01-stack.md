# 01. Stack

## Summary

TypeScript end to end, as a modular monolith. Business logic (entities, the authorization engine, the state machines) lives in a framework-agnostic `core` package with zero Next.js or HTTP imports. Next.js provides the frontend and a thin API layer that authenticates a request, calls a core function, and serializes the result. PostgreSQL is the database, accessed through Drizzle, with the compliance-critical constraints enforced at the database level. Authentication is server-side sessions stored in Postgres, built in-house on vetted primitives, not a hosted auth product and not JWTs. Deploy is a single always-on container in one US region, with private S3-compatible object storage for sensitive documents and a Postgres-backed job runner.

## Language and framework: TypeScript modular monolith

- One repository. A `core` package that is pure TypeScript: data types, the single authorization function, state machines, consent logic. It imports nothing from Next.js and nothing from the HTTP layer.
- Next.js (version 16, per `package.json`) provides the frontend and API route handlers. A route handler authenticates the request, calls a core function, and serializes.
- Deploy as one unit. The pure core lifts into a standalone service later if needed, which requires an API contract, serialization, and auth-context propagation. That is cheaper than a rewrite, which is the point, not free.

Rationale and rejected alternatives (plain Next.js full-stack, a separate Fastify backend from day one, Python/Django) are in [decision-log.md](decision-log.md).

## Database: PostgreSQL

Chosen because three locked decisions and one open worry are database features:

- Append-only audit and consent ledgers: `UPDATE` and `DELETE` revoked at the table level plus a trigger backstop.
- The access matrix ("a product lead with a database connection reads everything"): separate database roles per trust boundary (Mechanism A) plus selective row-level security (Mechanism B).
- The check constraints the rulings imply (DOB provenance, form-sourced consent source refs, evidence-backed tier).

## ORM: Drizzle

- Drizzle, not Prisma. The compliance-critical layer (append-only triggers, check constraints, RLS policies, the per-transaction `SET LOCAL`) is raw SQL regardless of ORM, so the team reads SQL either way. Drizzle keeps the whole data layer in one SQL-shaped idiom and makes the per-request RLS pattern (connection-scoped transaction plus `set local`) transparent. It ships first-class RLS primitives (`pgPolicy`, per-table enable).
- Zero migration cost: no ORM is installed yet.

### Two database access-control mechanisms, kept distinct

- **Mechanism A, role and credential separation.** Different trust contexts connect as different Postgres roles that lack privileges on tables they should not see. Set at connect time, no hot-path cost, ORM-agnostic. This is the real answer to the product-lead problem. **Ships in Milestone 0.**
- **Mechanism B, per-request row-level security.** Policies filter rows by the caller's identity, pod, or chapter, activated by a transaction-local variable, applied selectively to the highest-risk tables. Defense in depth. **Ships in Milestone 4.**

## Authentication: in-house server-side sessions

Authentication is thin (which account is this). Authorization is the whole game and is computed from memberships, consents, and edges, never from auth. This rules out hosted products (Auth0, Clerk, Supabase Auth, Better Auth), which center email, assume self-signup, and model roles on the user. Better Auth was evaluated against the five hard requirements and fails the decisive one: its username plugin still requires an email at sign-up, and minor students collect no email. Evidence is in [decision-log.md](decision-log.md).

- Password hashing: argon2id, from an audited library.
- Sessions: an opaque random token to the client in an httpOnly, Secure, SameSite cookie; the token hash stored server-side as `session.token_hash`. Not JWTs, because instant revocation is required by offboarding, suspension, and impersonation expiry.
- The only custom parts are the identity model and the invite and guardian-provisioning flows, which no product supports. No cryptography is invented.
- Session patterns follow the canonical Lucia reference (deprecated as a library, retained as the reference implementation) on maintained primitives.

## Hosting: one always-on container

- A long-lived Node container (Fly.io as default, Railway or Render equivalent) running `next start`, plus the pg-boss worker (same container initially, splittable later). One US region.
- Chosen over serverless because: the RLS pattern wants pinned connections rather than a transaction-mode pooler; the system has real always-on background and scheduled work; and one process is easier for a rotating team to reason about.
- Managed Postgres with point-in-time recovery of at least 30 days and encryption at rest.
- Private, S3-compatible object storage (Cloudflare R2) for signed enrollment forms and media, reached only through short-lived signed URLs, with audited retrieval.
- Background and scheduled work on pg-boss (Postgres-backed), so no Redis.

## Email: Resend

Already a dependency (`resend` in `package.json`).

- Domain authentication (SPF, DKIM, DMARC) is mandatory, because 100 percent of onboarding is invite email.
- Transactional and bulk are isolated by subdomain: invites, resets, and system notices from a transactional subdomain; the family newsletter from a separate subdomain, so a newsletter complaint cannot poison invite deliverability.
- Bounce and complaint handling via Resend webhooks, updating delivery status and surfacing a hard-bounced guardian invite to the Chapter Director queue.
- The newsletter runs through Resend too, isolated by subdomain and list; splitting vendors later is a config change.

## Operations

- **Backups and restore.** Managed Postgres PITR (30 days minimum), encryption at rest, a quarterly restore drill into an isolated environment with production-equivalent access controls, time-boxed and destroyed after verification, with the restore writing an audit entry. An annual encrypted logical export to cold storage covers the seven-year obligation independent of the provider. See test data policy in [07-test-plan.md](07-test-plan.md).
- **Secrets.** Database credentials, the Resend key, R2 keys, and the session secret live in the host secret store, never in the repo. Rotate any shared secret when a contributor offboards.
- **Audit growth.** The `audit_entry` table is partitioned by month; roughly the last 24 months stay hot, older partitions are detached and archived to encrypted object storage and remain queryable via a documented reattach path. Indexed by subject and by actor, both with time.
