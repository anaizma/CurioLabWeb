// -------------------------------------------------------------------------
// Admin/Director backend P2 — invite kinds (director/admin) + per-kind issuing
// authority + two-person director approval + token hardening (§1, §4, §12).
// Embedded Postgres, synthetic data only.
//
//   * per-kind authority: a platform_admin may issue admin/director/mentor/
//     guardian/staff; a lone director may issue mentor/guardian/staff but NOT
//     admin and NOT director-direct; student is never issuable here.
//   * the two-person director flow mints a token only after a SECOND, DISTINCT
//     director approves; the same director twice is refused.
//   * redemption binding: a token whose bound email/kind/chapter does not match
//     the acceptance context is refused (opaque invalid_token).
//   * per-kind expiries (adult 72h, guardian 7d) refuse an expired token.
//   * per-issuer rate limit trips after the cap.
//   * the token string carries no email/name (opaque random).
// -------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Forbidden, authorize, withRequest } from '@curiolab/runtime'
import { startHarness, type Harness } from './helpers/pg.js'
import { makeAdult, makeChapter } from './helpers/fixtures.js'
import { baseCtx, mem } from './helpers/ctx.js'
import {
  InviteService,
  InviteKindNotIssuableError,
  InviteRateLimitError,
  DirectorInviteSameApproverError,
  InvalidInviteError,
  INVITE_ADULT_TTL_MS,
  INVITE_GUARDIAN_TTL_MS,
} from '../src/index.js'

let h: Harness

beforeAll(async () => {
  h = await startHarness()
}, 240_000)

afterAll(async () => {
  await h?.end()
})

function svc(config?: Record<string, unknown>) {
  return new InviteService({ sql: h.sql, authorize, config })
}
const adminCtx = (id: string, chapter: string) =>
  baseCtx(id, new Date(), [mem('platform_admin', chapter)])
const directorCtx = (id: string, chapter: string) =>
  baseCtx(id, new Date(), [mem('chapter_director', chapter)])

async function setup() {
  const chapter = await makeChapter(h.sql)
  const director = await makeAdult(h.sql)
  const director2 = await makeAdult(h.sql)
  const admin = await makeAdult(h.sql)
  return { chapter, director, director2, admin }
}

async function issue(
  ctxOwner: ReturnType<typeof baseCtx>,
  input: { kind: string; chapterId: string; targetEmail?: string },
) {
  let out!: Awaited<ReturnType<InviteService['issueInvite']>>
  await withRequest(async () => {
    out = await svc().issueInvite(input as never, ctxOwner)
  })
  return out
}

const email = () => `adult-${randomUUID().slice(0, 8)}@example.test`

// ===========================================================================
describe('per-kind issuing authority', () => {
  test('a platform_admin may issue admin, director, mentor, guardian(-shaped), staff', async () => {
    const f = await setup()
    const ctx = adminCtx(f.admin, f.chapter)
    for (const kind of ['admin', 'director', 'mentor', 'staff'] as const) {
      const out = await issue(ctx, { kind, chapterId: f.chapter, targetEmail: email() })
      const [row] = await h.sql`select kind, bound_chapter_id from invite where id = ${out.inviteId}`
      expect(row!.kind).toBe(kind)
      expect(row!.bound_chapter_id).toBe(f.chapter)
    }
  })

  test('a lone director may issue mentor and staff', async () => {
    const f = await setup()
    const ctx = directorCtx(f.director, f.chapter)
    for (const kind of ['mentor', 'staff'] as const) {
      const out = await issue(ctx, { kind, chapterId: f.chapter, targetEmail: email() })
      const [row] = await h.sql`select kind from invite where id = ${out.inviteId}`
      expect(row!.kind).toBe(kind)
    }
  })

  test('a lone director may NOT issue an admin invite (opaque Forbidden, no invite)', async () => {
    const f = await setup()
    const ctx = directorCtx(f.director, f.chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().issueInvite({ kind: 'admin', chapterId: f.chapter, targetEmail: email() }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const [cnt] = await h.sql`select count(*)::int as n from invite where kind = 'admin' and bound_chapter_id = ${f.chapter}`
    expect(cnt!.n).toBe(0)
  })

  test('a lone director may NOT mint a director invite directly (opaque Forbidden)', async () => {
    const f = await setup()
    const ctx = directorCtx(f.director, f.chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().issueInvite({ kind: 'director', chapterId: f.chapter, targetEmail: email() }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
    const [cnt] = await h.sql`select count(*)::int as n from invite where kind = 'director' and bound_chapter_id = ${f.chapter}`
    expect(cnt!.n).toBe(0)
  })

  test('student is never issuable through the ops endpoint', async () => {
    const f = await setup()
    const ctx = adminCtx(f.admin, f.chapter)
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().issueInvite({ kind: 'student', chapterId: f.chapter }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(InviteKindNotIssuableError)
  })
})

// ===========================================================================
describe('two-person director approval', () => {
  test('initiate returns a pending request id and NO token', async () => {
    const f = await setup()
    const ctx = directorCtx(f.director, f.chapter)
    let out!: Awaited<ReturnType<InviteService['initiateDirectorInvite']>>
    await withRequest(async () => {
      out = await svc().initiateDirectorInvite({ chapterId: f.chapter, targetEmail: email() }, ctx)
    })
    expect(out.requestId).toBeTruthy()
    expect((out as { token?: unknown }).token).toBeUndefined()
    const [row] = await h.sql`select status, initiated_by, approved_by from director_invite_request where id = ${out.requestId}`
    expect(row!.status).toBe('pending')
    expect(row!.initiated_by).toBe(f.director)
    expect(row!.approved_by).toBeNull()
  })

  test('a SECOND distinct director approving mints the director token; both actors + times are recorded', async () => {
    const f = await setup()
    const targetEmail = email()
    let req!: Awaited<ReturnType<InviteService['initiateDirectorInvite']>>
    await withRequest(async () => {
      req = await svc().initiateDirectorInvite({ chapterId: f.chapter, targetEmail }, directorCtx(f.director, f.chapter))
    })
    let approved!: Awaited<ReturnType<InviteService['approveDirectorInvite']>>
    await withRequest(async () => {
      approved = await svc().approveDirectorInvite(req.requestId, directorCtx(f.director2, f.chapter))
    })
    expect(approved.token).toBeTruthy()
    expect(approved.inviteId).toBeTruthy()

    const [reqRow] = await h.sql`
      select status, initiated_by, approved_by, initiated_at, approved_at, invite_id
      from director_invite_request where id = ${req.requestId}
    `
    expect(reqRow!.status).toBe('approved')
    expect(reqRow!.initiated_by).toBe(f.director)
    expect(reqRow!.approved_by).toBe(f.director2)
    expect(reqRow!.initiated_at).not.toBeNull()
    expect(reqRow!.approved_at).not.toBeNull()
    expect(reqRow!.invite_id).toBe(approved.inviteId)

    const [inv] = await h.sql`select kind, target_email, bound_chapter_id, status from invite where id = ${approved.inviteId}`
    expect(inv!.kind).toBe('director')
    expect(inv!.target_email).toBe(targetEmail)
    expect(inv!.bound_chapter_id).toBe(f.chapter)
    expect(inv!.status).toBe('issued')
  })

  test('the SAME director cannot approve their own request (no token minted)', async () => {
    const f = await setup()
    let req!: Awaited<ReturnType<InviteService['initiateDirectorInvite']>>
    await withRequest(async () => {
      req = await svc().initiateDirectorInvite({ chapterId: f.chapter, targetEmail: email() }, directorCtx(f.director, f.chapter))
    })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().approveDirectorInvite(req.requestId, directorCtx(f.director, f.chapter))
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(DirectorInviteSameApproverError)
    const [row] = await h.sql`select status, invite_id from director_invite_request where id = ${req.requestId}`
    expect(row!.status).toBe('pending')
    expect(row!.invite_id).toBeNull()
  })

  test('a director in ANOTHER chapter cannot approve (opaque Forbidden)', async () => {
    const f = await setup()
    const otherChapter = await makeChapter(h.sql)
    const stranger = await makeAdult(h.sql)
    let req!: Awaited<ReturnType<InviteService['initiateDirectorInvite']>>
    await withRequest(async () => {
      req = await svc().initiateDirectorInvite({ chapterId: f.chapter, targetEmail: email() }, directorCtx(f.director, f.chapter))
    })
    let caught: unknown
    await withRequest(async () => {
      try {
        await svc().approveDirectorInvite(req.requestId, directorCtx(stranger, otherChapter))
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(Forbidden)
  })
})

// ===========================================================================
describe('per-kind expiries', () => {
  test('an adult (mentor) invite expires in ~72h', async () => {
    const f = await setup()
    const before = Date.now()
    const out = await issue(directorCtx(f.director, f.chapter), { kind: 'mentor', chapterId: f.chapter, targetEmail: email() })
    const exp = new Date((await h.sql`select expires_at from invite where id = ${out.inviteId}`)[0]!.expires_at as string).getTime()
    expect(exp).toBeGreaterThan(before + INVITE_ADULT_TTL_MS - 60_000)
    expect(exp).toBeLessThan(Date.now() + INVITE_ADULT_TTL_MS + 60_000)
  })

  test('a director invite (via two-person) expires in ~72h', async () => {
    const f = await setup()
    const before = Date.now()
    let req!: Awaited<ReturnType<InviteService['initiateDirectorInvite']>>
    await withRequest(async () => {
      req = await svc().initiateDirectorInvite({ chapterId: f.chapter, targetEmail: email() }, directorCtx(f.director, f.chapter))
    })
    let approved!: Awaited<ReturnType<InviteService['approveDirectorInvite']>>
    await withRequest(async () => {
      approved = await svc().approveDirectorInvite(req.requestId, directorCtx(f.director2, f.chapter))
    })
    expect(approved.expiresAt.getTime()).toBeGreaterThan(before + INVITE_ADULT_TTL_MS - 60_000)
    expect(approved.expiresAt.getTime()).toBeLessThan(Date.now() + INVITE_ADULT_TTL_MS + 60_000)
  })

  test('an expired adult token is refused at accept', async () => {
    const f = await setup()
    const targetEmail = email()
    const out = await issue(directorCtx(f.director, f.chapter), { kind: 'mentor', chapterId: f.chapter, targetEmail })
    await h.sql`update invite set expires_at = now() - interval '1 hour' where id = ${out.inviteId}`
    let caught: unknown
    try {
      await svc().acceptInvite(out.token, {
        email: targetEmail,
        password: 'correct horse battery staple',
        legalName: 'Mentor Testperson',
        displayName: 'Mentor T.',
        dateOfBirth: '1990-01-01',
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidInviteError)
  })
})

// ===========================================================================
describe('§4 redemption binding: {email, kind, chapter}', () => {
  async function issueMentor() {
    const f = await setup()
    const targetEmail = email()
    const out = await issue(directorCtx(f.director, f.chapter), { kind: 'mentor', chapterId: f.chapter, targetEmail })
    return { f, targetEmail, out }
  }
  const creds = (e: string) => ({
    email: e,
    password: 'correct horse battery staple',
    legalName: 'Mentor Testperson',
    displayName: 'Mentor T.',
    dateOfBirth: '1990-01-01',
  })

  test('accept with the matching {email, kind, chapter} succeeds', async () => {
    const { f, targetEmail, out } = await issueMentor()
    const res = await svc().acceptInvite(out.token, creds(targetEmail), {
      email: targetEmail,
      kind: 'mentor',
      chapter: f.chapter,
    })
    expect(res.accountId).toBeTruthy()
  })

  test('a mismatched expected EMAIL is refused (opaque invalid_token), invite untouched', async () => {
    const { f, targetEmail, out } = await issueMentor()
    let caught: unknown
    try {
      await svc().acceptInvite(out.token, creds(targetEmail), {
        email: 'someone-else@example.test',
        kind: 'mentor',
        chapter: f.chapter,
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvalidInviteError)
    const [inv] = await h.sql`select status from invite where id = ${out.inviteId}`
    expect(inv!.status).toBe('issued')
  })

  test('a mismatched expected KIND is refused', async () => {
    const { f, targetEmail, out } = await issueMentor()
    await expect(
      svc().acceptInvite(out.token, creds(targetEmail), { email: targetEmail, kind: 'staff', chapter: f.chapter }),
    ).rejects.toBeInstanceOf(InvalidInviteError)
  })

  test('a mismatched expected CHAPTER is refused', async () => {
    const { targetEmail, out } = await issueMentor()
    await expect(
      svc().acceptInvite(out.token, creds(targetEmail), { email: targetEmail, kind: 'mentor', chapter: randomUUID() }),
    ).rejects.toBeInstanceOf(InvalidInviteError)
  })

  test('accepting with a credential email different from the bound target_email is refused', async () => {
    const { out } = await issueMentor()
    await expect(
      svc().acceptInvite(out.token, creds('different@example.test')),
    ).rejects.toBeInstanceOf(InvalidInviteError)
  })
})

// ===========================================================================
describe('§4 per-issuer rate limit', () => {
  test('issuance trips after the configured cap', async () => {
    const f = await setup()
    const ctx = directorCtx(f.director, f.chapter)
    const limited = new InviteService({ sql: h.sql, authorize, config: { inviteRateLimitMax: 2 } })
    await withRequest(async () => {
      await limited.issueInvite({ kind: 'mentor', chapterId: f.chapter, targetEmail: email() }, ctx)
      await limited.issueInvite({ kind: 'mentor', chapterId: f.chapter, targetEmail: email() }, ctx)
    })
    let caught: unknown
    await withRequest(async () => {
      try {
        await limited.issueInvite({ kind: 'mentor', chapterId: f.chapter, targetEmail: email() }, ctx)
      } catch (e) {
        caught = e
      }
    })
    expect(caught).toBeInstanceOf(InviteRateLimitError)
  })
})

// ===========================================================================
describe('§4 no PII in the token', () => {
  test('the returned token is opaque — contains no email or name', async () => {
    const f = await setup()
    const targetEmail = `parent.mcname-${randomUUID().slice(0, 8)}@example.test`
    const out = await issue(directorCtx(f.director, f.chapter), { kind: 'mentor', chapterId: f.chapter, targetEmail })
    expect(out.token).not.toContain('@')
    expect(out.token.toLowerCase()).not.toContain('parent')
    expect(out.token.toLowerCase()).not.toContain('mcname')
    expect(out.token).not.toContain(targetEmail)
    // URL-safe base64 of 32 random bytes: only [A-Za-z0-9_-].
    expect(out.token).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

// ===========================================================================
describe('guardian TTL unchanged family window', () => {
  test('INVITE_GUARDIAN_TTL_MS is ~7 days and distinct from the adult 72h', () => {
    expect(INVITE_GUARDIAN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(INVITE_ADULT_TTL_MS).toBe(72 * 60 * 60 * 1000)
  })
})
