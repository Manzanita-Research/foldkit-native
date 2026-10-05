// The components' Commands on FoldKit on gpuix with no happy-dom loaded:
// commands-process.ts runs them in a process of its own, since `bun test`
// preloads one.
import { expect, test } from 'bun:test'
import { join } from 'node:path'

test('RadioGroup, Tabs, Listbox and Select Commands run on the native document, with no happy-dom loaded', async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'commands-process.ts')], { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(err).toBe('')
  expect(code).toBe(0)
  const checks = Object.fromEntries(out.trim().split('\n').map(line => JSON.parse(line) as { check: string; value: unknown }).map(({ check, value }) => [check, value]))
  expect(checks).toMatchObject({
    'happy-dom before': 0,
    'RadioGroup FocusOption (Dom.focus)': ['plan-option-1', 'plan-option-1', 'pro'],
    'Tabs FocusTab (Dom.focus), Automatic': ['settings-tab-1', 'settings-tab-1', 'privacy'],
    'Tabs FocusTab (Dom.focus), Manual': ['settings-tab-1', 'settings-tab-1', 'general'],
    'Select FocusAfterCommit': ['fruit-list', 'fruit-trigger'],
    'happy-dom after': 0,
  })
  expect(checks['Listbox ScrollIntoView']).toContain('fruit-option-9')
}, 30_000)
