import { describe, expect, test } from 'vitest'
import { parseFormItems } from '../src/consent-forms/parse.js'

describe('parseFormItems', () => {
  test('extracts each "- [ ]" clause with a stable key and text', () => {
    const md = [
      '## 1. What you would be allowing',
      '- [ ] Publish my child’s project work (code, description, result).',
      'Some prose.',
      '- [ ] Show my child’s first name and last initial with published work.',
    ].join('\n')
    const items = parseFormItems('form-02', md)
    expect(items).toEqual([
      { itemKey: 'form-02:item-1', text: 'Publish my child’s project work (code, description, result).' },
      { itemKey: 'form-02:item-2', text: 'Show my child’s first name and last initial with published work.' },
    ])
  })

  test('ignores non-checkbox bullets', () => {
    expect(parseFormItems('form-x', '- plain bullet\n- [ ] real item')).toHaveLength(1)
  })
})
