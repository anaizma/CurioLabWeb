// -------------------------------------------------------------------------
// Device recognition (migration 0045). Pure functions, no database.
//
// The properties that matter are privacy properties, so they are the ones
// asserted: the IP is coarsened, the label is a family and not the user-agent
// string, and the hash is salted per account so the same device cannot be
// correlated across accounts.
// -------------------------------------------------------------------------

import { describe, expect, test } from 'vitest'
import { coarseIp, deviceHash, deviceLabel, fingerprintDevice } from '../src/device.js'

describe('coarseIp', () => {
  test('reduces IPv4 to its /24 network', () => {
    expect(coarseIp('203.0.113.42')).toBe('203.0.113.0/24')
    expect(coarseIp('10.1.2.3')).toBe('10.1.2.0/24')
  })

  test('two addresses on the same /24 coarsen to the same network', () => {
    expect(coarseIp('203.0.113.1')).toBe(coarseIp('203.0.113.254'))
  })

  test('a different /24 is a different network', () => {
    expect(coarseIp('203.0.113.1')).not.toBe(coarseIp('203.0.114.1'))
  })

  test('unwraps an IPv4-mapped IPv6 address as proxies emit it', () => {
    expect(coarseIp('::ffff:203.0.113.42')).toBe('203.0.113.0/24')
  })

  test('reduces IPv6 to its /48 site prefix', () => {
    expect(coarseIp('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1::/48')
  })

  test('EXPANDS :: compression before taking the prefix', () => {
    // The trailing group in `::1` is the LAST hextet, not the first. Splitting on
    // ':' and dropping the empties would report the loopback address as the
    // network 1:0:0::/48.
    expect(coarseIp('::1')).toBe('0:0:0::/48')
    expect(coarseIp('2001:db8::1')).toBe('2001:db8:0::/48')
    expect(coarseIp('2001:db8:abcd::1')).toBe('2001:db8:abcd::/48')
  })

  test('normalises leading zeros so one network has one representation', () => {
    expect(coarseIp('2001:0db8:0001:2:3:4:5:6')).toBe(coarseIp('2001:db8:1:2:3:4:5:6'))
  })

  test('ignores an IPv6 zone index', () => {
    expect(coarseIp('fe80::1%eth0')).toBe('fe80:0:0::/48')
  })

  test('null / empty / unparseable degrade to null, never to a shared bucket', () => {
    expect(coarseIp(null)).toBeNull()
    expect(coarseIp(undefined)).toBeNull()
    expect(coarseIp('')).toBeNull()
    expect(coarseIp('   ')).toBeNull()
    expect(coarseIp('not-an-address')).toBeNull()
    expect(coarseIp('1.2.3')).toBeNull()
    expect(coarseIp('999.1.1.1')).toBeNull()
    expect(coarseIp('2001::db8::1')).toBeNull()
    expect(coarseIp('2001:db8:1:2:3:4:5')).toBeNull()
  })

  test('never returns the exact address', () => {
    expect(coarseIp('203.0.113.42')).not.toContain('.42')
  })
})

describe('deviceLabel', () => {
  test('names the browser and platform family, not the user agent', () => {
    const chromeWin =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    expect(deviceLabel(chromeWin)).toBe('Chrome on Windows')
    // The high-entropy parts of the UA must not survive into the stored label.
    expect(deviceLabel(chromeWin)).not.toContain('537.36')
    expect(deviceLabel(chromeWin)).not.toContain('120.0.0.0')
  })

  test('prefers the specific browser over the ones it impersonates', () => {
    // Edge claims Chrome AND Safari; Chrome claims Safari. Order matters.
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      ),
    ).toBe('Edge on Windows')
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('Safari on macOS')
  })

  test('recognises the common mobile combinations', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS')
    expect(
      deviceLabel(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android')
  })

  test('returns null rather than guessing when nothing is recognisable', () => {
    expect(deviceLabel(null)).toBeNull()
    expect(deviceLabel('')).toBeNull()
    expect(deviceLabel('curl/8.4.0')).toBeNull()
  })
})

describe('deviceHash', () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'

  test('is stable for the same account, agent and network', () => {
    expect(deviceHash('acct-1', UA, '203.0.113.42')).toBe(deviceHash('acct-1', UA, '203.0.113.42'))
  })

  test('is stable across addresses within the same coarse network', () => {
    expect(deviceHash('acct-1', UA, '203.0.113.42')).toBe(deviceHash('acct-1', UA, '203.0.113.7'))
  })

  test('is SALTED PER ACCOUNT: the same device is a different hash for a different account', () => {
    // This is the privacy property. Without it the value would be a
    // cross-account tracking identifier.
    expect(deviceHash('acct-1', UA, '203.0.113.42')).not.toBe(deviceHash('acct-2', UA, '203.0.113.42'))
  })

  test('changes when the agent or the network changes', () => {
    expect(deviceHash('acct-1', UA, '203.0.113.42')).not.toBe(deviceHash('acct-1', 'curl/8.4.0', '203.0.113.42'))
    expect(deviceHash('acct-1', UA, '203.0.113.42')).not.toBe(deviceHash('acct-1', UA, '198.51.100.9'))
  })

  test('contains neither the raw agent nor the raw address', () => {
    const h = deviceHash('acct-1', UA, '203.0.113.42')!
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toContain('203.0.113.42')
    expect(h).not.toContain('Chrome')
  })

  test('is null when there is nothing at all to fingerprint', () => {
    // A hash of nothing would make every anonymous caller look like one
    // familiar device, which would suppress the notice we want.
    expect(deviceHash('acct-1', null, null)).toBeNull()
    expect(deviceHash('acct-1', '', '')).toBeNull()
  })

  test('still fingerprints when only one of the two inputs is known', () => {
    expect(deviceHash('acct-1', UA, null)).not.toBeNull()
    expect(deviceHash('acct-1', null, '203.0.113.42')).not.toBeNull()
  })
})

describe('fingerprintDevice', () => {
  test('bundles the hash, the coarse label and the coarse network', () => {
    const d = fingerprintDevice(
      'acct-1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '203.0.113.42',
    )
    expect(d.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(d.label).toBe('Chrome on Windows')
    expect(d.ipHint).toBe('203.0.113.0/24')
  })

  test('is all nulls for a caller with no agent and no resolvable address', () => {
    expect(fingerprintDevice('acct-1', null, null)).toEqual({ hash: null, label: null, ipHint: null })
  })
})
