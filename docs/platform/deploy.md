# Deployment (Milestone 0.5)

This documents the deploy target and what it needs. It is deliberately not wired into the repo root, because the existing marketing site has its own deployment and the platform backend should not silently take it over. The templates live in [deploy/](deploy/).

**Status: not provisioned.** Standing up live infrastructure needs real credentials for Fly (or Railway/Render), Cloudflare R2, Resend, and Stripe, which are not available to the build. Everything below is the checklist and the templates to do it, not a completed deploy. This is the one Milestone 0 phase that cannot be finished without you.

## Target

Per [01-stack.md](01-stack.md): a single always-on Node container in one US region, running the app and the pg-boss worker, with managed Postgres, private R2 object storage, and Resend for mail. Not serverless, because the RLS pattern wants pinned connections and there is real always-on background work.

## Provisioning checklist (yours to run)

1. **Postgres.** Create a managed Postgres (Neon or Fly Postgres) with point-in-time recovery of at least 30 days and encryption at rest. Create the two Mechanism A roles from `packages/db/migrations/0002_roles.sql`: `curiolab_app` (the app connection) and `curiolab_analytics` (read-only, denied the protected tables). The app connects as `curiolab_app`, never as the owner.
2. **Object storage.** Create a private Cloudflare R2 bucket for signed enrollment forms and media. No public access. Access only through short-lived signed URLs. Retrieval is audited.
3. **Email.** In Resend, authenticate the sending domain (SPF, DKIM, DMARC) and set up two subdomains: a transactional one for invites, resets, and notices, and a separate one for the newsletter, so a newsletter complaint cannot poison invite deliverability. Configure the bounce and complaint webhook to point at `/webhooks/resend`.
4. **Stripe.** Configure the webhook to `/webhooks/stripe` and store the signing secret. No card data or amounts are stored here.
5. **Secrets.** Put every value from [deploy/env.example](deploy/env.example) into the host secret store, never the repo. Rotate any shared secret when a contributor offboards.
6. **Container.** Build from [deploy/Dockerfile.example](deploy/Dockerfile.example). Run the migrations in `packages/db/migrations` in order before first boot. Confirm the health check responds and the app connects to Postgres as `curiolab_app`.

## Acceptance (deferred)

The plan's acceptance for this phase is a smoke deploy that runs the health check and connects to Postgres. That cannot be verified without the credentials above, so it is explicitly deferred to you. Nothing else in Milestone 0 depends on it.

## Backups and the restore drill

Managed Postgres PITR covers disaster recovery. Separately, schedule the quarterly restore drill from [07-test-plan.md](07-test-plan.md): restore into an isolated environment with production-equivalent access controls, time-boxed, destroyed after verification, with the restore writing an audit entry. Test and CI databases use synthetic data only, never a production restore.
