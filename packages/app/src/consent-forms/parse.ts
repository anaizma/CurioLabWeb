export interface ParsedItem {
  itemKey: string
  text: string
}

/** Extract every "- [ ]" / "* [ ]" checkbox clause, in order, with a stable key. */
export function parseFormItems(formId: string, markdown: string): ParsedItem[] {
  const out: ParsedItem[] = []
  let n = 0
  for (const line of markdown.split('\n')) {
    const m = line.match(/^\s*[-*]\s+\[\s?\]\s+(.*\S)\s*$/)
    if (m) {
      n += 1
      out.push({ itemKey: `${formId}:item-${n}`, text: m[1]! })
    }
  }
  return out
}
