// Geometry on the adapter, headless (FKN-29): where GPUI last painted things,
// read from gpuix's automation tree at most once per frame and never waited
// for. The fake GPUI's layout comes from `setBounds` (border boxes), reported
// the way gpuix reports them (content corner, a scroll area moved by its own
// offset); `relayout()` tells the host GPUI laid out again.
import { afterEach, describe, expect, test } from 'bun:test'

import type { NativeElement } from '../src/index.ts'
import { MAX_AGE_MS } from '../src/layout.ts'
import { type Headless, mountHeadless } from './support.ts'

let app: Headless | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

type Box = { x: number; y: number; width: number; height: number }

type Spec = Array<{ id: string; style?: string; children?: Spec }>
/** Builds plain `<div>`s, each with an id and an inline style. */
const build = (app: Headless, parent: NativeElement, spec: Spec): void => {
  for (const { id, style, children } of spec) {
    const element = app.document.createElement('div')
    element.setAttribute('id', id)
    if (style !== undefined) element.setAttribute('style', style)
    parent.appendChild(element)
    if (children !== undefined) build(app, element, children)
  }
}
const byId = (id: string) => app!.document.getElementById(id)!
const place = (boxes: Record<string, Box>) => {
  for (const [id, box] of Object.entries(boxes)) app!.gpui.setBounds(byId(id).nativeId, box)
  app!.host.relayout()
}
const ids = (elements: Array<NativeElement>) => elements.map(element => element.getAttribute('id') ?? element.localName)

describe('reading the layout', () => {
  test('every read between two frames costs one tree read, and none when nothing moved', async () => {
    app = mountHeadless()
    build(app, app.document.body, Array.from({ length: 50 }, (_, at) => ({ id: `row-${at}` })))
    await app.settle()
    place(Object.fromEntries(Array.from({ length: 50 }, (_, at) => [`row-${at}`, { x: 0, y: at * 20, width: 300, height: 20 }])))
    await app.settle()
    // gpuix's per-element query walks the whole tree each time: never used.
    app.fake.renderer.getElementBounds = () => {
      throw new Error('getElementBounds called')
    }
    const before = app.gpui.treeReads()
    for (let at = 0; at < 50; at++) expect(byId(`row-${at}`).getBoundingClientRect().y).toBe(at * 20)
    expect(app.document.elementsFromPoint(10, 105).map(element => element.getAttribute('id'))[0]).toBe('row-5')
    expect(app.gpui.treeReads() - before).toBe(1)

    // Frames with nothing moved: no reads, however much is asked.
    const idle = app.gpui.treeReads()
    for (let frame = 0; frame < 5; frame++) {
      app.host.drawn()
      byId('row-1').getBoundingClientRect()
    }
    expect(app.gpui.treeReads()).toBe(idle)

    // A change: read again, once per frame, in the frames after it.
    byId('row-1').setAttribute('style', 'height: 30px')
    await app.settle()
    const changed = app.gpui.treeReads()
    for (let at = 0; at < 10; at++) byId('row-1').getBoundingClientRect()
    expect(app.gpui.treeReads() - changed).toBeLessThanOrEqual(1)
  })

  test('the border box, a scrolled area and what it scrolled', async () => {
    app = mountHeadless()
    build(app, app.document.body, [
      { id: 'card', style: 'padding: 8px; border: 2px solid red' },
      { id: 'list', style: 'overflow-y: scroll; height: 100px', children: [{ id: 'item' }] },
    ])
    await app.settle()
    place({ card: { x: 10, y: 10, width: 100, height: 50 }, list: { x: 0, y: 100, width: 200, height: 100 }, item: { x: 0, y: 60, width: 200, height: 40 } })
    app.gpui.setScrollOffset(byId('list').nativeId, 0, -40)
    await app.settle()
    expect(byId('card').getBoundingClientRect()).toMatchObject({ x: 10, y: 10, width: 100, height: 50 })
    expect(byId('list').getBoundingClientRect()).toMatchObject({ x: 0, y: 100, width: 200, height: 100 })
    expect(byId('list').scrollTop).toBe(40)
  })
})

describe('after a scroll, before GPUI paints it', () => {
  test('a box read straight after the host scrolls is where it will be drawn: inside the area, nested too; clipped by it; clamped as GPUI clamps', async () => {
    app = mountHeadless()
    build(app, app.document.body, [
      { id: 'list', style: 'overflow-y: scroll; height: 100px', children: [
        { id: 'a' }, { id: 'b' },
        { id: 'nested', style: 'overflow-y: scroll; height: 40px', children: [{ id: 'deep' }] },
        { id: 'c' },
      ] },
      { id: 'outside' },
    ])
    await app.settle()
    place({
      list: { x: 0, y: 100, width: 200, height: 100 },
      a: { x: 0, y: 100, width: 200, height: 40 }, b: { x: 0, y: 140, width: 200, height: 40 },
      nested: { x: 0, y: 180, width: 200, height: 40 }, deep: { x: 0, y: 180, width: 200, height: 20 },
      c: { x: 0, y: 220, width: 200, height: 80 }, outside: { x: 0, y: 200, width: 200, height: 20 },
    })
    await app.settle()
    expect(byId('b').getBoundingClientRect().y).toBe(140)
    expect(ids(app.document.elementsFromPoint(10, 110))).toContain('a')
    const reads = app.host.geometry().reads
    byId('list').scrollTop = 40
    // No frame since, no read: the boxes inside moved with the content.
    expect(byId('b').getBoundingClientRect().y).toBe(100)
    expect(byId('deep').getBoundingClientRect().y).toBe(140)
    expect(byId('list').getBoundingClientRect().y).toBe(100)
    expect(byId('outside').getBoundingClientRect().y).toBe(200)
    expect(app.host.geometry().reads).toBe(reads)
    // a is scrolled out of the list's view now: never under the pointer.
    expect(ids(app.document.elementsFromPoint(10, 70))).not.toContain('a')
    expect(ids(app.document.elementsFromPoint(10, 110))).toEqual(expect.arrayContaining(['b', 'list']))
    // Past the end: GPUI stops at the content's end (100), and so do the boxes.
    byId('list').scrollTop = 1000
    expect(byId('list').scrollTop).toBe(100)
    expect(byId('b').getBoundingClientRect().y).toBe(40)
    expect(byId('c').getBoundingClientRect().y).toBe(120)
  })
})

describe('document.elementsFromPoint', () => {
  test('topmost first: children over parents, later siblings over earlier, then <html>', async () => {
    app = mountHeadless()
    build(app, app.document.body, [
      { id: 'under', children: [{ id: 'child' }] },
      { id: 'over' },
    ])
    await app.settle()
    place({
      under: { x: 0, y: 0, width: 200, height: 200 },
      child: { x: 0, y: 0, width: 100, height: 100 },
      over: { x: 50, y: 50, width: 100, height: 100 },
    })
    await app.settle()
    expect(ids(app.document.elementsFromPoint(60, 60))).toEqual(['over', 'child', 'under', 'html'])
    expect(ids(app.document.elementsFromPoint(10, 10))).toEqual(['child', 'under', 'html'])
    expect(app.document.elementFromPoint(160, 10)?.getAttribute('id')).toBe('under')
    // Outside everything painted: nothing (the fake gives the body no box).
    expect(app.document.elementsFromPoint(500, 500)).toEqual([])
  })

  test('pointer-events: none is skipped, and inherited, unless a child turns it back on', async () => {
    app = mountHeadless()
    build(app, app.document.body, [
      { id: 'target' },
      { id: 'ghost', style: 'pointer-events: none', children: [{ id: 'ghost-text' }, { id: 'handle', style: 'pointer-events: auto' }] },
      { id: 'gone', style: 'display: none' },
      { id: 'unseen', style: 'visibility: hidden' },
    ])
    await app.settle()
    const all = { x: 0, y: 0, width: 100, height: 100 }
    place({ target: all, ghost: all, 'ghost-text': all, handle: { x: 0, y: 0, width: 10, height: 10 }, gone: all, unseen: all })
    await app.settle()
    expect(ids(app.document.elementsFromPoint(50, 50))).toEqual(['target', 'html'])
    expect(ids(app.document.elementsFromPoint(5, 5))).toEqual(['handle', 'target', 'html'])
  })

  test('a box re-homed under its containing block paints over that block\'s later children', async () => {
    app = mountHeadless()
    // In DOM order `after` comes later than the popover, but the popover is
    // absolute: GPUI draws it under `panel`, its containing block, last.
    build(app, app.document.body, [{
      id: 'panel', style: 'position: relative', children: [
        { id: 'wrapper', children: [{ id: 'popover', style: 'position: absolute; top: 0; left: 0' }] },
        { id: 'after' },
      ],
    }])
    await app.settle()
    const panel = app.gpui.node(byId('panel').nativeId)
    expect(panel.children.at(-1)).toBe(byId('popover').nativeId)
    place({
      panel: { x: 0, y: 0, width: 300, height: 300 },
      wrapper: { x: 0, y: 0, width: 300, height: 100 },
      popover: { x: 0, y: 0, width: 200, height: 200 },
      after: { x: 0, y: 100, width: 300, height: 100 },
    })
    await app.settle()
    expect(ids(app.document.elementsFromPoint(50, 150))).toEqual(['popover', 'after', 'panel', 'html'])
  })

  test('a scroll area clips: what is scrolled out of its view is never under the pointer', async () => {
    app = mountHeadless()
    build(app, app.document.body, [
      { id: 'list', style: 'overflow-y: scroll; height: 100px', children: [{ id: 'first' }, { id: 'second' }] },
      { id: 'below' },
    ])
    await app.settle()
    place({
      list: { x: 0, y: 0, width: 200, height: 100 },
      first: { x: 0, y: 0, width: 200, height: 80 },
      second: { x: 0, y: 80, width: 200, height: 80 },
      below: { x: 0, y: 100, width: 200, height: 100 },
    })
    await app.settle()
    // `second` runs past the list's bottom edge, over `below`: clipped there.
    expect(ids(app.document.elementsFromPoint(10, 90))).toEqual(['second', 'list', 'html'])
    expect(ids(app.document.elementsFromPoint(10, 120))).toEqual(['below', 'html'])
  })
})

describe('when GPUI stops answering (a window that isn\'t painting, on Linux)', () => {
  test('one miss, then no queries for a back-off; answers from the last layout; back on input', async () => {
    let clock = 0
    app = mountHeadless({ now: () => clock })
    build(app, app.document.body, [{ id: 'a' }])
    await app.settle()
    place({ a: { x: 5, y: 5, width: 50, height: 50 } })
    await app.settle()
    expect(byId('a').getBoundingClientRect()).toMatchObject({ x: 5, y: 5, width: 50, height: 50 })

    // gpuix's live window, not painting: every geometry query times out
    // (2 s, on the clock here) and throws.
    let answering = false
    const calls = { tree: 0, size: 0, scroll: 0 }
    const renderer = app.fake.renderer as typeof app.fake.renderer & { getAutomationTree: () => string }
    const timesOut = <T>(kind: keyof typeof calls, real: () => T) => (): T => {
      calls[kind]++
      if (answering) return real()
      clock += 2000
      throw new Error('Timed out after 2 seconds waiting for the automation bounds query')
    }
    const [tree, size] = [renderer.getAutomationTree.bind(renderer), renderer.getWindowSize!.bind(renderer)]
    renderer.getAutomationTree = timesOut('tree', tree)
    renderer.getWindowSize = timesOut('size', size)
    renderer.getScrollOffset = timesOut('scroll', () => [0, 0])

    // The app changes, and asks: the first query misses...
    build(app, app.document.body, [{ id: 'b' }])
    await app.settle()
    place({ b: { x: 0, y: 100, width: 50, height: 50 } })
    const missed = Object.values(calls).reduce((sum, n) => sum + n, 0)
    expect(missed).toBe(1)
    // ...and then nothing asks GPUI again, however many frames and reads.
    for (let frame = 0; frame < 30; frame++) {
      clock += 16
      byId('a').getBoundingClientRect()
      byId('b').getBoundingClientRect()
      app.document.elementsFromPoint(10, 10)
      void byId('a').scrollTop
      app.host.frame()
      app.host.drawn()
    }
    expect(Object.values(calls).reduce((sum, n) => sum + n, 0)).toBe(missed)
    // What the APIs say meanwhile: the last layout GPUI gave; an element it
    // never gave a box has none (zeros, as an element that isn't rendered).
    expect(byId('a').getBoundingClientRect()).toMatchObject({ x: 5, y: 5, width: 50, height: 50 })
    expect(byId('b').getBoundingClientRect()).toMatchObject({ x: 0, y: 0, width: 0, height: 0 })
    expect(ids(app.document.elementsFromPoint(10, 10))).toEqual(['a', 'html'])
    expect(app.host.geometry()).toMatchObject({ misses: 1, holding: true })

    // A 2 s miss holds queries for three times that, 6 s; then, with no
    // input, nobody's looking: still nothing.
    const total = () => Object.values(calls).reduce((sum, n) => sum + n, 0)
    clock += 6000
    app.host.drawn()
    byId('b').getBoundingClientRect()
    expect(total()).toBe(missed)
    // Input: someone's using the window, so GPUI is asked again. Still not
    // painting: a second miss, and a back-off twice as long (12 s), which
    // input doesn't cut short.
    await app.press('a')
    expect(total()).toBe(missed + 1)
    clock += 6000
    await app.press('a')
    expect(total()).toBe(missed + 1)

    // After it, input again, and GPUI paints again.
    clock += 6000
    answering = true
    await app.press('a')
    app.host.relayout()
    app.host.drawn()
    expect(byId('b').getBoundingClientRect()).toMatchObject({ x: 0, y: 100, width: 50, height: 50 })
    expect(app.host.geometry()).toMatchObject({ holding: false })
  })

  test('a layout half a second old is read again when asked for, moved or not', async () => {
    let clock = 0
    app = mountHeadless({ now: () => clock })
    build(app, app.document.body, [{ id: 'a' }])
    await app.settle()
    place({ a: { x: 0, y: 0, width: 10, height: 10 } })
    await app.settle()
    expect(byId('a').getBoundingClientRect().width).toBe(10)
    // GPUI moved it by itself (an image arrived): the host wasn't told.
    app.gpui.setBounds(byId('a').nativeId, { x: 0, y: 0, width: 20, height: 10 })
    app.host.drawn()
    expect(byId('a').getBoundingClientRect().width).toBe(10)
    clock += MAX_AGE_MS
    app.host.drawn()
    expect(byId('a').getBoundingClientRect().width).toBe(20)
  })
})
