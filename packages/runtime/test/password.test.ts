import { describe, expect, test } from 'vitest'
import { hashPassword, verifyPassword } from '../src/password.js'

describe('password hashing (argon2id)', () => {
  test('hash then verify round-trips the correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true)
  })

  test('a wrong password fails verification', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'Tr0ubador&3')).toBe(false)
  })

  test('the same password hashes to distinct salted digests', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toEqual(b)
    expect(await verifyPassword(a, 'same-password')).toBe(true)
    expect(await verifyPassword(b, 'same-password')).toBe(true)
  })
})
