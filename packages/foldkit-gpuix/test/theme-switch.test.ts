// A theme switch on a 2,000-element screen (FKN-18): the same FoldKit app,
// the same tree and the same CSS on the adapter and on the mirror, headless
// (both on the fake GPUI). Click → settled, the median of 5 switches, JS time
// only: not paint, not memory. Both must restyle the deepest cell; the
// numbers are printed, not asserted.
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { mountFake, runApp } from '../../../test/support/mount.ts'
import { mountHeadless } from './support.ts'

const ROWS = 400 // a row and 4 cells each: 2,000 elements, plus the frame

const css = `
  .screen { display: flex; flex-direction: column; background-color: var(--surface); color: var(--text); }
  .row { display: flex; flex-direction: row; gap: 4px; padding: 2px; border-bottom: 1px solid var(--line); }
  .cell { color: var(--text); background-color: var(--cell); padding: 1px 4px; }
  .cell-muted { color: var(--muted); }
`
const themes = {
  dark: { '--surface': '#121212', '--text': '#eeeeee', '--muted': '#888888', '--cell': '#1c1c1c', '--line': '#2a2a2a' },
  light: { '--surface': '#fafafa', '--text': '#111111', '--muted': '#666666', '--cell': '#ffffff', '--line': '#e0e0e0' },
}
const Message = defineMessageUnion({ Switched: {} })
type Message = typeof Message.Type
const Model = Schema.Struct({ dark: Schema.Boolean })
type Model = typeof Model.Type
const app = {
  Model,
  init: () => ({ model: { dark: true } }),
  update: (model: Model, _: Message) => ({ model: { dark: !model.dark } }),
  view: (model: Model, h: HtmlBuilder<Message>) => h.div([h.Class('screen'), h.Style(model.dark ? themes.dark : themes.light)], [
    h.button([h.Id('switch'), h.OnClick(Message.Switched())], [model.dark ? 'Light' : 'Dark']),
    ...Array.from({ length: ROWS }, (_, i) => h.div([h.Class('row')], [
      h.span([h.Class('cell')], [`${i}`]),
      h.span([h.Class('cell')], ['Title']),
      h.span([h.Class('cell cell-muted')], ['Artist']),
      h.span([h.Class('cell'), ...(i === ROWS - 1 ? [h.Id('last')] : [])], ['3:21']),
    ])),
  ]),
}

const median = (values: Array<number>) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

describe('theme switch, 2,000 elements, adapter vs mirror (headless)', () => {
  test('both restyle the deepest cell; click → settled times', async () => {
    // The adapter.
    const adapter = mountHeadless({ css, viewport: { width: 800, height: 600 } })
    const { Runtime } = await import('foldkit')
    adapter.own(Runtime.embed(Runtime.makeElement({ ...app, container: adapter.container } as never)))
    await adapter.settle()
    const elements = adapter.document.querySelectorAll('*').length
    const lastText = () => {
      const cell = adapter.gpui.node(adapter.document.getElementById('last')!.nativeId)
      return [cell.style['backgroundColor'], adapter.gpui.node(cell.children[0]!).style['color']]
    }
    const adapterMs: Array<number> = []
    const seenAdapter: Array<unknown> = [lastText()]
    for (let i = 0; i < 5; i++) {
      const started = performance.now()
      await adapter.click(i % 2 === 0 ? 'Light' : 'Dark')
      adapterMs.push(performance.now() - started)
      seenAdapter.push(lastText())
    }
    adapter.close()

    // The mirror: the same app in happy-dom, copied into the fake.
    const mirror = mountFake({ css, viewport: { width: 800, height: 600 } })
    await runApp(mirror, app as never)
    const mirrorLast = () => {
      const cell = mirror.nativeOf(mirror.document.getElementById('last') as unknown as Node)
      return [cell.style['backgroundColor'], mirror.gpui.node(cell.children[0]!).style['color']]
    }
    const button = mirror.document.getElementById('switch') as unknown as Node
    const mirrorMs: Array<number> = []
    const seenMirror: Array<unknown> = [mirrorLast()]
    for (let i = 0; i < 5; i++) {
      const started = performance.now()
      mirror.send(button, { eventType: 'click', button: 0, clickCount: 1 } as never)
      await mirror.settle()
      mirrorMs.push(performance.now() - started)
      seenMirror.push(mirrorLast())
    }
    await mirror.close()

    console.log([
      `theme switch, ${elements} elements (headless, JS time, click → settled, median of 5):`,
      `  adapter ${median(adapterMs).toFixed(1)} ms  [${adapterMs.map(ms => ms.toFixed(1)).join(', ')}]`,
      `  mirror  ${median(mirrorMs).toFixed(1)} ms  [${mirrorMs.map(ms => ms.toFixed(1)).join(', ')}]`,
    ].join('\n'))
    expect(elements).toBeGreaterThanOrEqual(2000)
    // Both paths switch every time, and land on the same colours.
    expect(seenAdapter[0]).toEqual(['#1c1c1c', '#eeeeee'])
    expect(seenAdapter[1]).toEqual(['#ffffff', '#111111'])
    expect(seenAdapter).toEqual(seenMirror)
  }, 120_000)
})
