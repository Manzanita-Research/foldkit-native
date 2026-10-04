// Native UI on FoldKit on gpuix: the app's own start and CSS, no happy-dom.
// Headless here (the fake GPUI tree); on Metal in
// packages/foldkit-gpuix/test/metal.test.ts, which also takes the screenshots.
import { afterEach, describe, expect, test } from 'bun:test'

import { type Headless, mountHeadless } from '../../packages/foldkit-gpuix/test/support.ts'
import { loadExample } from '../support/example.ts'

let app: Headless | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

const open = async () => {
  const example = await loadExample('native-ui')
  const timings: Array<number> = []
  app = mountHeadless({ css: example.css, viewport: { width: example.meta.width, height: example.meta.height }, onSynced: t => timings.push(t.syncMs) })
  example.start(app.container)
  await app.settle()
  return { app, timings }
}
const active = () => app!.document.activeElement?.getAttribute('id') ?? app!.document.activeElement?.textContent ?? null

describe('headless', () => {
  test('draws every section, with every CSS rule usable on gpuix', async () => {
    await open()
    expect(app!.unsupported).toEqual([])
    expect(app!.texts()).toEqual(expect.arrayContaining(['Preferences', 'PROFILE', 'Name', 'Email', 'Dark theme', 'Accent colour', 'Violet', 'Reset profile…']))
  })

  test('Tab walks the whole page in order, through GPUI\'s focus', async () => {
    await open()
    const stops: Array<string | null> = []
    for (let i = 0; i < 7; i++) {
      await app!.press('tab')
      stops.push(active())
    }
    expect(stops).toEqual(['Preferences', 'name', 'email', 'dark', 'accent', 'reset', 'Preferences'].map(stop =>
      stop === 'Preferences' ? app!.document.querySelector('[role="region"]')!.textContent : stop))
  })

  test('the theme switch restyles the whole tree live, from the keyboard', async () => {
    const { timings } = await open()
    const canvas = () => app!.gpui.node(app!.document.querySelector('[data-ui="root"]')!.nativeId).style['backgroundColor']
    expect(canvas()).toBe('#141318')
    app!.document.getElementById('dark')!.focus()
    timings.length = 0
    await app!.press('space')
    expect(canvas()).toBe('#f4f1ea')
    console.log(`native-ui theme switch: ${timings.reduce((a, b) => a + b, 0).toFixed(1)} ms of sync`)
  })

  test('accent listbox: arrows, GPUI scrollIntoView, Enter; the accent token follows', async () => {
    await open()
    app!.document.getElementById('accent')!.focus()
    for (const _ of [1, 2, 3, 4, 5, 6]) await app!.press('down')
    const into = app!.fake.scrolledIntoView.map(id => app!.elementFor(id)?.getAttribute('id'))
    expect(into.at(-1)).toBe('accent-option-6')
    await app!.press('enter')
    expect(app!.texts()).toContain('FoldKit on gpuix · dark · orange')
    const track = app!.gpui.node(app!.document.getElementById('dark')!.nativeId)
    expect(track.style['backgroundColor']).toBe('#ef7a2f')
  })

  test('reset dialog: focus moves in, stays in, and comes back', async () => {
    await open()
    await app!.type('Ada Lovelace', 'Ada')
    app!.document.getElementById('reset')!.focus()
    await app!.press('enter')
    expect(active()).toBe('Cancel')
    await app!.press('tab')
    await app!.press('tab')
    expect(active()).toBe('Cancel')
    await app!.press('tab')
    await app!.press('enter')
    expect(app!.texts()).toContain('Reset 1 time.')
    expect(active()).toBe('reset')
    expect((app!.document.getElementById('name') as unknown as { value: string }).value).toBe('')
  })
})
