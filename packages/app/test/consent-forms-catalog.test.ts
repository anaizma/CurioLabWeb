import { describe, expect, test } from 'vitest'
import { CATALOG, getCatalogForm, toClientSchema } from '../src/consent-forms/catalog.js'

describe('consent form catalog', () => {
  test('all 11 forms are present with pinned hashes', () => {
    expect(CATALOG).toHaveLength(11)
    for (const f of CATALOG) {
      expect(f.pdfSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(f.pdfPath).toBe(`/consent-forms/${f.formId}.pdf`)
      expect(f.items.length).toBeGreaterThan(0)
    }
  })

  test('form-02 is elevated, guardian audience, maps public_publication', () => {
    const f = getCatalogForm('form-02')!
    expect(f.audience).toBe('guardian')
    expect(f.elevated).toBe(true)
    expect(f.items.some((i) => i.grantMapping === 'public_publication')).toBe(true)
  })

  test('the client projection drops grant mappings', () => {
    const client = toClientSchema(getCatalogForm('form-02')!)
    expect((client.items[0] as unknown as Record<string, unknown>).grantMapping).toBeUndefined()
    expect(client.items[0]!.itemKey).toContain('form-02:item-')
  })

  test('guardian forms are exactly 01-07', () => {
    expect(CATALOG.filter((f) => f.audience === 'guardian').map((f) => f.formId).sort())
      .toEqual(['form-01','form-02','form-03','form-04','form-05','form-06','form-07'])
  })
})
