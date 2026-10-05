// Where GPUI's hits land, against where a browser's would. gpuix lets a box
// that paints a fill block hits to everything behind it, its ancestors
// included; a browser bubbles a click on a child up to its parent. So a
// plain box inside one listening for the pointer lets GPUI's hits through
// (FKN-12: Big List's switch track and knob swallowed the switch's click on
// Metal; examples/big-list checks it there).
import { afterEach, describe, expect, test } from 'bun:test'

import { type Headless, mountHeadless } from './support.ts'

let app: Headless | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

const CSS = `
  .switch { display: flex; padding: 4px; }
  .track { width: 40px; height: 24px; background-color: #4f6ef7; }
  .knob { width: 18px; height: 18px; background-color: #fff; }
  .badge { position: absolute; top: 0; left: 0; background-color: red; }
  .scroller { height: 20px; overflow-y: auto; background-color: #eee; }
  .solid { pointer-events: auto; background-color: #eee; }
  .hovers { background-color: #eee; }
  .hovers:hover { background-color: #ddd; }
`

const scene = async () => {
  app = mountHeadless({ css: CSS })
  const { document } = app
  const make = (className: string, parent = document.body, tag = 'div') => {
    const element = document.createElement(tag)
    element.setAttribute('class', className)
    parent.appendChild(element)
    return element
  }
  const toggle = make('switch')
  const track = make('track', toggle)
  const knob = make('knob', track)
  const badge = make('badge', toggle)
  const scroller = make('scroller', toggle)
  const solid = make('solid', toggle)
  const field = make('', toggle, 'input')
  const hovers = make('hovers', toggle)
  const loose = make('track')
  await app.settle()
  return { toggle, track, knob, badge, scroller, solid, field, hovers, loose }
}
const pointer = (element: { nativeId: number }) => app!.gpui.node(element.nativeId).style['pointerEvents']

describe('click-through', () => {
  test('a fill inside a listening box lets hits through, its children too; a click on it still targets it', async () => {
    const { toggle, track, knob, loose } = await scene()
    expect(pointer(track)).toBeUndefined()
    const targets: Array<string> = []
    toggle.addEventListener('click', event => targets.push((event.target as typeof track).getAttribute('class')!))
    await app!.settle()
    expect(pointer(track)).toBe('none')
    expect(pointer(knob)).toBe('none')
    // The listening box keeps its hits; so does a fill nothing listens around
    // (the host follows the pointer over every fill: that doesn't count).
    expect(pointer(toggle)).toBeUndefined()
    expect(pointer(loose)).toBeUndefined()
    // GPUI sends the click to the switch; the document's hit test still finds
    // the deepest box there, as a browser's does.
    app!.gpui.setBounds(toggle.nativeId, { x: 0, y: 0, width: 100, height: 40 })
    app!.gpui.setBounds(track.nativeId, { x: 4, y: 4, width: 40, height: 24 })
    app!.gpui.setBounds(knob.nativeId, { x: 7, y: 7, width: 18, height: 18 })
    app!.host.relayout()
    // GPUI's press: its capture-phase sentinel first, which says where.
    const sentinel = app!.gpui.node(app!.document.body.nativeId).children.find(id => app!.gpui.node(id).listeners.has('mouseDownOutside'))!
    app!.host.dispatch({ eventType: 'mouseDownOutside', elementId: sentinel, x: 15, y: 15, button: 0 } as never)
    app!.host.dispatch({ eventType: 'click', elementId: toggle.nativeId, x: 15, y: 15, button: 0, clickCount: 1 } as never)
    await app!.settle()
    expect(targets).toEqual(['knob'])
  })

  test('not a positioned box, a scroller, a field, one whose CSS sets pointer-events or a hover style, or one listening itself', async () => {
    const { toggle, track, badge, scroller, solid, field, hovers } = await scene()
    toggle.addEventListener('click', () => {})
    track.addEventListener('mousedown', () => {})
    await app!.settle()
    for (const kept of [badge, scroller, solid, field, hovers, track]) expect(pointer(kept)).toBeUndefined()
  })

  test('decided again when a listener comes', async () => {
    const { toggle, track, knob } = await scene()
    toggle.addEventListener('click', () => {})
    await app!.settle()
    expect(pointer(track)).toBe('none')
    // The track listens now: it keeps its hits, and its knob passes them to it.
    track.addEventListener('mousedown', () => {})
    await app!.settle()
    expect(pointer(track)).toBeUndefined()
    expect(pointer(knob)).toBe('none')
  })
})
