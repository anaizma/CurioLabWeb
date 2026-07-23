# Milestone 2 execution plan: The Lab

The internal community feed, per [../08-build-phasing.md](../08-build-phasing.md). Built on the ready authorization layer: the feed and moderation capabilities already live in `packages/core` with allow/deny fixtures, and minor writes are already gated on `platform_participation`, and minor feed reads too. M2 adds the content schema, the services, and the HTTP layer. Reference specs: [../02-data-model.md](../02-data-model.md) (community content), [../03-authorization.md](../03-authorization.md) (the feed capability conditions), [../04-state-machines.md](../04-state-machines.md) (feed post and moderation lifecycles), [../05-api-surface.md](../05-api-surface.md) (the Lab endpoints).

Every task is test-first (RED → GREEN → REFACTOR) against the shared embedded-Postgres harness with synthetic data. Nothing here touches a real family's data; M2 is behind the same production gate as M1, buildable now.

Scope note: projects and the public project directory are Milestone 3, so `project`/`project_media`/`media_depiction` and media-on-posts are NOT built here. M2 is text posts, comments, reactions, moderation, and the milestone/timeline spine.

## M2.1: Feed content schema

- `post`: `id`, `chapter_id` fk, `pod_id` fk null, `author_membership_id` fk, `type` enum(`wip`,`finished_project`,`question`,`session_recap`,`milestone`), `body` text, `status` enum(`published`,`hidden`,`removed`), `system_generated` boolean. Authorship is by membership (carries capacity and scope).
- `comment`: `id`, `post_id` fk, `author_membership_id` fk, `body`, `status` enum(`published`,`hidden`,`removed`).
- `reaction`: `target_type` enum(`post`,`comment`), `target_id`, `membership_id` fk, `kind`. Unique `(target_type, target_id, membership_id, kind)`.
- `timeline_entry` (append-only): `id`, `account_id` fk, `kind`, `occurred_at`, `ref`. The profile spine; also the source of milestone posts.
- Additive migration; DB guarantee tests (the reaction uniqueness, the append-only discipline on `timeline_entry`, enum/nullability checks). Reuse the shared harness.
- Acceptance: schema and guarantee tests green; existing suites unaffected.

## M2.2: Posts, comments, reactions

- `PostService`: create (`feed.post`, minor gated on `platform_participation`, authored by the actor's in-scope membership), edit own (`feed.post` own), and the lifecycle `published -> hidden -> removed` (`feed.moderate` or `feed.hide_safety` to hide; `feed.moderate` to remove, which blanks the body and retains the row). `milestone` posts are `system_generated` and are created only by M2.5, never by this path.
- `CommentService`: create (`feed.comment`, minor gated), same hide/remove lifecycle.
- `ReactionService`: add/remove (`feed.react`), unique per actor+target+kind.
- Verify the existing registry entries have the right shape (scope chapter/pod, the minor `actorConsent`); adjust if needed with fixtures.
- Acceptance: the lifecycle and consent-gate tests green, including the negatives (a minor without `platform_participation` cannot post or comment; alumni cannot comment; removed is terminal and blanks the body).

## M2.3: Feed read and filters

- `FeedService.view(ctx, filters)` — `feed.view`, scoped to the actor's chapter or pod; filters by pod, post `type`, and author; pagination. A minor without `platform_participation` cannot read (already gated). Reads that surface a minor's content from outside the actor's pod emit the `minor_record.read` obligation transactionally.
- Acceptance: scope and filter tests green; the outside-pod read logs; an unconsented minor is denied.

## M2.4: Moderation

- `moderation_report` schema (additive migration): per [../02-data-model.md](../02-data-model.md), including the generated `due_at` (24h for `safety`, 72h for `ordinary`), `class`, `reason`, the resolver/escalation fields, and the refusal-reason discipline. DB guarantee test for the generated `due_at`.
- `ModerationService`: file a report (`feed.report`); the lifecycle `filed -> acknowledged -> resolved` with `escalated` reachable from any pre-resolution state; `moderation.resolve` requires `actorCondition age >= 18`; `feed.hide_safety` (any chapter instructor, not pod-bound) hides on sight and auto-files a `class = safety` report.
- The escalation job body: `resolved_at IS NULL AND due_at < now AND escalated_at IS NULL` escalates and (for a safety report with an unresponsive Chapter Director) targets `platform_admin`. Job body only; scheduling is a go-live wiring step.
- Acceptance: SLA generation, the lifecycle, the minor-cannot-resolve negative, hide-on-sight by an out-of-pod instructor, and the escalation query all green.

## M2.5: System-generated milestones and the timeline (the empty-state solution)

- `MilestoneService`: lifecycle transitions emit a `timeline_entry` and a `system_generated` milestone `post`. Wire the existing transitions that already exist: student activation (a "Joined" and an initial-Explorer milestone), tier transitions, and the first post or mentor session recap. Projects are M3, so those milestone sources are deferred.
- The empty-state property: a brand-new Explorer's feed and (future) profile read as populated from these seeded entries rather than blank.
- Acceptance: activating a student writes the expected timeline entries and milestone posts in the same transaction as the activation (extend coupling A/F wiring); a day-one account has a non-empty timeline.

## M2.6: HTTP layer

- Thin `app/api/**/route.ts` adapters over new controllers in `packages/http` for the Lab surface from [../05-api-surface.md](../05-api-surface.md): `GET /api/lab/feed`, `POST /api/lab/posts`, `PATCH /api/lab/posts/:id`, `POST /api/lab/posts/:id/comments`, reactions, `POST /api/lab/reports`, `POST /api/lab/posts/:id/{hide,remove}`, `GET /api/lab/moderation/queue`, `POST /api/lab/moderation/:id/{ack,resolve,escalate}`.
- Acceptance: controller tests green (auth, opaque 403, minor gating, outside-pod read log); root `next typegen && tsc` clean.

## Order and checkpoints

Build M2.1 then M2.2 then M2.3 (the content core), review, then M2.4 (moderation), then M2.5 (milestones), then M2.6 (HTTP). Each phase is verified against the full suite before the next. The feed depends on nothing outside the ready authorization layer and the M0 schema, so there is no cross-milestone gate other than the production data gate that applies to all of M1 and M2.
