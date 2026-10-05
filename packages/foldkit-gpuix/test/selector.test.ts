// The selector engine on selectors it can't read: it says so (the sheet
// reports `selector`; querySelector throws a SyntaxError, as a browser's
// does) and never loops. A parser that read nothing at a character no
// selector part starts with (`|`, `$`, `^`, `!`) looped forever, as did an
// attribute value with no closing quote. The cases run in their own process,
// killed after a few seconds, so a loop fails this test rather than hanging
// the run.
import { expect, test } from 'bun:test'
import { join } from 'node:path'

const UNREADABLE = ['a | b', '$$', '.a ^ b', '*|a', 'a!', '[a="x', "[a='x"]

const parse = async (selectors: ReadonlyArray<string>) => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'selector-process.ts'), JSON.stringify(selectors)], { stdout: 'pipe', stderr: 'pipe' })
  const killer = setTimeout(() => child.kill(), 5000)
  const code = await child.exited
  clearTimeout(killer)
  return { killed: child.signalCode !== null, code, out: (await new Response(child.stdout).text()).trim(), err: await new Response(child.stderr).text() }
}

test('selectors it can\'t read are reported and throw a SyntaxError, without looping', async () => {
  const { killed, code, out, err } = await parse(UNREADABLE)
  expect({ killed, code, err }).toEqual({ killed: false, code: 0, err: '' })
  expect(JSON.parse(out)).toEqual(UNREADABLE.map(selector => ({ selector, reported: [`${selector} (selector)`], thrown: 'SyntaxError' })))
})

test('selectors it reads still parse, and sibling combinators are still reported as such', async () => {
  const readable = ['a,b', '.row[data-selected] .cell', 'div > p:not(.x)', '[data-ui="switch"]:not([data-part])', '[a="x y"]']
  const { killed, out } = await parse([...readable, 'a + b'])
  expect(killed).toBe(false)
  const results = JSON.parse(out) as Array<{ selector: string; reported: Array<string>; thrown?: string }>
  expect(results.slice(0, readable.length)).toEqual(readable.map(selector => ({ selector, reported: [] })))
  // The sheet refuses it before parsing; querySelector can't read it either.
  expect(results.at(-1)).toEqual({ selector: 'a + b', reported: ['a + b (sibling combinator)'], thrown: 'SyntaxError' })
})
