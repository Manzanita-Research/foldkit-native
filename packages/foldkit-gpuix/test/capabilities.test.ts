// CAPABILITIES.md, checked against the tests, so it can't drift: every row
// has a status of works, approximated or rejected, and names tests (a file
// and a piece of a test's title) that exist. Every kind of CSS the sheet
// can report as unsupported has a rejected row, or is listed as missing.
// MIGRATING.md's citations are checked the same way.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PACKAGE = join(import.meta.dir, '..')
const read = (name: string) => readFileSync(join(PACKAGE, name), 'utf8')

type Citation = { file: string; fragment: string }
/** `[name](path) "a piece of a test's title"`, as the docs cite tests. */
const citations = (text: string): Array<Citation> =>
  [...text.matchAll(/\[[^\]]*\]\(([^)\s]+\.test\.ts)\)\s*"([^"]+)"/g)]
    // A title is one line; a citation may wrap in the prose.
    .map(([, file, fragment]) => ({ file: file!, fragment: fragment!.replace(/\s+/g, ' ') }))

/** What's wrong with a citation, if anything. */
const problem = ({ file, fragment }: Citation, from: string): string | undefined => {
  const path = join(dirname(join(PACKAGE, from)), file)
  if (!existsSync(path)) return `${file}: no such file`
  return readFileSync(path, 'utf8').includes(fragment) ? undefined : `${file}: no test says "${fragment}"`
}

type Row = { area: string; capability: string; status: string; notes: string; evidence: string }
const rows = (): Array<Row> => {
  const matrix = read('CAPABILITIES.md').split('## The matrix')[1]!.split('\n## ')[0]!
  return matrix.split('\n')
    .filter(line => line.startsWith('|') && !line.startsWith('|---') && !line.startsWith('| Area '))
    .map(line => {
      const cells = line.slice(1, -1).split('|').map(cell => cell.trim())
      expect(cells).toHaveLength(5)
      const [area, capability, status, notes, evidence] = cells as [string, string, string, string, string]
      return { area, capability, status, notes, evidence }
    })
}

describe('CAPABILITIES.md', () => {
  test('every row: works, approximated or rejected, and at least one test that exists', () => {
    const all = rows()
    expect(all.length).toBeGreaterThan(40)
    const wrong: Array<string> = []
    for (const row of all) {
      if (!['works', 'approximated', 'rejected'].includes(row.status)) wrong.push(`${row.capability}: status "${row.status}"`)
      const cited = citations(row.evidence)
      if (cited.length === 0) wrong.push(`${row.capability}: no test cited`)
      for (const citation of cited) {
        const found = problem(citation, 'CAPABILITIES.md')
        if (found !== undefined) wrong.push(`${row.capability}: ${found}`)
      }
    }
    expect(wrong).toEqual([])
  })

  test('every kind of CSS the sheet reports as unsupported is a rejected row, or listed as missing', () => {
    const source = read('src/sheet.ts')
    const kinds = new Set([
      ...[...source.matchAll(/unsupported: '([^']+)'/g)].map(match => match[1]!),
      ...[...source.matchAll(/\$\{prelude\} \(([^)]+)\)/g)].map(match => match[1]!),
    ])
    expect([...kinds].sort()).toEqual(['media query', 'pseudo-element', 'selector', 'sibling combinator', 'state on an ancestor', 'structural pseudo-class'])
    const rejected = rows().filter(row => row.status === 'rejected').map(row => row.capability.toLowerCase())
    const missing = read('CAPABILITIES.md').split('## Missing')[1]!.toLowerCase()
    const unlisted = [...kinds].filter(kind => !rejected.some(capability => capability.includes(kind)) && !missing.includes(`\`${kind}\``))
    expect(unlisted).toEqual([])
  })
})

describe('MIGRATING.md', () => {
  test('every test it cites exists', () => {
    const cited = citations(read('MIGRATING.md'))
    expect(cited.length).toBeGreaterThan(5)
    expect(cited.map(citation => problem(citation, 'MIGRATING.md')).filter(found => found !== undefined)).toEqual([])
  })
})
