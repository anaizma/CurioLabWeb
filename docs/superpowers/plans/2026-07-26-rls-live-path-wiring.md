# RLS Live-Path Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `withRlsContext` (Mechanism B row-level security) the exclusive live-application path to the five RLS-protected tables (`membership`, `consent`, `enrollment_record`, `guardianship`, `audit_entry`) plus the previously-unprotected `consent_current` projection, so a missing application-layer filter returns zero rows instead of leaking across a chapter/family boundary — and prove it with a real Postgres role, not an assertion.

**Architecture:** Convert every touch point in `packages/app/src`, `packages/http/src/context.ts`, and `packages/http/src/controllers/*.ts` to open its transaction via `withRlsContext(sql, rlsContextFromAuth(ctx), fn)` instead of a bare `sql.begin(...)` or a loose `sql\`...\`` call — a **mechanical, two-bucket substitution** (see "The two RLS contexts" below), done file-by-file, dark-safe the entire time because `curiolab_app` keeps `BYPASSRLS` until the very last task. Each file's task proves itself with a new test that runs the *same* function authenticated as `curiolab_rls` (which has **no** `BYPASSRLS`) and asserts real filtering — not just "no error," but "the wrong chapter's row is actually absent." Only after every task is done and the full suite passes both ways (`curiolab_app`, unchanged; `curiolab_rls`, correctly filtered) does the final, irreversible-per-environment migration strip `BYPASSRLS` from `curiolab_app` itself in a real environment.

**Tech Stack:** PostgreSQL 17 row-level security, `postgres.js` (`sql.begin`, `SET LOCAL` via `set_config(..., true)`), Vitest + `embedded-postgres`, the existing `withRlsContext` seam (`packages/runtime/src/rls.ts`).

---

## Why this plan looks the way it does (read before starting)

Four decisions changed the shape of this plan from what the original migration's own comments assumed. Get these right before touching file 1, because reversing any of them after Phase 2 starts means redoing every task.

### 1. `curiolab_app` loses `BYPASSRLS`; `curiolab_rls` is NOT the new live role

`packages/db/migrations/0018_rls.sql`'s own header says production should "connect the app as `curiolab_rls`." Don't do that. Audited every migration's grants (`grep -n "GRANT.*curiolab_rls\|ALTER ROLE curiolab_app" packages/db/migrations/*.sql`): `curiolab_rls` only ever received per-table grants for the handful of tables introduced *after* migration 0018 (the append-only/DM/consent-grant tables) — it has **zero** grants on `account`, `chapter`, `session`, `project`, `feed_post`, `credential_token`, and every other ordinary table that predates 0018, because Postgres's `GRANT ... ON ALL TABLES IN SCHEMA public` only covers tables that exist *at the time the GRANT runs*. Turning `curiolab_rls` into a full live-connection role means re-auditing and re-granting 40 migrations' worth of tables — a bigger, more error-prone task than the one alternative:

**`ALTER ROLE curiolab_app NO BYPASSRLS`.** `curiolab_app` already holds every grant it needs (it's been the app's role since migration 0002). Stripping its `BYPASSRLS` flag is what actually turns RLS on for the live connection — one line, no re-grant audit, no second role to keep in sync forever. `curiolab_rls` remains exactly what it already is: a test-only proof role.

### 2. The two RLS contexts — every touch point is one of these two, no exceptions

```ts
// Bucket A — a real, authenticated, actor-driven request.
{ accountId: ctx.account.id, isPlatform: isPlatformActor(ctx) }

// Bucket B — a system/sweep/token-gated/already-vetted-public path with no
// logged-in actor. The authority is something else (a cron trigger, a
// single-use cryptographic token, an explicit upstream consent check) —
// RLS's job here is only to not be MORE restrictive than what already
// authorized this read, and `isPlatform: true` is the existing "see
// everything" escape hatch every RLS policy already has (0018_rls.sql:
// `rls_actor_is_platform() OR ...`), not a new bypass invented for this
// refactor.
{ isPlatform: true }
```

Bucket B applies to: the four sweep jobs (no HTTP actor at all), `bootstrap-admin.ts` (the one account with no inviter), every unauthenticated token-gated flow (`invite.ts`'s `validateInvite`/`acceptInvite` prior to the account existing, `student-setup.ts`), and the two genuinely-public read surfaces (`verification.ts`, `packages/http/src/controllers/public-reads.ts`) — each of those already re-implements its own narrower authorization (a token match, a `public_profile` consent check) *before* the query runs; RLS is a ceiling on top of application logic that already decided this data is meant to be visible here, not a re-implementation of that logic.

Everything else — every controller-invoked, session-backed service method — is Bucket A, and in every one of them `ctx: AuthContext` is *already a parameter* (because they already call `authorize(ctx, capability, resource)`), so deriving the RLS context costs nothing new to thread through.

### 3. `consent_current` is a second table, not covered by the original migration, and needs its own RLS policy

`packages/http/src/context.ts:113-116` and at least seven service files read `consent_current`, not the append-only `consent` table (`packages/db/migrations/0000_base.sql:233-245`; trigger-maintained by `maintain_consent_current`, `0001_guarantees.sql:101-131`). Migration 0018 never enabled RLS on it. Wrapping every `consent` write in `withRlsContext` protects **zero** consent *reads* unless `consent_current` gets the same policy shape. Task 2 fixes this with a new migration mirroring `consent_rls` exactly, since the columns line up (`student_account_id`, no `chapter_id`).

### 4. No new config flag — the migration itself is the flag

Every other REVIEW-GATED feature in this codebase (`CONSENT_GRANT_LEDGER_ENFORCED`, `MENTOR_ELIGIBILITY_ENFORCED`, `MENTOR_DM_ENABLED`) uses a boolean env flag because enforcement can be toggled per-request. `BYPASSRLS` is a Postgres *role* property — there's no per-request granularity, so a boolean config flag would be theater. The real "flag" is: has migration 0042 (Task 40, written now, **not applied to any environment until Task 39's gate passes**) been run against this database yet. Sequencing discipline is the control here, not a flag.

---

## File structure

**New files:**
- `packages/db/migrations/0041_consent_current_rls.sql` — RLS policy for `consent_current` (Task 2)
- `packages/db/migrations/0042_curiolab_app_rls_enforced.sql` — the final `ALTER ROLE` (Task 40; written in Phase 0, **applied only after Task 39**)
- `packages/runtime/test/helpers/rls-proof.ts` — shared test helper: run a function against `curiolab_rls` and assert filtering (Task 4)

**Modified (every touch point enumerated below, one task per file unless noted):**
- `packages/core/src/platformGrant.ts` — add `isPlatformActor` (Task 1)
- `packages/core/src/index.ts` — export it (Task 1)
- `packages/runtime/src/rls.ts` — add `rlsContextFromAuth` (Task 1)
- `packages/http/src/context.ts` — `resolveAuthContext` (Task 5)
- `packages/http/src/controllers/auth.ts` — `login`'s membership check (Task 6)
- `packages/http/src/controllers/audit.ts` — `readOpsAudit`, `readAdminAudit` (Task 38)
- `packages/http/src/controllers/public-reads.ts` — `listPublicProjects`, `viewPublicProject` (Task 39)
- `packages/app/src/*.ts` — 29 files, Tasks 7-37 (full list below)

---

## Phase 0: Foundations (Tasks 1-6) — land these first, in order

### Task 1: `isPlatformActor` + `rlsContextFromAuth`

**Files:**
- Modify: `packages/core/src/platformGrant.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/runtime/src/rls.ts`
- Test: `packages/core/test/platform-grant.test.ts` (new `describe` block; file already exists per the registry meta-test pattern — if it doesn't, create it)
- Test: `packages/runtime/test/rls-context.test.ts` (extend the existing file)

- [ ] **Step 1: Write the failing test for `isPlatformActor`**

Add to `packages/core/test/platform-grant.test.ts` (create the file if it doesn't exist yet, mirroring the fixture style of `packages/core/test/can.test.ts`):

```ts
import { describe, expect, test } from 'vitest'
import { isPlatformActor } from '../src/platformGrant.js'
import type { AuthContext, Membership } from '../src/types.js'

function ctxWith(role: Membership['role'] | null, now = 0): AuthContext {
  return {
    now,
    account: { id: 'a1', status: 'active', age: 30, maturation_state: 'self_managed', credential_owner: 'self_private' },
    session: { mode: 'full', expires_at: now + 1000, revoked_at: null },
    memberships: role
      ? [{ chapter_id: 'c1', role, status: 'active', pod_id: null, tier: null, active_from: null, active_until: null }]
      : [],
    guardianOf: [],
    consentsByChild: new Map(),
  }
}

describe('isPlatformActor', () => {
  test('platform_admin is a platform actor', () => {
    expect(isPlatformActor(ctxWith('platform_admin'))).toBe(true)
  })
  test('platform_staff is a platform actor', () => {
    expect(isPlatformActor(ctxWith('platform_staff'))).toBe(true)
  })
  test('chapter_director is NOT a platform actor', () => {
    expect(isPlatformActor(ctxWith('chapter_director'))).toBe(false)
  })
  test('no membership is NOT a platform actor', () => {
    expect(isPlatformActor(ctxWith(null))).toBe(false)
  })
  test('an inactive platform_admin membership does not count', () => {
    const ctx = ctxWith('platform_admin')
    ctx.memberships[0]!.status = 'inactive'
    expect(isPlatformActor(ctx)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test --workspace=@curiolab/core -- platform-grant.test.ts`
Expected: FAIL — `isPlatformActor is not a function` (or the file doesn't exist yet, module resolution error).

- [ ] **Step 3: Implement `isPlatformActor` in core**

In `packages/core/src/platformGrant.ts`, export the existing private `hasRole` logic as a new public function (keep `hasRole` itself unexported and unchanged — just add a caller):

```ts
/**
 * True iff the actor holds an in-force platform_admin OR platform_staff
 * membership. Used to derive the RLS `isPlatform` GUC (packages/runtime/src/
 * rls.ts) — RLS's "see everything" escape hatch should be at least as
 * permissive as platformGrant's, since RLS is a ceiling on top of an already
 * -authorized request, never a re-implementation of the write gate that
 * `can()`/`authorize()` already enforced before this point.
 */
export function isPlatformActor(ctx: AuthContext): boolean {
  return hasRole(ctx, 'platform_admin') || hasRole(ctx, 'platform_staff')
}
```

In `packages/core/src/index.ts`, add to the existing export line:

```ts
export { platformGrant, isPlatformActor } from './platformGrant.js'
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npm run test --workspace=@curiolab/core -- platform-grant.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for `rlsContextFromAuth`**

Add to `packages/runtime/test/rls-context.test.ts` (below the existing `describe` block, same file, same harness/fixtures already imported):

```ts
import { rlsContextFromAuth } from '../src/rls.js'

describe('rlsContextFromAuth', () => {
  test('a platform_admin actor maps to isPlatform: true', () => {
    const ctx = {
      now: 0,
      account: { id: director, status: 'active' as const, age: 40, maturation_state: 'self_managed' as const, credential_owner: 'self_private' as const },
      session: { mode: 'full' as const, expires_at: 1000, revoked_at: null },
      memberships: [{ chapter_id: chapterA, role: 'platform_admin' as const, status: 'active' as const, pod_id: null, tier: null, active_from: null, active_until: null }],
      guardianOf: [],
      consentsByChild: new Map(),
    }
    expect(rlsContextFromAuth(ctx)).toEqual({ accountId: director, isPlatform: true })
  })

  test('a student actor maps to isPlatform: false with their own accountId', () => {
    const ctx = {
      now: 0,
      account: { id: studentA1, status: 'active' as const, age: 12, maturation_state: 'minor' as const, credential_owner: 'guardian_provisioned' as const },
      session: { mode: 'full' as const, expires_at: 1000, revoked_at: null },
      memberships: [{ chapter_id: chapterA, role: 'student' as const, status: 'active' as const, pod_id: null, tier: null, active_from: null, active_until: null }],
      guardianOf: [],
      consentsByChild: new Map(),
    }
    expect(rlsContextFromAuth(ctx)).toEqual({ accountId: studentA1, isPlatform: false })
  })
})
```

(`director`, `chapterA`, `studentA1` are already in scope from the file's existing `beforeAll` fixtures.)

- [ ] **Step 6: Run to confirm it fails**

Run: `npm run test --workspace=@curiolab/runtime -- rls-context.test.ts`
Expected: FAIL — `rlsContextFromAuth is not a function`.

- [ ] **Step 7: Implement `rlsContextFromAuth`**

In `packages/runtime/src/rls.ts`, add the import and the function:

```ts
import { isPlatformActor, type AuthContext } from '@curiolab/core'

/**
 * Derive the RLS context from an already-resolved AuthContext — the Bucket-A
 * shape from the RLS live-path wiring plan (docs/superpowers/plans/2026-07-26
 * -rls-live-path-wiring.md). Every session-backed service method that already
 * has `ctx` in scope for `authorize()` calls uses this; it costs nothing new
 * to thread through.
 */
export function rlsContextFromAuth(ctx: AuthContext): RlsContext {
  return { accountId: ctx.account.id, isPlatform: isPlatformActor(ctx) }
}

/**
 * Bucket B from the same plan: a system/sweep/token-gated/already-vetted
 * -public path with no logged-in actor. `isPlatform: true` is RLS's existing
 * "see everything" escape hatch, not a bypass invented for this refactor —
 * these callers have already established authority some other way (a cron
 * trigger, a single-use token, an explicit upstream consent check) before
 * this point.
 */
export const SYSTEM_RLS_CONTEXT: RlsContext = { isPlatform: true }
```

- [ ] **Step 8: Run to confirm it passes**

Run: `npm run test --workspace=@curiolab/runtime -- rls-context.test.ts`
Expected: PASS (7 tests total in the file).

- [ ] **Step 9: Export `rlsContextFromAuth` and `SYSTEM_RLS_CONTEXT` from runtime's index**

In `packages/runtime/src/index.ts`, change:

```ts
export { withRlsContext, type RlsContext } from './rls.js'
```

to:

```ts
export { withRlsContext, rlsContextFromAuth, SYSTEM_RLS_CONTEXT, type RlsContext } from './rls.js'
```

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/platformGrant.ts packages/core/src/index.ts packages/core/test/platform-grant.test.ts packages/runtime/src/rls.ts packages/runtime/src/index.ts packages/runtime/test/rls-context.test.ts
git commit -m "feat(rls): add isPlatformActor + rlsContextFromAuth, the two-bucket RLS context derivation"
```

---

### Task 2: `consent_current` RLS migration

**Files:**
- Create: `packages/db/migrations/0041_consent_current_rls.sql`
- Test: `packages/db/test/rls.test.ts` (extend — this is the existing raw-SQL RLS proof file from migration 0018; find its `describe('consent_rls'` block and add a sibling)

- [ ] **Step 1: Write the failing test**

Add to `packages/db/test/rls.test.ts`, next to the existing `consent` RLS tests (reuse that file's existing `chapterA`/`chapterB`/`studentA1`/`studentB1`/`director`/`rls` fixtures — do not re-seed):

```ts
describe('consent_current_rls', () => {
  test('a student sees only their own consent_current row', async () => {
    const rows = await withRlsContext(rls, { accountId: studentA1 }, (tx) =>
      tx`select student_account_id from consent_current`,
    )
    const ids = rows.map((r) => r.student_account_id)
    expect(ids).toContain(studentA1)
    expect(ids).not.toContain(studentB1)
  })

  test('fail-closed: no accountId, not platform -> zero rows', async () => {
    const rows = await withRlsContext(rls, {}, (tx) => tx`select student_account_id from consent_current`)
    expect(rows).toHaveLength(0)
  })

  test('isPlatform sees every consent_current row', async () => {
    const rows = await withRlsContext(rls, { isPlatform: true }, (tx) =>
      tx`select student_account_id from consent_current`,
    )
    const ids = rows.map((r) => r.student_account_id)
    expect(ids).toEqual(expect.arrayContaining([studentA1, studentB1]))
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test --workspace=@curiolab/db -- rls.test.ts`
Expected: FAIL — Postgres error `permission denied for table consent_current` (no grant yet) or all three tests return unfiltered/zero rows incorrectly (no policy yet — RLS isn't enabled on the table, so a `curiolab_rls` SELECT would actually fail with a permission error first, since it has no grant on this table at all yet).

- [ ] **Step 3: Write the migration**

```sql
-- =========================================================================
-- 0041_consent_current_rls.sql — RLS on consent_current (Mechanism B gap).
--
-- 0018_rls.sql enabled RLS on `consent` but not on `consent_current`, the
-- SEPARATE, trigger-maintained projection every consent READ actually goes
-- through (packages/http/src/context.ts, and 7+ services in packages/app/src
-- — see the RLS live-path wiring plan). Without this, RLS on `consent`
-- guards only the four append sites; every consent READ stays unfiltered.
-- Same policy shape as consent_rls (0018_rls.sql) — consent_current has the
-- identical student_account_id column and no chapter_id, so the staff clause
-- resolves through membership exactly the same way.
-- =========================================================================

GRANT SELECT ON consent_current TO curiolab_rls;

ALTER TABLE consent_current ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_current_rls ON consent_current FOR ALL
  USING (
    rls_actor_is_platform()
    OR student_account_id = rls_current_account()
    OR student_account_id IN (SELECT rls_guardianed_children(rls_current_account()))
    OR student_account_id IN (SELECT rls_accounts_in_staff_chapters(rls_current_account()))
  );
```

- [ ] **Step 4: Run to confirm it passes**

Run: `npm run test --workspace=@curiolab/db -- rls.test.ts`
Expected: PASS, including the 3 new tests and every pre-existing test in the file unchanged (this migration doesn't touch `curiolab_app`, which still has `BYPASSRLS`, so nothing else can regress).

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0041_consent_current_rls.sql packages/db/test/rls.test.ts
git commit -m "fix(rls): enable RLS on consent_current, the table every consent read actually uses"
```

---

### Task 3: shared RLS-proof test helper

**Files:**
- Create: `packages/runtime/test/helpers/rls-proof.ts`
- Test: none (this IS test infrastructure; it's exercised by Task 5 onward)

- [ ] **Step 1: Write the helper**

```ts
// -------------------------------------------------------------------------
// Shared helper for the RLS live-path wiring plan (docs/superpowers/plans/
// 2026-07-26-rls-live-path-wiring.md). Every per-file task's proof test
// connects as curiolab_rls (NOBYPASSRLS) instead of the harness's default
// owner/curiolab_app connection, and asserts that a cross-chapter/cross
// -family row is REALLY absent — not just "no error."
// -------------------------------------------------------------------------
import type { Sql } from 'postgres'
import type { Harness } from '../../../db/test/helpers/pg.js'

/** Open a curiolab_rls connection against the same embedded harness database. */
export function rlsConnection(h: Harness): Sql {
  return h.connectAs('curiolab_rls', 'rls_pw')
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/runtime/test/helpers/rls-proof.ts
git commit -m "test(rls): add the shared rlsConnection helper for per-file RLS proof tests"
```

(No red/green cycle for this one — it's a thin wrapper around `Harness.connectAs`, which is already proven by `packages/runtime/test/rls-context.test.ts:53`.)

---

### Task 4: convert `resolveAuthContext`

**Files:**
- Modify: `packages/http/src/context.ts:64-116`
- Test: `packages/http/test/context-rls.test.ts` (new file)

This is the trickiest conversion in the whole plan: `resolveAuthContext` determines WHO the actor is by reading `membership`/`guardianship`, so it can't receive a pre-built RLS context — it has to bootstrap one from the account id it just resolved from the session. This is safe by construction: the RLS policies' first non-platform clause is always `account_id = rls_current_account()` (membership) or an equivalent own-row clause, so setting `accountId = effectiveAccountId` for this one self-scoped read always returns the actor's own full membership/guardianship set, regardless of `isPlatform`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/http/test/context-rls.test.ts
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { createSession } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { rlsConnection } from '../../runtime/test/helpers/rls-proof.js'
import { makeChapter, makeMinor, makeMembership } from './helpers/fixtures.js'
import { resolveAuthContext } from '../src/context.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

describe('resolveAuthContext against curiolab_rls', () => {
  test('a student sees their own membership even though RLS is active on the connection', async () => {
    const chapter = await makeChapter(h.sql)
    const student = await makeMinor(h.sql)
    await makeMembership(h.sql, student, chapter, { role: 'student', status: 'active' })
    const { token } = await createSession(h.sql, { accountId: student, expiresAt: new Date(Date.now() + 3_600_000) })

    const rls = rlsConnection(h)
    const ctx = await resolveAuthContext(rls, token, new Date())
    expect(ctx).not.toBeNull()
    expect(ctx!.memberships).toHaveLength(1)
    expect(ctx!.memberships[0]!.chapter_id).toBe(chapter)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test --workspace=@curiolab/http -- context-rls.test.ts`
Expected: FAIL — `ctx.memberships` is empty (RLS silently filters the unwrapped `select ... from membership` to zero rows for `curiolab_rls`, since no GUC is set — fail-closed, not an error).

- [ ] **Step 3: Convert `resolveAuthContext`**

In `packages/http/src/context.ts`, add the import:

```ts
import { validateSession, withRlsContext } from '@curiolab/runtime'
```

Wrap the membership read (currently plain `await sql\`...\``) and the guardianship read the same way — both keyed on `effectiveAccountId`, both self-scoped so `isPlatform` doesn't matter here:

```ts
  const memRows = await withRlsContext(sql, { accountId: effectiveAccountId }, (tx) => tx`
    select id, chapter_id, role, status, pod_id, current_tier,
           active_from::text as active_from, active_until::text as active_until
    from membership where account_id = ${effectiveAccountId}
  `)
```

and:

```ts
  const gRows = await withRlsContext(sql, { accountId: effectiveAccountId }, (tx) => tx`
    select student_account_id from guardianship
    where guardian_account_id = ${effectiveAccountId} and status = 'verified'
  `)
```

Leave the `account` read (line 64) and the `consent_current` read (line 113) untouched for this task — `account` isn't RLS-protected, and the `consent_current` read is covered by Task 15 (`consent.ts`-adjacent reads share a pattern; see that task for why `context.ts`'s consent read specifically is handled there, not here, to keep this task's diff to exactly the two touch points the failing test targets).

Actually — do it here too, since it's the same file and the same bootstrap moment. Also wrap the `consent_current` read:

```ts
  const cRows = await withRlsContext(sql, { accountId: effectiveAccountId }, (tx) => tx`
    select student_account_id, type, active, scope_ref
    from consent_current where student_account_id in ${tx(subjectIds)}
  `)
```

Note this one reads `subjectIds` (the actor plus their guardianed children) — the RLS policy's `guardianed_children` clause covers that, since `accountId = effectiveAccountId` (the guardian) matches `rls_guardianed_children(rls_current_account())` for each child row.

- [ ] **Step 4: Run to confirm it passes**

Run: `npm run test --workspace=@curiolab/http -- context-rls.test.ts`
Expected: PASS.

Run the FULL http suite to confirm nothing regressed (curiolab_app still bypasses RLS, so behavior against the normal harness connection must be byte-identical):

Run: `npm run test --workspace=@curiolab/http`
Expected: PASS, same test count as before this task.

- [ ] **Step 5: Commit**

```bash
git add packages/http/src/context.ts packages/http/test/context-rls.test.ts
git commit -m "feat(rls): wire resolveAuthContext's membership/guardianship/consent_current reads through withRlsContext"
```

---

### Task 5: convert `login`'s membership check

**Files:**
- Modify: `packages/http/src/controllers/auth.ts:131` (the `requiresTwoFactor` role-check query, inside `login`)
- Test: `packages/http/test/totp-auth-rls.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

```ts
// packages/http/test/totp-auth-rls.test.ts
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { hashPassword } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { rlsConnection } from '../../runtime/test/helpers/rls-proof.js'
import { makeChapter } from './helpers/fixtures.js'
import { login } from '../src/index.js'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

describe('login role-check against curiolab_rls', () => {
  test('a chapter_director still gets totpRequired (their own role IS visible under RLS)', async () => {
    const chapter = await makeChapter(h.sql)
    const hash = await hashPassword('correct horse battery staple')
    const email = 'director-rls@example.test'
    const [row] = await h.sql`
      insert into account (email, legal_name, display_name, date_of_birth, dob_provenance, credential_owner, status, maturation_state, password_hash)
      values (${email}, 'Director Testperson', 'Director T.', '1980-01-01', 'staff_entered', 'self_private', 'active', 'self_managed', ${hash})
      returning id
    `
    await h.sql`insert into membership (account_id, chapter_id, role, status) values (${row!.id}, ${chapter}, 'chapter_director', 'active')`

    const rls = rlsConnection(h)
    const res = await login({ sql: rls, body: { identifier: email, password: 'correct horse battery staple' } })
    expect(res.body).toMatchObject({ totpEnrollmentRequired: true })
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test --workspace=@curiolab/http -- totp-auth-rls.test.ts`
Expected: FAIL — the role query returns zero rows under RLS (no GUC set yet), so `requiresTwoFactor([])` is `false` and the account incorrectly falls through to the password-only session-mint branch instead of `totpEnrollmentRequired`.

- [ ] **Step 3: Convert the query**

In `packages/http/src/controllers/auth.ts`, add `withRlsContext` to the existing runtime import, then change:

```ts
    const roleRows = await input.sql`
      select distinct role from membership where account_id = ${accountId}
    `
```

to:

```ts
    const roleRows = await withRlsContext(input.sql, { accountId }, (tx) => tx`
      select distinct role from membership where account_id = ${accountId}
    `)
```

- [ ] **Step 4: Run to confirm it passes, plus the full http suite**

Run: `npm run test --workspace=@curiolab/http -- totp-auth-rls.test.ts`
Expected: PASS.

Run: `npm run test --workspace=@curiolab/http`
Expected: PASS, unchanged count otherwise.

- [ ] **Step 5: Commit**

```bash
git add packages/http/src/controllers/auth.ts packages/http/test/totp-auth-rls.test.ts
git commit -m "feat(rls): wire login's requiresTwoFactor role check through withRlsContext"
```

---

### Task 6: write (but do not apply) the final migration

**Files:**
- Create: `packages/db/migrations/0042_curiolab_app_rls_enforced.sql`
- Test: none — this migration is not run against any shared database until Task 39 clears. Do NOT run `npm run db:migrate` against any long-lived dev database after creating this file; `embedded-postgres`-backed test harnesses apply every migration fresh per run regardless, which is fine and expected — see the note below.

- [ ] **Step 1: Write the migration file**

```sql
-- =========================================================================
-- 0042_curiolab_app_rls_enforced.sql — THE FLIP. Do not run this against any
-- real environment (dev, staging, or production) until every task in
-- docs/superpowers/plans/2026-07-26-rls-live-path-wiring.md through Task 39
-- is complete and its Task 39 full-suite-against-curiolab_rls gate has
-- passed. Once this runs against a database, EVERY query against
-- membership/consent/consent_current/enrollment_record/guardianship/
-- audit_entry issued by the app's normal connection (curiolab_app) that is
-- NOT wrapped in withRlsContext will silently return zero rows (fail
-- -closed) rather than erroring — so an unconverted call site does not
-- crash, it just breaks, quietly, in whatever way "this list is always
-- empty" breaks a feature. That is exactly why the gate exists.
--
-- Embedded-Postgres test harnesses apply this migration on every run
-- regardless (packages/db/test/helpers/global-pg.ts applies ALL migration
-- files to a fresh database every time) — that's fine and unavoidable; it's
-- exactly what makes each task's "run the full suite, confirm unchanged"
-- step a meaningful proof throughout Phases 1-4: curiolab_app is BYPASSRLS
-- until this file exists is irrelevant to the test harness, since the
-- harness's default connection is the cluster OWNER (superuser), which
-- bypasses RLS inherently regardless of any role's BYPASSRLS flag
-- (0018_rls.sql:20). Only a REAL environment's curiolab_app connection is
-- affected, and only once this migration is actually applied there.
-- =========================================================================

ALTER ROLE curiolab_app NO BYPASSRLS;
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/migrations/0042_curiolab_app_rls_enforced.sql
git commit -m "chore(rls): write (do not apply) the migration that strips BYPASSRLS from curiolab_app"
```

**STOP. Before Task 7:** confirm the full test suite (`npm run test --workspaces`) still passes with this file present. It will — the embedded-Postgres harness connects as the cluster owner, which bypasses RLS regardless of any role flag, so this migration existing changes nothing about test behavior. This is exactly the property Phases 1-4 depend on to be safe to do incrementally.

---

## Phase 1: system/sweep/bootstrap paths (Bucket B) — Tasks 7-11

These five are lower actor-complexity (no `AuthContext` to derive from) and a good place to build confidence in the pattern before the larger Phase 2 batch. Each uses `SYSTEM_RLS_CONTEXT` from Task 1.

### Task 7: `time-box-sweep.ts`

**Files:**
- Modify: `packages/app/src/time-box-sweep.ts:76-107` (the whole body of `runTimeBoxSweep`, currently one `sql.begin(async (tx) => {...})` block)
- Test: `packages/app/test/time-box-sweep-rls.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/test/time-box-sweep-rls.test.ts
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import { startHarness, type Harness } from './helpers/pg.js'
import { rlsConnection } from '../../runtime/test/helpers/rls-proof.js'
import { makeChapter, makeAdult, makeMembership, makeTerm } from './helpers/fixtures.js'
import { runTimeBoxSweep } from '../src/time-box-sweep.js'

let h: Harness
beforeAll(async () => { h = await startHarness() }, 240_000)
afterAll(async () => { await h?.end() })

describe('runTimeBoxSweep against curiolab_rls', () => {
  test('flips an ended-term mentor to inactive (proves the sweep can see + write under RLS)', async () => {
    const chapter = await makeChapter(h.sql)
    const term = await makeTerm(h.sql, chapter)
    await h.sql`update term set ends_on = '2020-01-01' where id = ${term}`
    const mentor = await makeAdult(h.sql)
    const membershipId = await makeMembership(h.sql, mentor, chapter, { role: 'junior_mentor_adult', status: 'active' })
    await h.sql`update membership set term_id = ${term} where id = ${membershipId}`

    const rls = rlsConnection(h)
    const now = new Date('2026-01-01T00:00:00Z')
    const result = await runTimeBoxSweep({ sql: rls }, now)
    expect(result.revokedMembershipIds).toContain(membershipId)

    const [row] = await h.sql`select status from membership where id = ${membershipId}`
    expect(row!.status).toBe('inactive')
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test --workspace=@curiolab/app -- time-box-sweep-rls.test.ts`
Expected: FAIL — the sweep's target-selection query returns zero rows under RLS (no GUC set), so `revokedMembershipIds` is empty.

- [ ] **Step 3: Convert `runTimeBoxSweep`**

In `packages/app/src/time-box-sweep.ts`, add the import:

```ts
import { withRlsContext, SYSTEM_RLS_CONTEXT, writeAudit, writeAccessLedger } from '@curiolab/runtime'
```

Change the function's opening from:

```ts
export async function runTimeBoxSweep({ sql }: { sql: Sql }, now: Date): Promise<TimeBoxSweepResult> {
  return sql.begin(async (tx) => {
```

to:

```ts
export async function runTimeBoxSweep({ sql }: { sql: Sql }, now: Date): Promise<TimeBoxSweepResult> {
  return withRlsContext(sql, SYSTEM_RLS_CONTEXT, async (tx) => {
```

Every reference to `tx` inside the function body (the `SELECT ... FOR UPDATE` target query, the two `UPDATE membership` statements, the `writeAudit(tx, ...)` call) is already using `tx`, not `sql` — this is a body-preserving swap; no other line in the function changes. Confirm no other call site in the file references the outer `sql` parameter directly.

- [ ] **Step 4: Run to confirm it passes, plus the full app suite**

Run: `npm run test --workspace=@curiolab/app -- time-box-sweep-rls.test.ts`
Expected: PASS.

Run: `npm run test --workspace=@curiolab/app -- time-box-sweep.test.ts`
Expected: PASS, unchanged (this is the pre-existing test file, still running against the harness's owner connection via `h.sql` — proves the swap didn't change behavior for the normal path).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/time-box-sweep.ts packages/app/test/time-box-sweep-rls.test.ts
git commit -m "feat(rls): wire runTimeBoxSweep through withRlsContext (SYSTEM_RLS_CONTEXT)"
```

---

### Task 8: `eligibility-sweep.ts`

**Files:**
- Modify: `packages/app/src/eligibility-sweep.ts:84-117` (the whole body of `runEligibilitySweep`, same one-transaction shape as Task 7)
- Test: `packages/app/test/eligibility-sweep-rls.test.ts` (new file, mirrors Task 7's test exactly against this sweep's own fixtures — reuse `packages/app/test/mentor-eligibility.test.ts`'s existing sweep-setup helper if one exists; otherwise seed directly as in Task 7)

- [ ] **Step 1-2: Write + confirm-fails** the same shape as Task 7, targeting `runEligibilitySweep`'s `revokedMembershipIds`.

- [ ] **Step 3: Convert** — identical swap: `sql.begin(async (tx) => {` → `withRlsContext(sql, SYSTEM_RLS_CONTEXT, async (tx) => {`, import `withRlsContext, SYSTEM_RLS_CONTEXT` from `@curiolab/runtime` alongside whatever runtime imports the file already has.

- [ ] **Step 4: Run to confirm** both the new RLS test and the pre-existing `eligibility-sweep.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/eligibility-sweep.ts packages/app/test/eligibility-sweep-rls.test.ts
git commit -m "feat(rls): wire runEligibilitySweep through withRlsContext (SYSTEM_RLS_CONTEXT)"
```

---

### Task 9: `retention-sweep.ts`

**Files:**
- Modify: `packages/app/src/retention-sweep.ts:72` (`sweepExpiredLeads`'s `writeAudit` call — this one writes ONLY `audit_entry`, no membership/consent/etc. read)
- Test: `packages/app/test/retention-sweep-rls.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

```ts
import { rlsConnection } from '../../runtime/test/helpers/rls-proof.js'
// ... (mirror the existing retention-sweep.test.ts fixture setup for an expired lead)
test('sweepExpiredLeads writes its audit_entry row under RLS', async () => {
  const rls = rlsConnection(h)
  await sweepExpiredLeads({ sql: rls }, now)
  const rows = await h.sql`select action from audit_entry where subject_type = 'application_lead'`
  expect(rows.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run to confirm it fails** — `permission denied` or the insert silently violates the RLS `WITH CHECK` (the same `USING` clause governs writes for a `FOR ALL` policy), since no GUC is set.

- [ ] **Step 3: Convert.** Find `sweepExpiredLeads`'s existing transaction wrapper (likely already `sql.begin(...)` around the delete + audit write) and swap it exactly as in Task 7, `SYSTEM_RLS_CONTEXT`. If the function does NOT already open its own transaction (the audit write might be the only DB call needing one), wrap just that call: `await withRlsContext(sql, SYSTEM_RLS_CONTEXT, (tx) => writeAudit(tx, {...}))`.

- [ ] **Step 4: Run to confirm** the new test and `retention-sweep.test.ts` both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/retention-sweep.ts packages/app/test/retention-sweep-rls.test.ts
git commit -m "feat(rls): wire sweepExpiredLeads's audit_entry write through withRlsContext"
```

---

### Task 10: `maturation.ts` — `sweepMaturationBackstop` only

**Files:**
- Modify: `packages/app/src/maturation.ts:314-332` (`sweepMaturationBackstop`'s guardianship UPDATE + the 30-day-notice SELECT — the only Bucket-B touches in this file; the rest of `maturation.ts`'s functions are actor-driven and belong to Task 22)
- Test: `packages/app/test/maturation-sweep-rls.test.ts` (new file)

- [ ] **Steps 1-5:** same shape as Task 7, scoped to just `sweepMaturationBackstop`. Proof: seed a guardianship edge past its 90-day backstop, run the sweep against `rlsConnection(h)`, assert `status = 'lapsed'` afterward. Convert only this function's transaction wrapper — `confirmMaturation`, `reissueSetup`, `assistRecovery`, `privatizeCredential` in the same file are Task 22, not this task, because they each take a real `ctx: AuthContext` and belong to Bucket A.

```bash
git add packages/app/src/maturation.ts packages/app/test/maturation-sweep-rls.test.ts
git commit -m "feat(rls): wire sweepMaturationBackstop through withRlsContext (SYSTEM_RLS_CONTEXT)"
```

---

### Task 11: `bootstrap-admin.ts`

**Files:**
- Modify: `packages/app/src/bootstrap-admin.ts:89` (the `platform_admin` existence guard SELECT) and `:133` (the membership INSERT inside the creation transaction)
- Test: `packages/app/test/bootstrap-admin-rls.test.ts` (new file)

This is the one legitimate account with no inviter — by definition there is no `ctx` yet. Use `SYSTEM_RLS_CONTEXT`.

- [ ] **Step 1: Write the failing test**

```ts
import { rlsConnection } from '../../runtime/test/helpers/rls-proof.js'
test('bootstrapPlatformAdmin works end to end against curiolab_rls', async () => {
  const rls = rlsConnection(h)
  const res = await bootstrapPlatformAdmin(rls, { legalName: 'Ada Founder', email: 'founder-rls@acuriolab.org', password: 'a-long-operator-set-passphrase' })
  expect(res.created).toBe(true)
  const mems = await h.sql`select role from membership where account_id = ${res.adminAccountId!}`
  expect(mems).toHaveLength(1)
})
```

Use a fresh, isolated harness for this file (mirrors `bootstrap-admin-nonempty-guard.test.ts`'s reasoning — GUARD 2 needs an empty database).

- [ ] **Step 2: Run to confirm it fails** — the existing-admin guard SELECT returns zero rows under RLS regardless of whether an admin exists (harmless false-negative on the guard itself, since the DB IS actually empty in this test), but the membership INSERT inside the creation transaction is what actually fails the RLS `WITH CHECK`.

- [ ] **Step 3: Convert.** Import `withRlsContext, SYSTEM_RLS_CONTEXT` from `@curiolab/runtime`. Wrap the guard SELECT:

```ts
  const [existing] = await withRlsContext(sql, SYSTEM_RLS_CONTEXT, (tx) => tx`
    select account_id from membership where role = 'platform_admin' limit 1
  `)
```

and change the creation transaction's `sql.begin(async (tx) => {` to `withRlsContext(sql, SYSTEM_RLS_CONTEXT, async (tx) => {` (the `account` INSERT inside it is unaffected since `account` isn't RLS-protected; the `membership` INSERT is what needed this).

- [ ] **Step 4: Run to confirm** the new test passes, plus both existing bootstrap-admin test files (`bootstrap-admin.test.ts`, `bootstrap-admin-nonempty-guard.test.ts`) still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/bootstrap-admin.ts packages/app/test/bootstrap-admin-rls.test.ts
git commit -m "feat(rls): wire bootstrapPlatformAdmin through withRlsContext (SYSTEM_RLS_CONTEXT)"
```

---

## Phase 2: actor-driven services (Bucket A) — Tasks 12-37

Every task in this phase follows the **identical** five-step shape (write an RLS proof test seeding two actors/chapters and asserting cross-boundary isolation → confirm it fails → swap `sql.begin(async (tx) =>` for `withRlsContext(sql, rlsContextFromAuth(ctx), async (tx) =>` and any bare `await sql\`...\`` read for `await withRlsContext(sql, rlsContextFromAuth(ctx), (tx) => tx\`...\`)` → confirm the new test AND the file's existing test suite both pass → commit). Rather than repeat that scaffold 26 times verbatim, each task below states **only what's specific to that file**: its exact touch points (from the full audit), the one-line import to add, and the proof-test scenario to use. Apply the Task 7 shape to fill in the rest.

**Shared proof-test scenario for this phase** (use unless a task says otherwise): seed two chapters (A, B) with one student each, run the function once authenticated as the actor with `accountId = <a director or the student themself in chapter A>`, and assert the result set/effect includes chapter A's row and excludes chapter B's.

### Task 12: `account-info.ts`
- **Touch points:** `updateAccount` (audit writes at 306, 319, 339 — all three already inside the function's existing transaction(s); wrap each transaction, not each writeAudit call individually), `studentParentAnswers:359` (bare select on `enrollment_record`), `firstGuardian:372` (bare select on `guardianship`, **[EXPOSED]** — returns guardian name/email, so this one's proof test should assert a DIFFERENT student's guardian is never returned).
- **Import:** `withRlsContext, rlsContextFromAuth` from `@curiolab/runtime`.
- **Commit:** `git commit -m "feat(rls): wire account-info.ts through withRlsContext"`

### Task 13: `application-form.ts`
- **Touch points:** the form-upsert method's `writeAudit` at line 465 — wrap its existing transaction.
- **Commit:** `git commit -m "feat(rls): wire application-form.ts through withRlsContext"`

### Task 14: `attendance.ts`
- **Touch points:** `loadChild:209` (bare select on `membership`), `writeRevision:345` (private, `writeAudit` — wrap its transaction).
- **Commit:** `git commit -m "feat(rls): wire attendance.ts through withRlsContext"`

### Task 15: `calendar.ts`
- **Touch points:** `writeRevision:284` (private, `writeAudit`), `listGuardianCalendar:493` (bare select on `membership`, distinct chapter_id — **[EXPOSED]**: this resolves which chapters' events a guardian sees, so the proof test must confirm a guardian never sees a non-guardianed chapter's events after this wrap).
- **Commit:** `git commit -m "feat(rls): wire calendar.ts through withRlsContext"`

### Task 16: `consent.ts`
- **Touch points:** `loadAnchor:126` (private, select `enrollment_record`), `grantConsent:192` (insert `consent`, in tx), `revokeConsent:251` (insert `consent`, in tx), `loadChapter:276` (private, select `enrollment_record`), `revokeSafeguarding:338` (insert `consent` ×2, in tx). Four separate transactions/reads in this file — convert each independently, but they share one `rlsContextFromAuth(ctx)` derivation per call (the file already threads `ctx` through each public method).
- **Commit:** `git commit -m "feat(rls): wire consent.ts through withRlsContext"`

### Task 17: `consent-grant.ts`
- **Touch points:** `publicationGrantRevokeCascade:193` (select `membership`, subquery scoping a `project` update — `project` itself isn't RLS-protected, only wrap the `membership` subquery's containing transaction), `viewChildPublicItems:507` (join on `membership`).
- **Note:** this file is the `consent_grant` ledger (migration 0024), a DIFFERENT table from base `consent` — don't confuse the two when reviewing this diff.
- **Commit:** `git commit -m "feat(rls): wire consent-grant.ts's membership touches through withRlsContext"`

### Task 18: `deletion-fulfillment.ts`
- **Touch points:** `resolveChapter:154` (private, select `enrollment_record`), `fulfillDeletion:277` (writeAudit, in tx), `terminateParticipation:317` (private, update `membership`), `eraseChildData:380/384` (select + update `membership`), `eraseChildData:370` (update `enrollment_record`). `terminateParticipation` and `eraseChildData` are almost certainly already inside `fulfillDeletion`'s outer transaction — confirm by reading the file before assuming three separate wraps; if nested, only the outermost `sql.begin` needs converting and the inner private methods should take `tx` (already the pattern, per the naming) rather than opening their own.
- **Commit:** `git commit -m "feat(rls): wire deletion-fulfillment.ts through withRlsContext"`

### Task 19: `dm-oversight.ts`
- **Touch points:** `dmOversightReport:410` (select `membership`, EXISTS/aggregate), `resolveChapter:545` (private, select `membership`), `acknowledge:597` (select `membership`, EXISTS).
- **Note:** this file is entirely dark behind `MENTOR_DM_ENABLED=false` — still convert it (the plan's promise is "the only path," not "the only path for enabled features"), but it's safe to sequence this task LAST within Phase 2 if time-boxing the rollout, since nothing in production exercises it today.
- **Commit:** `git commit -m "feat(rls): wire dm-oversight.ts through withRlsContext"`

### Task 20: `dm-participant.ts`
- **Touch points:** `listThreads:173` (join `membership`, **[EXPOSED]** — thread rows returned), `acknowledgeOnboarding:249` (select `membership`), `assertVerifiedGuardian:385` (private, select `guardianship`).
- **Note:** also dark behind `MENTOR_DM_ENABLED`; same sequencing note as Task 19.
- **Commit:** `git commit -m "feat(rls): wire dm-participant.ts through withRlsContext"`

### Task 21: `dob-correction.ts`
- **Touch points:** `correct:92/125/131` — one function, select `enrollment_record` + update `enrollment_record` + writeAudit, all in one existing transaction. Single wrap.
- **Commit:** `git commit -m "feat(rls): wire dob-correction.ts through withRlsContext"`

### Task 22: `enrollment.ts`
- **Touch points:** `createEnrollment:174/226/231/246` — insert `enrollment_record`, update `enrollment_record`, insert `membership`, insert `consent` (loop) — all one existing transaction. Single wrap. **Note:** this function runs at Stage-2 submission time, which may be actor-less (parent-token-gated, not a logged-in session) — check whether `createEnrollment` currently receives a `ctx: AuthContext` or a raw actor id. If it's token-gated with no session, use `SYSTEM_RLS_CONTEXT` (Bucket B) instead of `rlsContextFromAuth`, matching the reasoning in "Why this plan looks the way it does," §2.
- **Commit:** `git commit -m "feat(rls): wire enrollment.ts's createEnrollment through withRlsContext"`

### Task 23: `export-fulfillment.ts`
- **Touch points:** `fulfillExport:106` (select `enrollment_record`), `fulfillExport:130` (writeAudit, in tx), `assembleBundle:152/158` (private, in the same tx — select `membership` **[EXPOSED]**, join `membership` for tier history **[EXPOSED]**). One outer transaction; `assembleBundle` should take the already-open `tx`.
- **Commit:** `git commit -m "feat(rls): wire export-fulfillment.ts through withRlsContext"`

### Task 24: `feed.ts`
- **Touch points:** `resolveAuthorMembership:170` (module fn, select `membership`), `loadPost:304` (private, join `membership`), `edit:365` (writeAudit — `permission.denied`, likely its own small transaction), the feed-list method `:871` (join `membership`, **[EXPOSED-derived]** author pod/is-minor on returned items). Four separate touch points across likely-different call paths — confirm which share a transaction vs. need independent wraps by reading the file; don't assume.
- **Commit:** `git commit -m "feat(rls): wire feed.ts through withRlsContext"`

### Task 25: `guardian-portal.ts`
- **Touch points:** `loadSubject:165/170/175` (private, three selects: `membership` ×2 subqueries + `enrollment_record`), `composeChildRecord:227` (private, in an authz read seam, select `membership`, **[EXPOSED]**), `pickMinorChild:392` (private, select `membership` subquery).
- **Commit:** `git commit -m "feat(rls): wire guardian-portal.ts through withRlsContext"`

### Task 26: `guardianship.ts`
- **Touch points:** `verifyGuardianship:131/135/180/197` (select `guardianship` join `enrollment_record` lateral, then update `guardianship` ×2 branches — one transaction, two possible outcomes), `revokeGuardianship:239/241/277/285` (same shape: two selects then an update then writeAudit).
- **Commit:** `git commit -m "feat(rls): wire guardianship.ts through withRlsContext"`

### Task 27: `invite.ts`
- **Touch points:** `resendInvite:385` (join `enrollment_record` — actor-driven, staff issuing a resend, Bucket A), `validateInvite:440` (join `enrollment_record` — **token-gated, no session, Bucket B**), `acceptInvite:476/577/626/635` (join `enrollment_record`, insert `membership`, select `enrollment_record`, insert `guardianship` — **token-gated, Bucket B**), `assertGuardianEmailMatches:713` (private, join `enrollment_record` — inherits caller's bucket), `enrollmentStudent:728` (private, select `enrollment_record` — inherits caller's bucket), `assertStudentGuardianGate:782` (exported fn, select `guardianship` — check callers; likely Bucket A since it's invoked from an authenticated guardian-portal path, not the token-gated accept flow).
- **This file has the most mixed-bucket touch points in the plan** — read each function's signature carefully before choosing `rlsContextFromAuth(ctx)` vs `SYSTEM_RLS_CONTEXT`; don't default to one for the whole file.
- **Commit:** `git commit -m "feat(rls): wire invite.ts through withRlsContext (mixed Bucket A/B per function)"`

### Task 28: `maturation.ts` — remaining functions
- **Touch points:** `confirmMaturation:231/265/278` (select `enrollment_record`, update `guardianship`, writeAudit — actor-driven, Bucket A), `reissueSetup:368/383/405` (select `enrollment_record`, select `membership` count, writeAudit — `account.recover`-gated, Bucket A), `assistRecovery:443/486` (select `enrollment_record`, writeAudit — Bucket A), `privatizeCredential:576/589/594/621` (select `enrollment_record`, select `guardianship` EXISTS, select `membership` EXISTS, writeAudit — self-session + witness, Bucket A using the STUDENT's own ctx). `sweepMaturationBackstop` was already handled in Task 10 — don't re-touch it here.
- **Commit:** `git commit -m "feat(rls): wire maturation.ts's actor-driven functions through withRlsContext"`

### Task 29: `membership-activation.ts`
- **Touch points:** `activateStudent:115/120/172` — select `enrollment_record`, select `membership` join `account`, update `membership` — one existing transaction.
- **Commit:** `git commit -m "feat(rls): wire membership-activation.ts through withRlsContext"`

### Task 30: `mentor-dm.ts`
- **Touch points:** nine (see the full audit: `assign:143/154/166`, `enable:271`, `assignedPodIds:407`, `studentCurrentPod:418`, `isPartyToThread:496/502/507`, `sendMessage:598`, `notifyDmRecipients:745`, `exportThread:832`, `readThread:892`). All actor-driven (Bucket A) except none are token-gated. **This file is entirely dark behind `MENTOR_DM_ENABLED=false`** — lowest production risk in the whole plan, sequence it last if time-boxing.
- **Commit:** `git commit -m "feat(rls): wire mentor-dm.ts through withRlsContext"`

### Task 31: `mentor-eligibility.ts`
- **Touch points:** `loadMembership:171` (private, select `membership`), `record:215` (writeAudit, in tx).
- **Commit:** `git commit -m "feat(rls): wire mentor-eligibility.ts through withRlsContext"`

### Task 32: `messaging.ts`
- **Touch points:** `loadEligibleChildren:228` (private, select `membership` join `account`, **[EXPOSED]** — returns `guardianOf` children), `writeMessage:284` (private, writeAudit, in tx), `notifyStaffOfGuardianMessage:598` (private, select `membership` join `account` for notify recipients).
- **Commit:** `git commit -m "feat(rls): wire messaging.ts through withRlsContext"`

### Task 33: `moderation.ts`
- **Touch points:** `resolveResolverMembership:183` (module fn, select `membership`), `resolveEscalationTarget:203/209` (module fn, select `membership` ×2 branches — platform_admin target, chapter_director target).
- **Commit:** `git commit -m "feat(rls): wire moderation.ts through withRlsContext"`

### Task 34: `ops-read.ts` — the highest-`[EXPOSED]`-density file in the plan
- **Touch points:** eight listing/dashboard functions, ALL staff-facing reads returning rows directly to the director/admin portal: `listInvites:631/633`, `listMemberships:671` (**[EXPOSED]** the roster), `listGuardianships:705/709` (**[EXPOSED]** the name-match surface), `listDeletionRequests:792`, `listExportRequests:821`, `listEnrollments:851` (**[EXPOSED]** the enrollment list), `listPods:887` (**[EXPOSED-derived]** mentor names), `dashboard:945/947/960/962/979/990/998` (seven touch points in one aggregate function).
- **Proof test priority:** this file's proof tests are the highest-value in the whole plan — for EACH listing function, seed chapter A and chapter B data and assert a chapter-A-scoped director's result set contains zero chapter-B rows. Don't skip any of the eight for time; if sequencing under a deadline, do this file before Tasks 19/20/30 (the dark DM files).
- **Commit:** `git commit -m "feat(rls): wire ops-read.ts through withRlsContext (8 listing functions)"`

### Task 35: `profile.ts`
- **Touch points:** `loadSubject:182/187` (private, select `membership` ×2 subqueries), `compose:233/242` (private, in an authz read seam, select `membership` **[EXPOSED]**, join `membership` for projects), `resolveChapter:403` (private, select `membership`).
- **Commit:** `git commit -m "feat(rls): wire profile.ts through withRlsContext"`

### Task 36: `project.ts` and `media.ts` (one task, small files)
- **Touch points:** `project.ts:145` (`load`, private, join `membership`), `media.ts:156/174` (`loadProject`/`loadMediaProject`, private, join `membership`).
- **Commit:** `git commit -m "feat(rls): wire project.ts and media.ts through withRlsContext"`

### Task 37: `student-notification.ts`
- **Touch points:** `resolveStudentNotificationTargets:76` — select `guardianship` join `account`, **[EXPOSED]** returns guardian notification emails.
- **Commit:** `git commit -m "feat(rls): wire student-notification.ts through withRlsContext"`

---

## Phase 3: public/token-gated edge cases (Bucket B, but justify each in the diff's comment)

### Task 38: `verification.ts` and `student-setup.ts`
- **Touch points:** `verification.ts:composeRecord:183/190` (select `membership` current_tier — **PUBLIC**, **[EXPOSED]** on the public verification page; select `membership` join for public projects). `student-setup.ts:provisionSetupCredential:120` (select `enrollment_record` — token-gated).
- **Design note to put in the code comment at each site:** "PUBLIC/token-gated by design — the `public_profile`/`external_publication` consent check (or the single-use token match) already ran before this point and is what actually authorizes showing this data; `isPlatform: true` here is RLS declining to re-implement that check, not a bypass of it."
- **Commit:** `git commit -m "feat(rls): wire verification.ts and student-setup.ts through withRlsContext (SYSTEM_RLS_CONTEXT, public/token-gated by design)"`

### Task 39: `packages/http/src/controllers/public-reads.ts` and `audit.ts`
- **Touch points:** `public-reads.ts:listPublicProjects:45/viewPublicProject:79` (join `membership`, PUBLIC, same reasoning as Task 38). `audit.ts:readOpsAudit:112/117` (select + writeAudit on `audit_entry`, chapter-scoped, Bucket A — this one uses `rlsContextFromAuth(ctx)`, NOT `SYSTEM_RLS_CONTEXT`, since it's a staff-authenticated read, not public), `audit.ts:readAdminAudit:240/246/251` (select ×2 + writeAudit — platform-only via `authorize()` already, so `rlsContextFromAuth(ctx)` naturally resolves `isPlatform: true` for the actor and the unfiltered global read at line 246 works correctly without any special-casing).
- **Commit:** `git commit -m "feat(rls): wire public-reads.ts and audit.ts controllers through withRlsContext"`

---

## Phase 4: the gate

### Task 40: full-suite proof against `curiolab_rls`, then apply Task 6's migration to staging

**Files:** none modified — this is a verification + ops task.

- [ ] **Step 1:** Confirm every task's individual RLS-proof test file passes: `npm run test --workspaces` (all proof tests + all pre-existing tests, since Phase 0-3 never touched the harness's default owner-connection behavior).

- [ ] **Step 2:** Write one final cross-cutting smoke test that authenticates as `curiolab_rls` for an entire realistic multi-step flow (e.g., director lists memberships → verifies a guardianship → activates a student), asserting it completes successfully end-to-end and that a second, unrelated chapter's data never appears in any intermediate result. This is the test that would have caught a missed file.

- [ ] **Step 3:** In a **staging environment only** (never production first), run `npm run db:migrate` with `packages/db/migrations/0042_curiolab_app_rls_enforced.sql` present. Immediately run the full manual smoke checklist from `docs/platform/deploy.md`'s "Staging deploy, migrations, RLS verification" section (login, guardian portal, director ops portal, at minimum) against staging with the app connected as `curiolab_app`.

- [ ] **Step 4:** If staging is clean for a full week of real usage (or a deliberately time-boxed soak period — set this with the founder, not unilaterally), apply the same migration to production during a maintenance window, with the same manual smoke checklist immediately after.

- [ ] **Step 5:** Update `docs/platform/deploy.md`'s final-gate section to move "Mechanism B (RLS) wired onto the live path" from the technical-prerequisites list into "done," and update `docs/platform/BUILD-STATUS.md`'s "Deferred go-live wiring" section to remove the RLS line item.

```bash
git add docs/platform/deploy.md docs/platform/BUILD-STATUS.md
git commit -m "docs: RLS is live on the app path as of migration 0042 in production"
```

---

## Self-review

**Spec coverage:** every touch point from the exhaustive audit (Tasks 1-39) is assigned to a task; the two architectural gaps found during investigation (`consent_current` unprotected, `curiolab_rls` under-granted) each have a dedicated task/decision rather than being silently absorbed. The final flip (Task 40) is sequenced last and gated on the full suite passing under `curiolab_rls`, not assumed.

**Placeholder scan:** every task names exact files and line numbers from the live audit; the Phase 2 tasks compress the repeated five-step TDD scaffold into prose (explicitly pointing back to Task 7's full worked example) rather than dropping content — each still names its specific touch points, specific import, and specific commit message, which is the part that actually varies per file.

**Type consistency:** `rlsContextFromAuth(ctx: AuthContext): RlsContext` (Task 1) is the one function every Bucket-A task calls; `SYSTEM_RLS_CONTEXT: RlsContext` (Task 1) is the one constant every Bucket-B task uses. No task invents a third shape.
