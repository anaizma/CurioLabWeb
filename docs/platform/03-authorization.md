# 03. Authorization layer

One pure function over a declarative registry, a fixed resolution order that puts consent on equal footing with role, a single wrapper that makes denial logging total, and a database floor beneath the whole thing. No route makes an ad hoc permission decision.

## The two-layer split

```ts
// pure, in core, no IO, fully unit-tested
can(ctx: AuthContext, capability: Capability, resource: Resource): Decision

Decision =
  | { allowed: true;  obligations: Obligation[] }
  | { allowed: false; reason: DenyReason; detail: Record<string, unknown> }
```

`can` never logs and never throws. The reason a denial exists is data, so it can be asserted in tests and written to audit.

```ts
// thin wrapper, app layer, the ONLY place that does IO
async function authorize(ctx, capability, resource): Promise<void> {
  const d = can(ctx, capability, resource)
  if (!d.allowed) {
    await audit.write('permission.denied', { actor: ctx, capability, ...d.detail, reason: d.reason })
    throw new Forbidden()            // generic, no reason leaked to the client
  }
  for (const ob of d.obligations) await ob.run()   // e.g. a transactional minor_record.read
}
```

`authorize` records its decision on an `AsyncLocalStorage` request context. The repository write layer asserts a decision is present before any mutation and throws otherwise, in every environment. This is the runtime backstop that makes the single-code-path invariant hold even if a route forgets to call `authorize`. It is paired with a build-time route manifest (see [07](07-test-plan.md)).

## The registry

A capability is a declaration, not code. `can` is an interpreter over these declarations, which is what makes it a single code path.

```ts
type Scope = 'platform' | 'chapter' | 'pod' | 'own' | 'guardian'

type CapabilityDef = {
  scope: Scope | Scope[]                 // resolution tries each until one matches
  roles: Role[]
  writes: boolean                        // gates read-only impersonation mode
  actorCondition?: (ctx) => boolean      // e.g. age >= 18 for moderation.resolve
  ownCondition?: (ctx) => boolean        // extra test for 'own' scope, e.g. age >= 18
  actorConsent?: (ctx, resource) => ConsentType[]      // required OF THE ACTOR
  subjectConsent?: (resource) => SubjectConsentReq[]   // read from the resource snapshot, never fetched
  logsRead?: boolean                     // emits a transactional minor_record.read obligation
}

type SubjectConsentReq = { student: AccountId; type: ConsentType; scopeRef?: Id }
```

Adding a capability is adding a row. Reviewing what a role can do is reading this table. There is nowhere else for a permission rule to hide. The registry is the capability matrix.

The platform override is a separate function consulted only at the scope and role steps, never at consent:

```ts
function platformGrant(ctx, capability, resource): { scope: boolean; role: boolean } | null {
  if (ctx.has('platform_admin'))  return { scope: true, role: true }   // consent gates still run
  if (ctx.has('platform_staff')) {
    if (!REGISTRY[capability].writes) return { scope: true, role: true }
    if (capability === 'newsletter.publish' && resource.studentAuthoredItems.length === 0)
      return { scope: true, role: true }
  }
  return null
}
```

## AuthContext

Built once per request from indexed reads and passed by value into the pure core. Nothing downstream re-queries roles.

```ts
AuthContext {
  now:            Timestamp                  // request instant, for decision-time expiry
  account:        { id, status, age, maturation_state, credential_owner }
  session:        { mode, expires_at, revoked_at, impersonation? }
  memberships:    Membership[]               // each with resolved in-force window, chapter, role, pod, tier
  guardianOf:     StudentId[]                // verified guardianship edges
  consentsByChild: Map<StudentId, ConsentSet>
}
```

Age is evaluated in the enrolling chapter's timezone. A membership is in force only if `status = 'active'` and `active_from <= now < active_until`, evaluated at decision time so expiry does not depend on the sweeper.

## Resolution order

```
can(ctx, capability, resource):
  def = REGISTRY[capability]

  1. Account gate
       ctx.account.status === 'active'                      else DENY account_not_active

  2. Session and impersonation gate
       if ctx.session.expired(ctx.now) or revoked           DENY session_invalid
       if ctx.impersonation and ctx.session.mode==='read_only' and def.writes
                                                            DENY impersonation_write_forbidden

  3. Scope resolution   (platformGrant may satisfy this)
       'chapter'  -> in-force membership in resource.chapter_id
       'pod'      -> in-force membership on resource.pod_id (or pod_assignment)
       'own'      -> membership owns resource AND (def.ownCondition?(ctx) ?? true)
       'guardian' -> resource.subjectAccountId in ctx.guardianOf
       none match                                            DENY out_of_scope

  4. Role gate          (platformGrant may satisfy this)
       matchedMembership.role in def.roles                  else DENY role_not_permitted
       def.actorCondition?(ctx) ?? true                     else DENY actor_condition_failed

  5. Actor consent gate     (NO override, runs for everyone)
       for t in def.actorConsent?(ctx, resource) ?? []:
         consent_current[actor][t].active                   else DENY actor_consent_missing

  6. Subject consent gate   (NO override, from the resource snapshot)
       for req in def.subjectConsent?(resource) ?? []:
         snap = resource.consentSnapshotFor(req.student, req.type)
         if snap === undefined                              DENY subject_consent_unknown   // fail closed
         if not snap.active or (req.scopeRef and snap.scopeRef !== req.scopeRef)
                                                            DENY subject_consent_missing

  7. Obligations
       if def.logsRead and resource concerns a minor outside the actor's pod:
         attach a transactional minor_record.read obligation
       ALLOW { obligations }
```

The platform override lives only in steps 3 and 4. Steps 5 and 6 have no override branch, which is the structural guarantee that consent gates every actor.

## Subject consent travels on the resource

`can` stays pure. The repository layer hydrates the resource with a consent snapshot (for example `issue.studentAuthoredItems[i].consentState`) before `authorize` is called. A required field absent from the resource denies `subject_consent_unknown`, so a route that forgets to hydrate fails closed rather than passing by omission.

## Guardian capabilities

All scope `guardian`, matched only against the guardian's own verified children. This is the complete set; a guardian has no other capability anywhere.

| capability | writes | notes |
|---|---|---|
| `guardian.view_child_record` | no | own child; emits a read log |
| `guardian.view_fee_status` | no | reads payment and scholarship status |
| `consent.grant` | yes | scope `['guardian','own']`, `ownCondition: age >= 18`; guardian barred once the child is 18 via `childAge < 18` on the guardian path |
| `consent.revoke` | yes | same shape; fires coupling C1 or C2 |
| `guardian.request_export` | yes | files a request for staff fulfillment |
| `guardian.request_deletion` | yes | files a `deletion_request` |
| `guardian.view_digest` | no | the chapter digest, never the feed |

## Denial logging and the database floor

Every denial flows through the one `authorize` wrapper, which writes `permission.denied` with the full structured reason. Coverage is total by construction. The client receives one opaque `Forbidden`, so `out_of_scope`, `role_not_permitted`, and `subject_consent_missing` are indistinguishable from outside and reveal nothing about which children or chapters exist.

Beneath the application decision sit the two database mechanisms from [01](01-stack.md): role and credential separation (Mechanism A, Milestone 0) so a restricted connection cannot read protected tables, and selective row-level security (Mechanism B, Milestone 4) so a forgotten filter still returns nothing across a boundary. The application decision is primary; the database is the floor that holds when the application is wrong.

## Notable capability conditions

- `feed.view`: `actorConsent: (ctx) => ctx.account.age < 18 ? ['platform_participation'] : []`. Minors need consent to read the feed, not only to write.
- `feed.comment`, `feed.post`: same actor consent for minors.
- `newsletter.publish`: roles `[chapter_director]`; `subjectConsent` requires `external_publication` scoped to the issue for each student-authored item.
- `feed.hide_safety`: scope `chapter` (any teaching membership in the chapter, not pod-bound), no consent gate, no age condition, so a minor mentor may hide on sight.
- `moderation.resolve`: `actorCondition: ctx.account.age >= 18`, so a minor cannot resolve any report, and safety responders skip minor memberships.
- `verification.regenerate`: scope `own` or `guardian`.
- `project.verify`: instructor in own pod or director; available to minors for now (flagged in [open-questions.md](open-questions.md)).
