// Real adapter and BigList view on the fake renderer: query timing is
// deterministic here; these controls do not assert native paint or speed.
import { afterEach, expect, test } from 'bun:test'

import { loadExample } from '../../../examples/support/example.ts'
import { ROW_HEIGHT } from '../../../examples/big-list/main.ts'
import { TRACKS } from '../../../examples/big-list/library.ts'
import { type Headless, mountHeadless } from './support.ts'
import type { NativeElement } from '../src/index.ts'

let app: Headless | undefined
afterEach(() => { app?.close(); app = undefined })

const example = await loadExample('big-list')
for (const cost of [0, 8, 25]) test(`BigList receives its actual wheel position when scroll reads take ${cost} ms`, async () => {
  let clock = 0
  app = mountHeadless({ css: example.css, viewport: { width: 1024, height: 653 }, now: () => clock })
  const getter = app.fake.renderer.getScrollOffset!
  app.fake.renderer.getScrollOffset = (...args) => {
    const value = Reflect.apply(getter, app!.fake.renderer, args)
    clock += cost
    return value
  }
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise(resolve => setTimeout(resolve, 0))
      clock += 10
      app!.host.frame(); app!.host.flush(); app!.host.drawn()
    }
  }
  example.start(app.container)
  await settle(); await settle()
  const list = app.document.getElementById('tracks')!
  const rows = () => app!.document.querySelectorAll('.row').map(row => row.querySelector('.cell-title')!.textContent)
  app.gpui.setBounds(app.document.body.nativeId, { x: 0, y: 0, width: 1024, height: 653 })
  app.gpui.setBounds(list.nativeId, { x: 20, y: 150, width: 900, height: 371 })
  clock += 1000
  app.host.relayout(); app.host.drawn()
  const expected = TRACKS[Math.floor(3000 / ROW_HEIGHT) + 2]!.title
  expect(rows()).not.toContain(expected)
  const positions: Array<number> = []
  list.addEventListener('scroll', () => positions.push(list.scrollTop))
  app.gpui.setScrollOffset(list.nativeId, 0, -3000)
  clock += 1000
  app.host.dispatch({ eventType: 'scroll', elementId: list.nativeId, x: 100, y: 250, deltaY: -3000, deltaX: 0 })
  await settle()
  expect(positions).toEqual([3000])
  expect(rows()).toContain(expected)
})

const scene = async (bounds = true) => {
  let clock = 0
  let cost = 0
  let fail = false
  app = mountHeadless({ now: () => clock, css: 'body { overflow: hidden } .area { overflow: scroll }' })
  const mounted = app
  const outer = app.document.createElement('div')
  const inner = app.document.createElement('div')
  const content = app.document.createElement('div')
  outer.setAttribute('class', 'area'); inner.setAttribute('class', 'area')
  content.textContent = 'Content'
  app.document.body.appendChild(outer)
  outer.appendChild(inner); inner.appendChild(content)
  const log: Array<string> = []
  inner.addEventListener('wheel', () => log.push('wheel-inner'))
  outer.addEventListener('wheel', () => log.push('wheel-outer'))
  const positions = new Map<NativeElement, Array<number>>([[inner, []], [outer, []]])
  for (const element of [inner, outer]) element.addEventListener('scroll', () => positions.get(element)!.push(element.scrollTop))
  await app.settle()
  if (bounds) {
    app.gpui.setBounds(app.document.body.nativeId, { x: 0, y: 0, width: 1024, height: 768 })
    app.gpui.setBounds(outer.nativeId, { x: 0, y: 0, width: 300, height: 200 })
    app.gpui.setBounds(inner.nativeId, { x: 50, y: 50, width: 100, height: 100 })
    app.gpui.setBounds(content.nativeId, { x: 50, y: 50, width: 400, height: 400 })
    app.host.relayout()
  }
  // Seed the public caches without spending a slow-query budget.
  expect(inner.scrollTop).toBe(0); expect(outer.scrollTop).toBe(0)
  const reads: Array<number> = []
  const getter = app.fake.renderer.getScrollOffset!
  app.fake.renderer.getScrollOffset = function (...args) {
    expect(this).toBe(mounted.fake.renderer)
    reads.push(args[0])
    clock += cost
    if (fail) throw failure
    return Reflect.apply(getter, this, args)
  }
  const failure = new Error('original native scroll read failed')
  const wheel = (element = inner) => {
    clock++
    mounted.host.dispatch({ eventType: 'scroll', elementId: element.nativeId, x: 60, y: 60, deltaY: -50, deltaX: 0 })
  }
  const draw = (ms = 10) => {
    clock += ms
    mounted.host.frame(); mounted.host.flush(); mounted.host.drawn()
  }
  return { mounted, outer, inner, content, positions, reads, log, wheel, draw, failure,
    cost: (ms: number) => { cost = ms }, fail: (value: boolean) => { fail = value },
    advance: (ms: number) => { clock += ms },
    hold: () => { mounted.document.body.scrollTop },
  }
}

test('held reads coalesce wheel notifications until the original getter succeeds', async () => {
  const s = await scene()
  s.cost(8); s.hold()
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -50); s.wheel()
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -100); s.wheel()
  expect(s.positions.get(s.inner)).toEqual([])
  const before = s.reads.length
  s.draw(10)
  expect(s.reads.length).toBe(before)
  expect(s.positions.get(s.inner)).toEqual([])
  s.draw(30)
  expect(s.positions.get(s.inner)).toEqual([100])
  s.draw(30); s.wheel(); s.draw(30)
  expect(s.positions.get(s.inner)).toEqual([100])
})

test('failed reads retain the notification and the original input/backoff policy', async () => {
  const s = await scene()
  s.fail(true)
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -150)
  expect(() => s.wheel()).not.toThrow()
  expect(s.mounted.host.geometry().holding).toBe(true)
  expect(s.positions.get(s.inner)).toEqual([])
  s.fail(false)
  const before = s.reads.length
  s.draw(1100)
  expect(s.reads.length).toBe(before) // Backoff elapsed, but no new input.
  expect(s.positions.get(s.inner)).toEqual([])
  s.wheel()
  expect(s.positions.get(s.inner)).toEqual([150])
  expect(s.mounted.host.geometry().holding).toBe(false)
})

test('nested targets retain independent pending offsets and one bubbling wheel', async () => {
  const s = await scene()
  s.cost(8)
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -50)
  s.mounted.gpui.setScrollOffset(s.outer.nativeId, 0, -25)
  s.wheel(s.inner); s.wheel(s.outer)
  expect(s.log).toEqual(['wheel-inner', 'wheel-outer'])
  expect(s.positions.get(s.inner)).toEqual([50])
  expect(s.positions.get(s.outer)).toEqual([])
  s.draw(30)
  expect(s.positions.get(s.outer)).toEqual([25])
})

test('clamped native offsets, duplicate wheels and programmatic echoes do not invent scrolling', async () => {
  const s = await scene()
  s.mounted.fake.renderer.scrollTo!(s.inner.nativeId, 0, -999)
  s.wheel()
  expect(s.positions.get(s.inner)).toEqual([300])
  s.wheel(); s.draw()
  expect(s.positions.get(s.inner)).toEqual([300])
  s.cost(8); s.hold(); s.wheel()
  s.inner.scrollTop = 120
  s.draw(30)
  expect(s.positions.get(s.inner)).toEqual([300])
  expect(s.inner.scrollTop).toBe(120)
})

test('a scroll listener may dispatch another wheel without losing or repeating its notification', async () => {
  const s = await scene()
  s.inner.addEventListener('scroll', () => {
    if (s.positions.get(s.inner)!.at(-1) === 50) {
      s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -100)
      s.wheel()
    }
  })
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -50)
  s.wheel(); s.draw()
  expect(s.positions.get(s.inner)).toEqual([50, 100])
})

test('a wheel listener may programmatically scroll, remove the area or close the host', async () => {
  const s = await scene()
  s.inner.addEventListener('wheel', () => { s.inner.scrollTop = 120 })
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -50)
  s.wheel()
  expect(s.positions.get(s.inner)).toEqual([])
  expect(s.inner.scrollTop).toBe(120)
  s.inner.addEventListener('wheel', () => { s.inner.remove() })
  expect(() => s.wheel()).not.toThrow()
  s.draw()
  expect(s.positions.get(s.inner)).toEqual([])
  s.mounted.close()
  expect(s.mounted.gpui.retainedCount()).toBe(0)
})

test('removed subtrees and detach release held notifications without new native reads or timers', async () => {
  const s = await scene()
  s.cost(8); s.hold(); s.wheel()
  s.outer.remove()
  const before = s.reads.length
  s.draw(100)
  expect(s.reads.length).toBe(before)
  expect(s.positions.get(s.inner)).toEqual([])
  s.mounted.close()
  expect(s.mounted.gpui.retainedCount()).toBe(0)
  s.draw(100)
  expect(s.reads.length).toBe(before)
})

test('unknown geometry still samples the genuine scroll target and uses the original wheel fallback', async () => {
  const s = await scene(false)
  s.cost(25)
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -75)
  s.wheel()
  expect(s.positions.get(s.inner)).toEqual([75])
  expect(s.log).toEqual(['wheel-inner', 'wheel-outer'])
})

test('a successful public getter after a held wheel is reconciled on the next existing draw', async () => {
  const s = await scene()
  s.cost(8); s.hold()
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -90); s.wheel()
  expect(s.positions.get(s.inner)).toEqual([])
  s.draw(10)
  s.advance(30)
  expect(s.inner.scrollTop).toBe(90)
  expect(s.positions.get(s.inner)).toEqual([])
  const before = s.reads.length
  s.draw(0)
  expect(s.positions.get(s.inner)).toEqual([90])
  expect(s.reads.length).toBe(before)
})

test('a read that reenters native dispatch cannot overwrite the newer notification', async () => {
  const s = await scene(false)
  const getter = s.mounted.fake.renderer.getScrollOffset!
  let reenter = true
  s.mounted.fake.renderer.getScrollOffset = function (...args) {
    const value = Reflect.apply(getter, this, args)
    s.advance(8)
    if (args[0] === s.inner.nativeId && reenter) {
      reenter = false
      s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -200)
      s.wheel()
    }
    return value
  }
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -100)
  s.wheel()
  expect(s.positions.get(s.inner)).toEqual([200])
  expect(s.inner.scrollTop).toBe(200) // The slow outer read still holds the guard.
  s.draw()
  s.wheel()
  expect(s.positions.get(s.inner)).toEqual([200])
})

test('a reentrant programmatic scroll survives the older native read returning', async () => {
  const s = await scene(false)
  const getter = s.mounted.fake.renderer.getScrollOffset!
  let reenter = true
  s.mounted.fake.renderer.getScrollOffset = function (...args) {
    const value = Reflect.apply(getter, this, args)
    s.advance(8)
    if (args[0] === s.inner.nativeId && reenter) {
      reenter = false
      s.inner.scrollTop = 200
    }
    return value
  }
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -100)
  s.wheel()
  expect(s.inner.scrollTop).toBe(200)
  expect(s.positions.get(s.inner)).toEqual([])
})

test('a newer scroll during a programmatic native read keeps its cache and announcement', async () => {
  const s = await scene(false)
  const getter = s.mounted.fake.renderer.getScrollOffset!
  let reenter = true
  s.mounted.fake.renderer.getScrollOffset = function (...args) {
    const value = Reflect.apply(getter, this, args)
    s.advance(8)
    if (args[0] === s.inner.nativeId && reenter) {
      reenter = false
      s.inner.scrollTop = 200
    }
    return value
  }
  s.inner.scrollTo({ left: 0, top: 100 })
  expect(s.inner.scrollTop).toBe(200)
  s.wheel()
  expect(s.positions.get(s.inner)).toEqual([])
})

test('a deferred scroll listener closing the host ends draw work before further native reads', async () => {
  const s = await scene(false)
  let closed = false
  let readsAfterClose = 0
  const size = s.mounted.fake.renderer.getWindowSize!
  const getter = s.mounted.fake.renderer.getScrollOffset!
  s.mounted.fake.renderer.getWindowSize = function () {
    if (closed) readsAfterClose++
    return size.call(this)
  }
  s.mounted.fake.renderer.getScrollOffset = function (...args) {
    if (closed) readsAfterClose++
    return Reflect.apply(getter, this, args)
  }
  s.cost(8); s.hold()
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -150)
  s.wheel()
  expect(s.positions.get(s.inner)).toEqual([])
  s.inner.addEventListener('scroll', () => { s.mounted.close(); closed = true })
  s.draw(30)
  expect(closed).toBe(true)
  expect(s.mounted.gpui.retainedCount()).toBe(0)
  expect(readsAfterClose).toBe(0)
  s.draw(30)
  expect(readsAfterClose).toBe(0)
})

test('a failed batch retains pending notifications and propagates the same error until an owned retry', async () => {
  const s = await scene(false)
  s.cost(8); s.hold(); s.wheel()
  s.mounted.gpui.setScrollOffset(s.inner.nativeId, 0, -180)
  const apply = s.mounted.fake.renderer.applyBatch
  const failure = new Error('owned batch failure')
  s.mounted.fake.renderer.applyBatch = () => { throw failure }
  s.content.textContent = 'Changed'
  try { s.mounted.host.flush(); throw new Error('expected batch to fail') }
  catch (error) { expect(error).toBe(failure) }
  expect(s.positions.get(s.inner)).toEqual([])
  s.mounted.fake.renderer.applyBatch = apply
  s.draw(30)
  expect(s.positions.get(s.inner)).toEqual([180])
})

test('an unavailable getter stays pending; the original successful null result means zero', async () => {
  const s = await scene(false)
  const getter = s.mounted.fake.renderer.getScrollOffset!
  s.cost(8); s.hold(); s.wheel()
  s.mounted.fake.renderer.getScrollOffset = undefined
  s.draw(30)
  expect(s.positions.get(s.inner)).toEqual([])
  s.mounted.fake.renderer.getScrollOffset = () => null
  s.draw()
  expect(s.positions.get(s.inner)).toEqual([0])
  s.mounted.fake.renderer.getScrollOffset = getter
  s.wheel(); s.draw()
  expect(s.positions.get(s.inner)).toEqual([0])
})

test('pending work is discarded when the target no longer scrolls or a listener detaches it', async () => {
  const s = await scene(false)
  s.cost(8); s.hold(); s.wheel()
  s.inner.style.overflow = 'hidden'
  s.draw(30)
  expect(s.positions.get(s.inner)).toEqual([])
  await Promise.resolve() // A new wheel task, rather than the ancestor echo.
  s.outer.addEventListener('wheel', () => s.mounted.close())
  expect(() => s.wheel(s.outer)).not.toThrow()
  expect(s.positions.get(s.outer)).toEqual([])
  expect(s.mounted.gpui.retainedCount()).toBe(0)
})
