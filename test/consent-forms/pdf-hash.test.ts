import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import hashes from '../../packages/app/src/consent-forms/pdf-hashes.json'

const pubDir = join(process.cwd(), 'public', 'consent-forms')

describe('committed consent PDFs match the pinned hashes', () => {
  test('every form-NN.pdf hashes to its pinned value', () => {
    const files = readdirSync(pubDir).filter((f) => f.endsWith('.pdf'))
    expect(files.length).toBe(11)
    for (const f of files) {
      const id = f.replace('.pdf', '')
      const sha = createHash('sha256').update(readFileSync(join(pubDir, f))).digest('hex')
      expect(sha, `${id} hash drifted from pinned`).toBe((hashes as Record<string, string>)[id])
    }
  })
})
