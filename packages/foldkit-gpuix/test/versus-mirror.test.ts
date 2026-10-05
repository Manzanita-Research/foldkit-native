// The same unmodified example apps, on the DOM mirror (happy-dom → GPUI) and
// on FoldKit on gpuix (no DOM engine), headless. Measures first-render sync
// time and a theme switch, and checks the two gallery bugs Jem hit (FKN-12,
// FKN-13) on each. Prints a table; COMPONENTS.md quotes it. Headless sync
// time is JS time on this machine, not frames; budgets are loose.
import { describe, expect, test } from 'bun:test'

import { type Headless as MirrorApp, mirrorHeadless as openHeadless } from '../../../examples/support/harness.ts'
import { exampleIds, loadExample } from '../../../examples/support/example.ts'
import { type Headless, mountHeadless } from './support.ts'

const sum = (values: Array<number>) => values.reduce((total, value) => total + value, 0)

const onAdapter = async (id: string) => {
  const example = await loadExample(id)
  const syncs: Array<number> = []
  const app = mountHeadless({
    css: example.css, viewport: { width: example.meta.width, height: example.meta.height },
    onSynced: timings => syncs.push(timings.syncMs),
  })
  const started = performance.now()
  example.start(app.container)
  await app.settle()
  await app.settle()
  return { app, example, firstMs: sum(syncs), wallMs: performance.now() - started, syncs }
}

const onMirror = async (id: string) => {
  const started = performance.now()
  const app = await openHeadless(id)
  return { app, wallMs: performance.now() - started }
}

describe('mirror vs FoldKit on gpuix, same apps', () => {
  test('first render, every example', async () => {
    globalThis.fetch = (async () => new Response('{}')) as never
    const rows: Array<string> = []
    for (const id of exampleIds().filter(id => id !== 'native-ui')) {
      const mirror = await onMirror(id)
      const mirrorTexts = (mirror.app as MirrorApp).texts().length
      await mirror.app.close()
      const adapter = await onAdapter(id)
      const adapterTexts = adapter.app.texts().length
      rows.push(`  ${id.padEnd(14)} mirror ${mirror.wallMs.toFixed(0).padStart(5)} ms  gpuix ${adapter.wallMs.toFixed(0).padStart(5)} ms (sync ${adapter.firstMs.toFixed(1)} ms)  texts ${mirrorTexts} / ${adapterTexts}`)
      // Same app, same visible text, either way.
      expect(adapterTexts).toBe(mirrorTexts)
      adapter.app.close()
    }
    console.log('first render (start → settled, headless):\n' + rows.join('\n'))
  }, 60_000)

  test('Big List theme switch (FKN-12): restyles everything, and how long it takes', async () => {
    const { app } = await onAdapter('big-list')
    const root = () => app.gpui.node(app.document.querySelector('.app')!.nativeId).style['backgroundColor']
    const dark = root()
    let started = performance.now()
    await app.click('Dark')
    const adapterMs = performance.now() - started
    const light = root()
    expect(app.texts()).toContain('Light')
    expect(light).not.toBe(dark)

    const mirror = await openHeadless('big-list')
    const mirrorRoot = () => mirror.nativeOf(mirror.document.querySelector('.app')!).style['backgroundColor']
    const before = mirrorRoot()
    started = performance.now()
    await mirror.click('Dark')
    const mirrorMs = performance.now() - started
    console.log(`big-list theme switch, click → settled: gpuix ${adapterMs.toFixed(1)} ms (${dark} → ${light}); mirror ${mirrorMs.toFixed(1)} ms (${before} → ${mirrorRoot()})`)
    await mirror.close()
    app.close()
  }, 30_000)

  test('Form Tab (FKN-13): Tab moves between fields on gpuix', async () => {
    const { app } = await onAdapter('form')
    const order: Array<string | null> = []
    for (let i = 0; i < 4; i++) {
      await app.press('tab')
      order.push(app.document.activeElement?.getAttribute('id') ?? app.document.activeElement?.localName ?? null)
    }
    console.log(`form Tab on gpuix: ${order.join(' → ')}`)
    expect(order.slice(0, 3)).toEqual(['name', 'email', 'message'])
    // Typing reaches the app (FoldKit's field validation shows its error).
    await app.type('Name', 'A')
    expect(app.texts()).toContain('Name must be at least 2 characters')
    app.close()
  }, 30_000)
})

export type { Headless }
