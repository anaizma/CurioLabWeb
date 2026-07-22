import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

/**
 * The authorization core must be framework-agnostic and free of IO imports.
 * A route or app file leaking in here would break the "pure, no IO" guarantee.
 */
describe('packages/core purity', () => {
  const files = walk(srcDir)

  test('src has TypeScript files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  test('core imports nothing from next or the app', () => {
    const forbidden = [
      /from\s+['"]next(\/|['"])/,
      /from\s+['"](\.\.\/){2,}app\b/,
      /from\s+['"](\.\.\/){2,}(lib|components)\b/,
      /require\(\s*['"]next/,
    ]
    const offenders: string[] = []
    for (const file of files) {
      const body = readFileSync(file, 'utf8')
      for (const pattern of forbidden) {
        if (pattern.test(body)) offenders.push(`${file} matched ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('can() performs no IO: no fs, http, or node builtins imported in the engine', () => {
    const engineFiles = files.filter((f) => !f.endsWith('index.ts'))
    const ioImports = [
      /from\s+['"]node:/,
      /from\s+['"](fs|http|https|net|crypto|child_process|dns)['"]/,
      /\bfetch\s*\(/,
    ]
    const offenders: string[] = []
    for (const file of engineFiles) {
      const body = readFileSync(file, 'utf8')
      for (const pattern of ioImports) {
        if (pattern.test(body)) offenders.push(`${file} matched ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
