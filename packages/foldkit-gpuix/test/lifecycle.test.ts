// FoldKit's lifecycle on gpuix (FKN-16): Mounts, afterCommit, the crash
// view, Submodels, and taking everything down with `detach`. Then the
// browser APIs the document stands in for, each of which either behaves or
// says plainly that it doesn't (the list is in packages/foldkit-gpuix/README.md).
import type { NativeRenderer } from '@gpuix/native/host'
import { createRendererState } from '@gpuix/native/host'
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Effect, Schema } from 'effect'
import { Command, Mount, Render, Runtime } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { attachGpuix } from '../src/index.ts'
import { METAL, mountHeadless, openMetal } from './support.ts'

type Headless = ReturnType<typeof mountHeadless>
let app: Headless | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

// An app with a Mount whose release is observable, a Command that waits for
// the commit, and a Message that crashes update.
const Message = defineMessageUnion({
  Toggled: {}, Mounted: {}, Committed: { found: Schema.Boolean }, Asked: {}, Crashed: {},
})
type Message = typeof Message.Type
const Model = Schema.Struct({ shown: Schema.Boolean, mounted: Schema.Number, found: Schema.Boolean })
type Model = typeof Model.Type

const log: Array<string> = []
const Watch = Mount.define('Watch', {
  messages: [Message.Mounted],
  execute: ({ element }: { element: Element }) =>
    Effect.acquireRelease(
      Effect.sync(() => log.push(`mounted ${element.getAttribute('id')}`)),
      () => Effect.sync(() => log.push('released')),
    ).pipe(Effect.as(Message.Mounted())),
})
const FindLate = Command.define('FindLate', {
  messages: [Message.Committed],
  execute: Render.afterCommit.pipe(
    Effect.andThen(Effect.sync(() => Message.Committed({ found: document.getElementById('late') !== null }))),
  ),
})

const update = (model: Model, message: Message) =>
  Message.match(message, {
    Toggled: () => ({ model: { ...model, shown: !model.shown } }),
    Mounted: () => ({ model: { ...model, mounted: model.mounted + 1 } }),
    Asked: () => ({ model: { ...model, shown: true }, commands: [FindLate()] }),
    Committed: ({ found }) => ({ model: { ...model, found } }),
    Crashed: (): never => {
      throw new Error('boom')
    },
  })
const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.div([], [
    h.button([h.Id('toggle'), h.OnClick(Message.Toggled())], ['Toggle']),
    h.button([h.Id('ask'), h.OnClick(Message.Asked())], ['Ask']),
    h.button([h.Id('crash'), h.OnClick(Message.Crashed())], ['Crash']),
    h.p([], [`mounted ${model.mounted}, found ${model.found}`]),
    ...(model.shown ? [h.div([h.Id('late'), h.OnMount(Watch())], ['late'])] : []),
  ])

const start = (mounted: Pick<Headless, 'own' | 'container'>) =>
  mounted.own(Runtime.embed(Runtime.makeElement({
    Model, init: () => ({ model: { shown: false, mounted: 0, found: false } }), update, view,
    container: mounted.container,
    crash: { view: ({ error }: { error: Error }, h: HtmlBuilder<never>) => h.div([h.Id('crashed')], [`Crashed: ${error.message}`]), report: () => {} },
  } as never)))

const open = async () => {
  log.length = 0
  app = mountHeadless()
  start(app)
  await app.settle()
  return app
}

describe('the FoldKit lifecycle on gpuix', () => {
  test('a Mount starts when its element is drawn and is released when it goes', async () => {
    const app = await open()
    await app.click('Toggle')
    expect(log).toEqual(['mounted late'])
    expect(app.texts()).toContain('mounted 1, found false')
    await app.click('Toggle')
    expect(log).toEqual(['mounted late', 'released'])
  })

  test('Render.afterCommit resumes once the patch is in the document', async () => {
    const app = await open()
    await app.click('Ask')
    await app.settle()
    expect(app.texts()).toContain('mounted 1, found true')
  })

  test('a crash in update draws the crash view', async () => {
    const app = await open()
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await app.click('Crash')
      await app.settle()
    } finally {
      quiet.mockRestore()
    }
    expect(app.texts()).toContain('Crashed: boom')
  })

  test('detach: the runtime is disposed (its Mounts released), the native tree freed, the globals restored', async () => {
    const before = (globalThis as { document?: unknown }).document
    log.length = 0
    const mounted = mountHeadless()
    expect((globalThis as { document?: unknown }).document).toBe(mounted.document)
    start(mounted)
    await mounted.settle()
    await mounted.click('Toggle')
    expect(mounted.gpui.reachableCount()).toBeGreaterThan(5)
    const body = mounted.document.body
    mounted.close()
    expect(log).toEqual(['mounted late', 'released'])
    expect(mounted.gpui.retainedCount()).toBe(0)
    expect(body.nativeId).toBe(0)
    expect(mounted.host.nodeFor(1_000_000)).toBeUndefined()
    expect((globalThis as { document?: unknown }).document).toBe(before)
    // Nothing more reaches GPUI: no ops after the last batch.
    const batches = mounted.gpui.batches.length
    mounted.document.body.appendChild(mounted.document.createElement('div'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(mounted.gpui.batches.length).toBe(batches)
    // Twice is fine.
    mounted.close()
  })

  test('100 mount/dispose cycles: no native-node or handler growth', async () => {
    const first = mountHeadless()
    const renderer = first.fake.renderer
    first.close()
    let mounted: { nodes: number; handlers: number } | undefined
    for (let cycle = 1; cycle <= 100; cycle++) {
      log.length = 0
      const attached = attachGpuix(renderer)
      start(attached)
      for (let i = 0; i < 4; i++) {
        await new Promise(resolve => setTimeout(resolve, 0))
        attached.host.frame()
        attached.host.flush()
        attached.host.drawn()
      }
      const now = { nodes: first.gpui.retainedCount(), handlers: createRendererState(renderer).current()!.eventHandlers.size }
      mounted ??= now
      expect(now).toEqual(mounted)
      attached.detach()
      expect(first.gpui.retainedCount()).toBe(0)
      expect(createRendererState(renderer).current()).toBeUndefined()
    }
    expect(mounted!.nodes).toBeGreaterThan(5)
    expect(mounted!.handlers).toBeGreaterThan(2)
  })

  test("requestAnimationFrame runs before GPUI draws, and stops at detach", async () => {
    const opened = await open()
    const ran: Array<string> = []
    window.requestAnimationFrame(() => ran.push('a'))
    const cancelled = window.requestAnimationFrame(() => ran.push('cancelled'))
    window.cancelAnimationFrame(cancelled)
    expect(ran).toEqual([])
    opened.host.frame()
    expect(ran).toEqual(['a'])
    window.requestAnimationFrame(() => ran.push('after detach'))
    opened.close()
    app = undefined
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(ran).toEqual(['a'])
  })
})

describe('browser APIs: behave, or say they don\'t', () => {
  test('MutationObserver: childList, attributes, characterData, subtree, filters, batching', async () => {
    const app = await open()
    const root = app.document.createElement('section')
    app.document.body.appendChild(root)
    const seen: Array<string> = []
    const describe = (records: Array<MutationRecord>) => records.map(record =>
      record.type === 'childList' ? `childList +${record.addedNodes.length} -${record.removedNodes.length}`
        : record.type === 'attributes' ? `attributes ${record.attributeName} was ${record.oldValue}` : `characterData was ${record.oldValue}`)
    const observer = new MutationObserver(records => seen.push(describe(records).join(', ')))
    observer.observe(root as never, { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true })
    const child = app.document.createElement('p')
    root.appendChild(child)
    child.setAttribute('data-x', '1')
    child.setAttribute('data-x', '2')
    const text = app.document.createTextNode('hi')
    child.appendChild(text)
    text.data = 'ho'
    expect(seen).toEqual([])
    await Promise.resolve()
    expect(seen).toEqual(['childList +1 -0, attributes data-x was null, attributes data-x was 1, childList +1 -0, characterData was hi'])

    const filtered = new MutationObserver(records => seen.push(`filtered: ${describe(records).join(', ')}`))
    filtered.observe(child as never, { attributeFilter: ['aria-hidden'] })
    child.setAttribute('data-x', '3')
    child.setAttribute('aria-hidden', 'true')
    observer.disconnect()
    root.removeChild(child)
    await Promise.resolve()
    expect(seen.at(-1)).toBe('filtered: attributes aria-hidden was null')
    expect(observer.takeRecords()).toEqual([])
    filtered.disconnect()
  })

  test('history: push, replace, back and forward move location and fire popstate', async () => {
    await open()
    const states: Array<unknown> = []
    window.addEventListener('popstate', event => states.push((event as PopStateEvent).state))
    history.pushState({ page: 2 }, '', '/two')
    history.pushState({ page: 3 }, '', '/three?q=1')
    expect(location.pathname).toBe('/three')
    expect(location.search).toBe('?q=1')
    history.replaceState({ page: 33 }, '', '/three-b')
    expect(history.length).toBe(3)
    history.back()
    expect(location.pathname).toBe('/two')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(states).toEqual([{ page: 2 }])
    history.forward()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(states).toEqual([{ page: 2 }, { page: 33 }])
    expect(history.state).toEqual({ page: 33 })
  })

  test('storage: sessionStorage in memory; localStorage in memory with one warning', async () => {
    await open()
    sessionStorage.setItem('a', '1')
    expect(sessionStorage.getItem('a')).toBe('1')
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      localStorage.setItem('b', '2')
      localStorage.setItem('c', '3')
      expect(localStorage.getItem('b')).toBe('2')
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
    } finally {
      warn.mockRestore()
    }
  })

  test('ResizeObserver and IntersectionObserver are absent, so feature detection says so', async () => {
    await open()
    expect(typeof ResizeObserver).toBe('undefined')
    expect(typeof IntersectionObserver).toBe('undefined')
  })

  test('matchMedia: widths against the window, a desktop pointer, no preferences', async () => {
    app = mountHeadless({ viewport: { width: 800, height: 600 } })
    await app.settle()
    expect(matchMedia('(min-width: 640px)').matches).toBe(true)
    expect(matchMedia('(min-width: 1024px)').matches).toBe(false)
    expect(matchMedia('screen and (max-width: 50rem)').matches).toBe(true)
    expect(matchMedia('(hover: hover) and (pointer: fine)').matches).toBe(true)
    expect(matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
    expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(false)
    expect(matchMedia('(orientation: landscape)').matches).toBe(true)
    expect(matchMedia('(monochrome)').matches).toBe(false)
  })

  test('getSelection is GPUI\'s selection', async () => {
    await open()
    const selection = getSelection()!
    expect(selection.toString()).toBe('')
    expect(selection.rangeCount).toBe(0)
  })
})

describe.skipIf(!METAL)('detach on real GPUI (Metal)', () => {
  test('detach leaves gpuix\'s retained element count at zero', async () => {
    log.length = 0
    const metal = await openMetal('lifecycle', { width: 320, height: 240 })
    metal.own(Runtime.embed(Runtime.makeElement({
      Model, init: () => ({ model: { shown: true, mounted: 0, found: false } }), update, view, container: metal.container,
    } as never)))
    await metal.settle()
    expect(metal.renderer.getRetainedElementCount()).toBeGreaterThan(5)
    metal.close()
    metal.renderer.flush()
    expect(log).toEqual(['mounted late', 'released'])
    expect(metal.renderer.getRetainedElementCount()).toBe(0)
  })

  test('100 mount/dispose cycles on one window: no native-node, handler or memory growth', async () => {
    const { TestRenderer } = await import('@gpuix/native/testing')
    const size = { width: 320, height: 240 }
    const renderer = new TestRenderer(size)
    const native = renderer as unknown as NativeRenderer
    const heap: Record<number, number> = {}
    let mounted: { nodes: number; handlers: number } | undefined
    const started = performance.now()
    for (let cycle = 1; cycle <= 100; cycle++) {
      log.length = 0
      const attached = attachGpuix(native, { viewport: size })
      attached.own(Runtime.embed(Runtime.makeElement({
        Model, init: () => ({ model: { shown: true, mounted: 0, found: false } }), update, view, container: attached.container,
      } as never)))
      for (let i = 0; i < 4; i++) {
        await new Promise(resolve => setTimeout(resolve, 0))
        attached.host.frame()
        attached.host.flush()
        renderer.flush()
        attached.host.drawn()
        renderer.dispatchNativeEvents()
      }
      const now = { nodes: renderer.getRetainedElementCount(), handlers: createRendererState(native).current()!.eventHandlers.size }
      mounted ??= now
      expect(now).toEqual(mounted)
      attached.detach()
      renderer.flush()
      expect(log).toEqual(['mounted late', 'released'])
      expect(renderer.getRetainedElementCount()).toBe(0)
      expect(createRendererState(native).current()).toBeUndefined()
      if (cycle === 10 || cycle === 100) {
        Bun.gc(true)
        heap[cycle] = process.memoryUsage().heapUsed
      }
    }
    const grew = (heap[100]! - heap[10]!) / 1024 / 1024
    console.log(`100 mount/dispose cycles on Metal: ${mounted!.nodes} native nodes and ${mounted!.handlers} handlers while mounted, 0 after each; heap ${grew.toFixed(2)} MB from cycle 10 to 100 (after GC); ${((performance.now() - started) / 100).toFixed(1)} ms per cycle`)
    // The M1 budget: no growth beyond 20 MB residual after GC.
    expect(grew).toBeLessThan(20)
  }, 60_000)
})
