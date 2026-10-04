// How much of each example's CSS FoldKit on gpuix can use as it is: the
// share of style rules whose selectors look at one element (sheet.ts). The
// rest is what an app would rewrite (mostly Tailwind's descendant-based
// utilities: `space-y-*`, `divide-*`, `group-hover:`, preflight's `*`
// pseudo-elements). Prints a table; COMPONENTS.md quotes it.
import { describe, expect, test } from 'bun:test'

import { exampleCss, exampleIds } from '../../../examples/support/example.ts'
import { sheetFromCss } from '../src/index.ts'

describe('example CSS on the flat sheet', () => {
  test('coverage per example', () => {
    const rows = exampleIds().map(id => {
      const sheet = sheetFromCss(exampleCss(id), { viewportWidth: 1024 })
      const used = sheet.rules.length
      const dropped = sheet.unsupported.length
      const reasons = new Map<string, number>()
      for (const rule of sheet.unsupported) {
        const reason = /\(([^()]*)\)$/.exec(rule)?.[1] ?? 'other'
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      }
      return { id, used, dropped, share: used / Math.max(1, used + dropped), reasons: Object.fromEntries(reasons) }
    })
    console.log('example CSS on the flat sheet:')
    for (const row of rows) {
      console.log(`  ${row.id.padEnd(14)} ${String(row.used).padStart(4)} used ${String(row.dropped).padStart(4)} not  ${(row.share * 100).toFixed(0).padStart(3)}%  ${JSON.stringify(row.reasons)}`)
    }
    // The spike's own app is written for it: every rule applies.
    expect(rows.find(row => row.id === 'native-ui')?.dropped).toBe(0)
  })
})
