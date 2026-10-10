import { describe, expect, test } from 'bun:test'
import { Effect, Layer, Option, Schema } from 'effect'
import { Runtime } from 'foldkit'
import type { Html } from 'foldkit/html'
import { given, scene, tap } from 'foldkit/scene'

import { start } from '../app'
import { STORAGE_KEY } from '../constant'
import { createEmptyGrid } from '../grid'
import { Flags, init } from '../main'
import { Message } from '../message'
import { type Model, Model as ModelSchema, SavedCanvasJsonString } from '../model'
import { currentPaletteTheme } from '../palette'
import { update } from '../update'
import { subscriptions } from '../subscription'
import { createHistoryPanelView, historyPanelView } from './history'
import { createView, view } from './view'

const initial = (size = 8): Model => ({
  ...init(Flags.make({ maybeSavedCanvas: Option.none() })).model,
  grid: createEmptyGrid(size),
  gridSize: size,
})
const next = (model: Model, message: Message): Model => update(model, message).model
const stroke = (model: Model, x = 0, y = 0) =>
  next(next(model, Message.PressedCell({ x, y })), Message.ReleasedMouse())
const withHistory = (size = 8, count = 6) => {
  let model = initial(size)
  for (let i = 0; i < count; i++) model = stroke(model, i % size, Math.floor(i / size) % size)
  return model
}
const entries = (html: Html): Html[] => {
  const found: NonNullable<Html>[] = []
  const visit = (node: Html) => {
    if (node === null) return
    const label = node.children?.[1]
    const textNode = typeof label === 'object' && label !== null ? label.children?.[0] : undefined
    const text = typeof textNode === 'string' ? textNode : textNode?.text
    if (typeof label === 'object' && label !== null &&
      label.sel === 'span' && /^(Current|Back \d+|Forward \d+)$/.test(String(text))) {
      found.push(node)
    }
    for (const child of node.children ?? []) if (typeof child === 'object' && child !== null) visit(child)
  }
  visit(html)
  return found
}
const grids = (html: Html) => entries(html).map(entry => entry!.children![0] as NonNullable<Html>)

// Scene installs real FoldKit render frames without a window/native renderer.
const inspect = (panel: typeof historyPanelView, models: Model[], onRender?: (index: number) => void) => {
  const snapshots: Html[] = []
  let index = 0
  scene({
    update: (_: Model, __: Message) => ({ model: models[++index]! }),
    view: (model, h) => panel(model.undoStack, model.redoStack, model.grid, model.gridSize, currentPaletteTheme(model), h),
  }, given(models[0]!), tap(sim => { snapshots.push(sim.html); onRender?.(index) }),
  ...models.slice(1).flatMap(() => [
    { _tag: 'SubscriptionMessageStep' as const, message: Message.CompletedSaveCanvas() },
    tap<Model, Message>(sim => { snapshots.push(sim.html); onRender?.(index) }),
  ]))
  return snapshots.map(grids)
}

const wait = () => new Promise(resolve => setTimeout(resolve, 5))
let containerId = 0
const mount = async (model: Model, owned = true) => {
  const container = document.createElement('div')
  container.id = `history-reuse-${++containerId}`
  const host = document.createElement('section')
  host.append(container)
  document.body.append(host)
  const owner = createView()
  const snapshots: Html[][] = []
  let current = model
  let renders = 0
  let disposed = false
  const handle = Runtime.embed(Runtime.makeApplication({
    Model: ModelSchema,
    init: () => ({ model }),
    update: (model, message: Message) => {
      const result = update(model, message)
      current = result.model
      return result
    },
    view: (model, h) => {
      const result = (owned ? owner.view : view)(model, h)
      snapshots.push(grids(result.body))
      renders++
      return result
    },
    container,
    subscriptions,
    resources: Layer.effectDiscard(Effect.addFinalizer(() => Effect.sync(() => { owner.dispose(); disposed = true }))),
  }))
  const settle = async () => {
    let last = -1
    for (let i = 0; i < 40; i++) {
      await wait()
      if (renders > 0 && last === renders) return
      last = renders
    }
    throw new Error('render did not settle')
  }
  await settle()
  const liveContainer = () => host.firstElementChild! as HTMLElement
  const find = (label: string) => Array.from(liveContainer().querySelectorAll('span')).find(n => n.textContent === label)!.parentElement!
  return {
    get container() { return liveContainer() }, snapshots, owner, model: () => current, settle, find,
    close: async () => {
      handle.dispose()
      for (let i = 0; i < 40 && container.querySelector('h1') !== null; i++) await wait()
      expect(container.querySelector('h1')).toBeNull()
      expect(disposed).toBe(true)
      host.remove()
    },
  }
}

const snapshot = (app: Awaited<ReturnType<typeof mount>>) => ({
  html: app.container.innerHTML,
  model: JSON.stringify(app.model()),
})

describe('Pixel Art history grid reuse (DOM only)', () => {
  test('reuses distinct Current/Back slots; literal view rebuilds them', () => {
    const model = withHistory(32)
    const changed = { ...model, grid: stroke(model, 7, 0).grid }
    const owner = createHistoryPanelView()
    const [before, after] = inspect(owner.view, [model, changed])
    const [oldBefore, oldAfter] = inspect(historyPanelView, [model, changed])
    expect(after![0]).not.toBe(before![0])
    for (let i = 1; i < 7; i++) {
      expect(after![i]).toBe(before![i])
      expect(oldAfter![i]).not.toBe(oldBefore![i])
    }
    expect(new Set(before).size).toBe(7)
    owner.dispose()
  })

  test('evicts absent Back slots and rebuilds after disposal', () => {
    const model = withHistory()
    const owner = createHistoryPanelView()
    const [before, absent, restored] = inspect(owner.view, [model, { ...model, undoStack: [] }, model])
    expect(absent).toHaveLength(1)
    for (let i = 1; i < 7; i++) expect(restored![i]).not.toBe(before![i])
    const [mounted, remounted] = inspect(owner.view, [model, model], index => {
      if (index === 0) owner.dispose()
    })
    for (let i = 0; i < 7; i++) expect(remounted![i]).not.toBe(mounted![i])
    owner.dispose()
  })

  test('same grid in multiple slots and concurrent owners never share VNodes', () => {
    const grid = createEmptyGrid(8)
    const model = { ...initial(), grid, undoStack: [grid, grid, grid] }
    const a = createHistoryPanelView()
    const b = createHistoryPanelView()
    const [aa] = inspect(a.view, [model])
    const [bb] = inspect(b.view, [model])
    expect(new Set([...aa!, ...bb!]).size).toBe(8)
    a.dispose(); b.dispose()
  })

  test('theme, size, immutable replacement and Forward position shifts invalidate', () => {
    const model = withHistory()
    const owner = createHistoryPanelView()
    const themed = { ...model, paletteThemeIndex: 1 }
    const replaced = { ...model, grid: model.grid.map(row => [...row]) }
    const forward = { ...model, redoStack: [model.grid] }
    const result = inspect(owner.view, [model, themed, model, replaced, forward, forward, model, initial(16)])
    for (const i of [1, 2, 3, 4, 6, 7]) expect(result[i]![0]).not.toBe(result[i - 1]![0])
    // Forward is always literal, even when its inputs are unchanged.
    expect(result[5]![0]).not.toBe(result[4]![0])
    expect(result[5]![1]).toBe(result[4]![1])
    owner.dispose()
  })

  test('literal DOM/model/click/Enter/Space/focus agree through history shifts and truncation', async () => {
    const model = withHistory(8, 50)
    const literal = await mount(model, false)
    const reused = await mount(model)
    try {
      expect(snapshot(reused)).toEqual(snapshot(literal))
      const act = async (fn: (app: typeof reused) => void) => {
        fn(literal); fn(reused)
        await literal.settle(); await reused.settle()
        expect(snapshot(reused)).toEqual(snapshot(literal))
      }
      for (const key of ['Enter', ' ']) {
        await act(app => {
          const entry = app.find('Back 6')
          entry.focus()
          expect(document.activeElement).toBe(entry)
          const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
          expect(entry.dispatchEvent(event)).toBe(false)
        })
        await act(app => app.find('Forward 1').click())
      }
      await act(app => app.find('Back 1').click())
      await act(app => app.find('Forward 1').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
      await act(app => {
        const cell = app.container.querySelector('.cursor-crosshair')!.children[0]!.children[7]!
        cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      })
      await act(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
      expect(reused.model().undoStack.length).toBeLessThanOrEqual(50)
      expect(reused.model().redoStack).toHaveLength(0)
    } finally {
      await literal.close(); await reused.close()
    }
  })


  test('actual update paths preserve literal grid markup through clear/size/restore, maximum redo and truncation', () => {
    let model = withHistory(8, 50)
    const original = JSON.stringify(model)
    const models = [model]
    for (let i = 0; i < 50; i++) {
      model = next(model, Message.ClickedUndo()); models.push(model)
    }
    expect(model.redoStack).toHaveLength(50)
    for (let i = 0; i < 50; i++) {
      model = next(model, Message.ClickedRedo()); models.push(model)
    }
    model = stroke(model, 7, 7); models.push(model)
    expect(model.undoStack).toHaveLength(50)
    model = next(model, Message.ClickedClear()); models.push(model)
    model = next(model, Message.ClickedUndo()); models.push(model)
    model = next(model, Message.SelectedGridSize({ size: 16 }))
    model = next(model, Message.ConfirmedGridSizeChange()); models.push(model)
    model = next(model, Message.SelectedGridSize({ size: 8 })); models.push(model)
    expect(model.undoStack).toHaveLength(0)
    expect(model.redoStack).toHaveLength(0)
    const owner = createHistoryPanelView()
    try {
      const normalize = (node: Html): unknown => node === null ? null : ({
        sel: node.sel, text: node.text,
        attrs: node.data?.attrs, style: node.data?.style, props: node.data?.props,
        children: node.children?.map(child => typeof child === 'object' && child !== null ? normalize(child) : child),
      })
      const actual = inspect(owner.view, models)
      const oracle = inspect(historyPanelView, models)
      expect(actual.map(nodes => nodes.map(normalize))).toEqual(oracle.map(nodes => nodes.map(normalize)))
      expect(JSON.stringify(models[0])).toBe(original)
    } finally { owner.dispose() }
  })

  test('empty palette fallback remains literal and changing builder/dispatcher invalidates', () => {
    const model = withHistory()
    const owner = createHistoryPanelView()
    const theme = { name: 'empty', colors: [] }
    const panel: typeof historyPanelView = (undo, redo, grid, size, _, h) => owner.view(undo, redo, grid, size, theme, h)
    const literal: typeof historyPanelView = (undo, redo, grid, size, _, h) => historyPanelView(undo, redo, grid, size, theme, h)
    const [a, b] = inspect(panel, [model, { ...model, undoStack: [...model.undoStack] }])
    expect(b![1]).toBe(a![1])
    // A new Scene is a new dispatch owner, despite sharing the same builder.
    const [c] = inspect(panel, [model])
    expect(c![1]).not.toBe(b![1])
    const [d] = inspect(literal, [model])
    expect(c![1]!.children?.map(n => typeof n === 'object' && n !== null ? n.data?.style : null)).toEqual(d![1]!.children?.map(n => typeof n === 'object' && n !== null ? n.data?.style : null))
    const changedBuilder: typeof historyPanelView = (undo, redo, grid, size, _, h) => owner.view(undo, redo, grid, size, theme, { ...h })
    const [e, f] = inspect(changedBuilder, [model, model])
    expect(f![1]).not.toBe(e![1])
    owner.dispose()
  })


  test('normal model stroke creates fewer history ViewNodes at 32 in the installed runtime', () => {
    const model = withHistory(32)
    const pressed = next(model, Message.PressedCell({ x: 7, y: 0 }))
    const released = next(pressed, Message.ReleasedMouse())
    const observe = (owned: boolean) => {
      const owner = createView()
      const seen = new WeakSet<object>()
      const counts: number[] = []
      const times: number[] = []
      const chosen = owned ? owner.view : view
      scene({
        update: (_: Model, __: Message) => ({ model: released }),
        view: (model, h) => {
          const start = performance.now()
          const result = chosen(model, h)
          times.push(performance.now() - start)
          let count = 0
          const visit = (node: Html) => {
            if (node === null) return
            if (!seen.has(node)) { seen.add(node); count++ }
            for (const child of node.children ?? []) if (typeof child === 'object' && child !== null) visit(child)
          }
          for (const grid of grids(result.body)) visit(grid)
          counts.push(count)
          return result
        },
      }, given(pressed), { _tag: 'SubscriptionMessageStep', message: Message.ReleasedMouse() })
      owner.dispose()
      return { counts, times }
    }
    const pairs = []
    for (let i = 0; i < 3; i++) {
      const first = observe(i % 2 !== 0)
      const second = observe(i % 2 === 0)
      const literal = i % 2 === 0 ? first : second
      const reused = i % 2 === 0 ? second : first
      expect(literal.counts[1]! - reused.counts[1]!).toBe(6 * (32 * 32 + 1))
      pairs.push({ literal, reused })
    }
    console.log(JSON.stringify({ historyViewNodeObservation: pairs, limits: 'View only; not DOM allocation, paint, native or visual latency' }))
  })


  test('maximum redo, absent/reappearing history and clear agree in actual DOM patches', async () => {
    const history = withHistory(8, 50)
    const literal = await mount(history, false)
    const reused = await mount(history)
    try {
      const act = async (label: string, key?: string) => {
        for (const app of [literal, reused]) {
          const entry = app.find(label)
          if (key === undefined) entry.click()
          else entry.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        }
        await literal.settle(); await reused.settle()
        expect(snapshot(reused)).toEqual(snapshot(literal))
      }
      // Jump in six-entry steps, then return through fifty literal Forward entries.
      while (reused.model().undoStack.length > 0) {
        await act(`Back ${Math.min(reused.model().undoStack.length, 6)}`)
      }
      expect(reused.model().redoStack).toHaveLength(50)
      expect(reused.container.querySelectorAll('[style*="grid-template-columns"]')).toHaveLength(51)
      await act('Forward 50', ' ')
      expect(reused.model().redoStack).toHaveLength(0)
      expect(reused.model().undoStack).toHaveLength(50)
      for (const app of [literal, reused]) {
        Array.from(app.container.querySelectorAll('button')).find(n => n.textContent === 'Clear Canvas')!.click()
      }
      await literal.settle(); await reused.settle()
      expect(snapshot(reused)).toEqual(snapshot(literal))
      await act('Back 1', 'Enter')
      expect(reused.model().grid).toEqual(history.grid)
    } finally { await literal.close(); await reused.close() }
  })

  test('the real app.start uses ordinary Flags/save startup and public page lifecycle cleanup', async () => {
    const host = document.createElement('section')
    const container = document.createElement('div')
    container.id = `history-reuse-${++containerId}`
    host.append(container); document.body.append(host)
    const saved = withHistory(32)
    localStorage.setItem(STORAGE_KEY, Schema.encodeSync(SavedCanvasJsonString)({
      grid: saved.grid, gridSize: saved.gridSize, paletteThemeIndex: 1, selectedColorIndex: 4,
    }))
    // BrowserRuntime listens on globalThis; the normal DOM preload installs
    // window but leaves Bun's own global event target in place.
    const previousAdd = globalThis.addEventListener
    const previousRemove = globalThis.removeEventListener
    globalThis.addEventListener = window.addEventListener.bind(window)
    globalThis.removeEventListener = window.removeEventListener.bind(window)
    try {
      start(container)
      for (let i = 0; i < 80 && host.querySelector('h1') === null; i++) await wait()
      expect(host.querySelector('h1')?.textContent).toBe('PixelForge')
      expect(host.querySelector('.cursor-crosshair')?.children).toHaveLength(32)
      expect(host.querySelector('[style*="grid-template-columns"]')?.children).toHaveLength(1024)
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()
      window.dispatchEvent(new Event('pagehide'))
      for (let i = 0; i < 80 && host.querySelector('h1') !== null; i++) await wait()
      expect(host.firstElementChild).toBe(container)
      expect(host.querySelector('h1')).toBeNull()
    } finally {
      globalThis.addEventListener = previousAdd
      globalThis.removeEventListener = previousRemove
      host.remove()
    }
  })


  test('identical grid references have distinct attached elements in every slot and owner', async () => {
    const grid = createEmptyGrid(8)
    const model = { ...initial(), grid, undoStack: [grid, grid], redoStack: [grid] }
    const a = await mount(model)
    const b = await mount(model)
    try {
      const roots = [...a.snapshots[0]!, ...b.snapshots[0]!]
      expect(roots).toHaveLength(8)
      expect(new Set(roots.map(node => node!.elm)).size).toBe(8)
      for (const app of [a, b]) {
        const domGrids = app.snapshots[0]!.map(node => node!.elm as HTMLElement)
        for (const grid of domGrids) expect(app.container.contains(grid)).toBe(true)
        const cells = domGrids.flatMap(grid => Array.from(grid.children))
        expect(new Set(cells).size).toBe(4 * 8 * 8)
      }
    } finally { await a.close(); await b.close() }
  })


  test('theme switch/return, clear and resized empty board match literal DOM through real controls', async () => {
    const trace = async (owned: boolean) => {
      const app = await mount(withHistory(8), owned)
      const results = [snapshot(app)]
      try {
        for (const name of ['ISO50', 'Syntax']) {
          app.container.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click()
          await app.settle()
          const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(n => n.textContent === name || n.textContent === name + '✓')!
          option.click()
          await app.settle()
          results.push(snapshot(app))
        }
        Array.from(app.container.querySelectorAll('button')).find(n => n.textContent === 'Clear Canvas')!.click()
        await app.settle(); results.push(snapshot(app))
        // Clear leaves an empty board, so resizing uses the normal immediate path.
        Array.from(app.container.querySelectorAll<HTMLElement>('[role="radio"]')).find(n => n.textContent === '16')!.click()
        await app.settle(); results.push(snapshot(app))
        expect(app.model().gridSize).toBe(16)
        expect(app.model().undoStack).toHaveLength(0)
        return results
      } finally { await app.close() }
    }
    expect(await trace(true)).toEqual(await trace(false))
  })

  test('normal runtime uses separate owners and clears DOM on exit/remount', async () => {
    const model = withHistory(16)
    const a = await mount(model)
    const b = await mount(model)
    const first = a.snapshots[0]!
    try {
      expect(new Set([...first, ...b.snapshots[0]!]).size).toBe(14)
      expect(new Set([...a.container.querySelectorAll('[style*="grid-template-columns"]'), ...b.container.querySelectorAll('[style*="grid-template-columns"]')]).size).toBe(14)
    } finally { await a.close(); await b.close() }
    const c = await mount(model)
    try {
      for (const node of c.snapshots[0]!) expect(first).not.toContain(node)
      expect(c.container.querySelectorAll('[style*="background-color"]')).not.toHaveLength(0)
    } finally { await c.close() }
  })
})
