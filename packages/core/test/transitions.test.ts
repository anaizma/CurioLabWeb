import { describe, expect, test } from 'vitest'
import {
  ALL_MACHINES,
  CONSENT_EVENTS,
  MACHINES,
  canTransition,
  type Machine,
} from '../src/transitions.js'

// -------------------------------------------------------------------------
// Transition-legality layer. These tests assert the graph shape only: which
// edges are legal and which capability the spec (04-state-machines.md) says
// triggers each edge. Actor permissions are NOT tested here (that is `can`).
// -------------------------------------------------------------------------

describe('account machine', () => {
  test('legal transitions carry the spec capability', () => {
    expect(canTransition('account', null, 'invited')).toEqual({
      allowed: true,
      capability: 'member.invite',
    })
    expect(canTransition('account', 'pending', 'active')).toEqual({
      allowed: true,
      capability: 'member.activate',
    })
    expect(canTransition('account', 'active', 'suspended')).toEqual({
      allowed: true,
      capability: 'account.suspend',
    })
    expect(canTransition('account', 'suspended', 'active')).toEqual({
      allowed: true,
      capability: 'account.reinstate',
    })
    // invited -> pending is via token acceptance: legal but no capability.
    expect(canTransition('account', 'invited', 'pending')).toEqual({ allowed: true })
    // any -> closed
    expect(canTransition('account', 'active', 'closed').capability).toBe('account.close')
    expect(canTransition('account', 'invited', 'closed').allowed).toBe(true)
  })

  test('illegal transitions are rejected with a reason', () => {
    // closed is terminal
    expect(canTransition('account', 'closed', 'active')).toEqual({
      allowed: false,
      reason: 'terminal_state',
    })
    // no direct invited -> active edge (must pass through pending)
    expect(canTransition('account', 'invited', 'active')).toEqual({
      allowed: false,
      reason: 'illegal_transition',
    })
    // active -> invited is backwards and absent
    expect(canTransition('account', 'active', 'invited').allowed).toBe(false)
  })
})

describe('membership machine', () => {
  test('legal transitions carry the spec capability', () => {
    expect(canTransition('membership', null, 'pending').capability).toBe('member.invite')
    expect(canTransition('membership', 'pending', 'active').capability).toBe('member.activate')
    expect(canTransition('membership', 'active', 'offboarded').capability).toBe(
      'membership.offboard',
    )
    expect(canTransition('membership', 'inactive', 'offboarded').capability).toBe(
      'membership.offboard',
    )
    expect(canTransition('membership', 'active', 'suspended').capability).toBe(
      'membership.suspend',
    )
    expect(canTransition('membership', 'suspended', 'active').capability).toBe(
      'membership.reinstate',
    )
    // window elapsed: legal, system-driven, no capability
    expect(canTransition('membership', 'active', 'inactive')).toEqual({ allowed: true })
  })

  test('there is deliberately NO student -> alumni edge (offboarding keeps role)', () => {
    // student and alumni are roles, not membership states: unknown_state, not an edge.
    expect(canTransition('membership', 'student', 'alumni')).toEqual({
      allowed: false,
      reason: 'unknown_state',
    })
  })

  test('offboarded is terminal', () => {
    expect(canTransition('membership', 'offboarded', 'active')).toEqual({
      allowed: false,
      reason: 'terminal_state',
    })
  })
})

describe('guardianship machine', () => {
  test('legal transitions carry the spec capability', () => {
    expect(canTransition('guardianship', 'pending', 'verified').capability).toBe(
      'guardianship.verify',
    )
    // mismatch outcome shares the same triggering capability
    expect(canTransition('guardianship', 'pending', 'rejected').capability).toBe(
      'guardianship.verify',
    )
    expect(canTransition('guardianship', 'verified', 'revoked').capability).toBe(
      'guardianship.revoke',
    )
    expect(canTransition('guardianship', 'verified', 'lapsed').capability).toBe(
      'maturation.confirm',
    )
  })

  test('rejected, revoked and lapsed are terminal', () => {
    expect(canTransition('guardianship', 'rejected', 'verified').reason).toBe('terminal_state')
    expect(canTransition('guardianship', 'revoked', 'verified').reason).toBe('terminal_state')
    expect(canTransition('guardianship', 'lapsed', 'verified').reason).toBe('terminal_state')
  })
})

describe('newsletter_issue machine', () => {
  test('legal transitions carry the spec capability', () => {
    expect(canTransition('newsletter_issue', null, 'draft').capability).toBe('newsletter.draft')
    expect(canTransition('newsletter_issue', 'draft', 'in_review').capability).toBe(
      'newsletter.submit_review',
    )
    expect(canTransition('newsletter_issue', 'in_review', 'draft').capability).toBe(
      'newsletter.return',
    )
    expect(canTransition('newsletter_issue', 'in_review', 'scheduled').capability).toBe(
      'newsletter.schedule',
    )
    expect(canTransition('newsletter_issue', 'scheduled', 'published').capability).toBe(
      'newsletter.publish',
    )
    expect(canTransition('newsletter_issue', 'published', 'archived').capability).toBe(
      'newsletter.unpublish',
    )
    // retry edges out of blocked
    expect(canTransition('newsletter_issue', 'blocked', 'in_review').capability).toBe(
      'newsletter.return',
    )
    expect(canTransition('newsletter_issue', 'blocked', 'scheduled').capability).toBe(
      'newsletter.schedule',
    )
  })

  test('scheduled -> blocked exists for the failed consent re-check (system, no capability)', () => {
    expect(canTransition('newsletter_issue', 'scheduled', 'blocked')).toEqual({ allowed: true })
  })

  test('archived is terminal', () => {
    expect(canTransition('newsletter_issue', 'archived', 'published').reason).toBe('terminal_state')
  })
})

describe('feed_post and comment machines (same table)', () => {
  test('feed_post legal transitions', () => {
    expect(canTransition('feed_post', null, 'published').capability).toBe('feed.post')
    expect(canTransition('feed_post', 'published', 'hidden').capability).toBe('feed.moderate')
    expect(canTransition('feed_post', 'hidden', 'published').capability).toBe('feed.moderate')
    expect(canTransition('feed_post', 'published', 'removed').capability).toBe('feed.moderate')
    expect(canTransition('feed_post', 'hidden', 'removed').capability).toBe('feed.moderate')
  })

  test('comment shares the shape but is created by feed.comment', () => {
    expect(canTransition('comment', null, 'published').capability).toBe('feed.comment')
    expect(canTransition('comment', 'published', 'removed').capability).toBe('feed.moderate')
  })

  test('published -> hidden is also guarded by feed.hide_safety in the table', () => {
    const rows = MACHINES.feed_post.transitions.filter(
      (t) => t.from === 'published' && t.to === 'hidden',
    )
    expect(rows.map((r) => r.capability)).toContain('feed.hide_safety')
    expect(rows.map((r) => r.capability)).toContain('feed.moderate')
  })

  test('removed is terminal', () => {
    expect(canTransition('feed_post', 'removed', 'published')).toEqual({
      allowed: false,
      reason: 'terminal_state',
    })
    expect(canTransition('comment', 'removed', 'hidden').reason).toBe('terminal_state')
  })
})

describe('project machine', () => {
  test('legal transitions carry the spec capability', () => {
    expect(canTransition('project', null, 'draft').capability).toBe('project.create')
    expect(canTransition('project', 'draft', 'submitted').capability).toBe('project.submit')
    expect(canTransition('project', 'submitted', 'verified').capability).toBe('project.verify')
    expect(canTransition('project', 'verified', 'public_listed').capability).toBe(
      'project.publish_public',
    )
    expect(canTransition('project', 'public_listed', 'verified').capability).toBe(
      'project.unpublish',
    )
  })

  test('cannot skip straight from draft to public_listed', () => {
    expect(canTransition('project', 'draft', 'public_listed').reason).toBe('illegal_transition')
  })
})

describe('application machine', () => {
  test('funnel transitions are legal', () => {
    expect(canTransition('application', null, 'submitted').allowed).toBe(true)
    expect(canTransition('application', 'submitted', 'screening').allowed).toBe(true)
    expect(canTransition('application', 'screening', 'interview_scheduled').allowed).toBe(true)
    expect(canTransition('application', 'interview_scheduled', 'accepted').allowed).toBe(true)
    expect(canTransition('application', 'accepted', 'enrolled').allowed).toBe(true)
    expect(canTransition('application', 'screening', 'withdrawn').allowed).toBe(true)
  })

  test('a declined application is reopenable (reopen edge to submitted)', () => {
    expect(canTransition('application', 'submitted', 'declined').allowed).toBe(true)
    expect(canTransition('application', 'declined', 'submitted').allowed).toBe(true)
  })

  test('enrolled and withdrawn are terminal', () => {
    expect(canTransition('application', 'enrolled', 'submitted').reason).toBe('terminal_state')
    expect(canTransition('application', 'withdrawn', 'submitted').reason).toBe('terminal_state')
  })
})

describe('invite machine', () => {
  test('legal transitions', () => {
    expect(canTransition('invite', null, 'issued').capability).toBe('member.invite')
    expect(canTransition('invite', 'issued', 'accepted').allowed).toBe(true)
    expect(canTransition('invite', 'issued', 'expired').allowed).toBe(true)
    expect(canTransition('invite', 'issued', 'revoked').allowed).toBe(true)
  })

  test('accepted, expired and revoked are terminal', () => {
    expect(canTransition('invite', 'accepted', 'issued').reason).toBe('terminal_state')
    expect(canTransition('invite', 'expired', 'accepted').reason).toBe('terminal_state')
    expect(canTransition('invite', 'revoked', 'issued').reason).toBe('terminal_state')
  })
})

describe('moderation_report machine', () => {
  test('legal transitions', () => {
    expect(canTransition('moderation_report', null, 'filed').capability).toBe('feed.report')
    expect(canTransition('moderation_report', 'filed', 'acknowledged').allowed).toBe(true)
    expect(canTransition('moderation_report', 'acknowledged', 'resolved').capability).toBe(
      'moderation.resolve',
    )
    expect(canTransition('moderation_report', 'filed', 'escalated').allowed).toBe(true)
    expect(canTransition('moderation_report', 'acknowledged', 'escalated').allowed).toBe(true)
    expect(canTransition('moderation_report', 'escalated', 'resolved').capability).toBe(
      'moderation.resolve',
    )
  })

  test('resolved is terminal', () => {
    expect(canTransition('moderation_report', 'resolved', 'escalated').reason).toBe('terminal_state')
  })
})

describe('account_maturation machine', () => {
  test('legal transitions', () => {
    expect(canTransition('account_maturation', 'minor', 'maturation_pending').allowed).toBe(true)
    expect(canTransition('account_maturation', 'maturation_pending', 'self_managed').capability).toBe(
      'maturation.confirm',
    )
  })

  test('self_managed is terminal', () => {
    expect(canTransition('account_maturation', 'self_managed', 'minor').reason).toBe('terminal_state')
  })
})

describe('deletion_request machine', () => {
  test('legal transitions', () => {
    expect(canTransition('deletion_request', null, 'requested').capability).toBe(
      'guardian.request_deletion',
    )
    expect(canTransition('deletion_request', 'requested', 'under_review').allowed).toBe(true)
    expect(canTransition('deletion_request', 'under_review', 'fulfilled_full').allowed).toBe(true)
    expect(canTransition('deletion_request', 'under_review', 'fulfilled_redaction').allowed).toBe(
      true,
    )
    expect(canTransition('deletion_request', 'under_review', 'partially_fulfilled').allowed).toBe(
      true,
    )
    expect(canTransition('deletion_request', 'under_review', 'refused').allowed).toBe(true)
  })

  test('all four fulfillment outcomes are terminal', () => {
    for (const outcome of [
      'fulfilled_full',
      'fulfilled_redaction',
      'partially_fulfilled',
      'refused',
    ]) {
      expect(canTransition('deletion_request', outcome, 'under_review').reason).toBe(
        'terminal_state',
      )
    }
  })
})

describe('consent is an append-only event list, not a state machine', () => {
  test('consent is absent from the machine registry', () => {
    expect(Object.keys(MACHINES)).not.toContain('consent')
    expect(ALL_MACHINES).not.toContain('consent' as Machine)
  })

  test('CONSENT_EVENTS records grant/revoke events with their capabilities', () => {
    const actions = new Set(CONSENT_EVENTS.map((e) => e.action))
    expect(actions.has('grant')).toBe(true)
    expect(actions.has('revoke')).toBe(true)
    const caps = CONSENT_EVENTS.map((e) => e.capability)
    expect(caps).toContain('consent.grant')
    expect(caps).toContain('consent.revoke')
    expect(caps).toContain('consent.revoke_safeguarding')
  })
})

describe('cross-machine structural invariants', () => {
  test('every state named in a machine appears as a from or a to (no dropped state)', () => {
    for (const machine of ALL_MACHINES) {
      const def = MACHINES[machine]
      const seen = new Set<string>()
      for (const t of def.transitions) {
        if (t.from !== null) seen.add(t.from)
        seen.add(t.to)
      }
      for (const state of def.states) {
        expect(seen, `${machine}: state '${state}' is orphaned`).toContain(state)
      }
    }
  })

  test('terminal states have no outgoing edges and reject any transition out', () => {
    for (const machine of ALL_MACHINES) {
      const def = MACHINES[machine]
      for (const terminal of def.terminal) {
        expect(def.transitions.some((t) => t.from === terminal)).toBe(false)
        const other = def.states.find((s) => s !== terminal) as string
        expect(canTransition(machine, terminal, other)).toEqual({
          allowed: false,
          reason: 'terminal_state',
        })
      }
    }
  })

  test('every declared terminal is an actual state of its machine', () => {
    for (const machine of ALL_MACHINES) {
      const def = MACHINES[machine]
      for (const terminal of def.terminal) {
        expect(def.states).toContain(terminal)
      }
    }
  })

  test('unknown states and unknown targets are rejected', () => {
    expect(canTransition('account', 'nonsense', 'active').reason).toBe('unknown_state')
    expect(canTransition('account', 'active', 'nonsense').reason).toBe('unknown_state')
  })
})
