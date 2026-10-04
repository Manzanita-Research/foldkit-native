// One example on FoldKit on gpuix in a real window, in its own process, for
// window.test.ts: Kanban (a pointer drag and a keyboard move) or Pixel Art
// (a stroke). The same input twice (gpuix's own simulated events): with
// GPUI's bounds queries answering, then not, the way they don't on Linux when
// a window isn't painting (each blocks for 2 s, then throws). Each frame's
// time is recorded, and one JSON line of results is printed.
//
//   bun packages/foldkit-gpuix/test/window-app.ts kanban
import { GpuixRenderer } from '@gpuix/native'

import { loadExample } from '../../../examples/support/example.ts'
import { NativeElement, mountGpuix } from '../src/index.ts'

const id = process.argv[2] ?? 'kanban'
const example = await loadExample(id)
const { width, height, title } = example.meta
let live!: GpuixRenderer
let realBounds!: GpuixRenderer['getElementBounds']
// The app's view: GPUI not painting. (gpuix keys its event routing on the
// renderer object itself, so the methods are swapped on it, not wrapped.)
let answering = true
const blocked = new Int32Array(new SharedArrayBuffer(4))
const notPainting = (): never => {
  Atomics.wait(blocked, 0, 0, 2000)
  throw new Error('Timed out after 2 seconds waiting for the automation bounds query')
}
const createRenderer = (callback: ConstructorParameters<typeof GpuixRenderer>[0]) => {
  live = new GpuixRenderer(callback)
  // The test's own view of the window, which keeps answering.
  realBounds = live.getElementBounds.bind(live)
  const realTree = live.getAutomationTree.bind(live)
  live.getElementBounds = (elementId: number) => (answering ? realBounds(elementId) : notPainting())
  live.getAutomationTree = () => (answering ? realTree() : notPainting())
  return live
}

// Per frame: the adapter's and GPUI's time on it, and the time since the
// last frame began (anything else that held the thread shows there).
let frames: Array<number> = []
let gaps: Array<number> = []
let lastFrameAt: number | undefined
const native = mountGpuix({
  title, width, height, css: example.css, exitOnClose: false, createRenderer,
  onFrame: ms => {
    const now = performance.now()
    frames.push(ms)
    if (lastFrameAt !== undefined) gaps.push(now - ms - lastFrameAt)
    lastFrameAt = now - ms
  },
})
example.start(native.container)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const painted = () => live.getPaintedText()
const waitFor = async (done: () => boolean, ms = 5000) => {
  const end = performance.now() + ms
  while (!done()) {
    if (performance.now() > end) throw new Error('timed out waiting for the window')
    await sleep(16)
  }
}
const stats = (samples: Array<number>) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return {
    frames: sorted.length, p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +(sorted.at(-1) ?? 0).toFixed(2),
    over16: sorted.filter(ms => ms > 16.7).length, over1s: sorted.filter(ms => ms > 1000).length,
  }
}
const centre = (element: NativeElement) => {
  const box = realBounds(element.nativeId)
  if (box === null) throw new Error(`${element.localName} not painted`)
  return { x: box.x + Math.min(20, box.width / 2), y: box.y + Math.min(20, box.height / 2) }
}
const key = async (keys: string) => {
  live.simulateKeyDown(keys)
  await sleep(40)
  live.simulateKeyUp(keys)
  await sleep(40)
}

/** The pointer: where the scenario last moved it. */
let pointer = { x: 0, y: 0 }
const move = async (x: number, y: number, pressed: boolean) => {
  pointer = { x, y }
  if (pressed) live.simulateMouseMove(x, y, 0)
  else live.simulateMouseMove(x, y)
  await sleep(16)
}
/** A drag through GPUI: over the start, press, move in steps, release. */
const dragFrom = async (from: { x: number; y: number }, to: ReadonlyArray<{ x: number; y: number }>) => {
  await move(from.x, from.y, false)
  live.simulateMouseDown(from.x, from.y, 0)
  await sleep(40)
  for (const point of to) await move(point.x, point.y, true)
  const last = to.at(-1) ?? from
  live.simulateMouseUp(last.x, last.y, 0)
  await sleep(200)
}

/** The reads an app makes every frame, besides the ones its input makes:
 *  kept, whether each one was answered. */
const reads = { frames: 0, answered: 0 }
let reading = 0

type Scenario = {
  /** One frame's reads; true if they had an answer (undefined: nothing to
   *  read yet). */
  read: () => boolean | undefined
  run: (phase: 'answering' | 'not painting') => Promise<Record<string, unknown>>
}
const titles = (column: string) => native.document.querySelectorAll(`[data-droppable-id="${column}"] [data-draggable-id]`)
  .map(card => card.querySelector('span')!.textContent)
const gridOf = () => native.document.querySelector('.cursor-crosshair')!
const scenarios: Record<string, Scenario> = {
  // DragAndDrop's read on each move: what's under the pointer.
  kanban: {
    read: () => pointer.x === 0 ? undefined : native.document.elementsFromPoint(pointer.x, pointer.y).length > 0,
    run: async () => {
      // A pointer drag: To Do's first card, into In Progress, above its first.
      const card = native.document.querySelector('[data-droppable-id="todo"] [data-draggable-id]')!
      const dragged = card.querySelector('span')!.textContent
      const from = centre(card)
      const target = realBounds(native.document.querySelector('[data-droppable-id="in-progress"] [data-draggable-id]')!.nativeId)!
      const to = { x: target.x + 30, y: target.y + 4 }
      await dragFrom(from, Array.from({ length: 10 }, (_, at) => ({
        x: from.x + ((to.x - from.x) * (at + 1)) / 10, y: from.y + ((to.y - from.y) * (at + 1)) / 10,
      })))
      const movedByPointer = titles('in-progress')[0] === dragged
      // Then a card picked up with the keyboard: Tab to it, Space picks it
      // up, Down moves it, Space drops it.
      const next = native.document.querySelector('[data-droppable-id="todo"] [data-draggable-id]')!
      const title = next.querySelector('span')!.textContent
      for (let tab = 0; tab < 12 && native.document.activeElement !== next; tab++) await key('tab')
      await key('space')
      await key('down')
      await key('space')
      await sleep(200)
      // The announcement is visually hidden (sr-only): read from the document.
      const movedByKeyboard = native.document.querySelector('[aria-live]')?.textContent.startsWith(`Dropped ${title}`) === true
      return { movedByPointer, movedByKeyboard }
    },
  },
  // Nothing besides the drag: its moves are hit-tested against the layout.
  'pixel-art': {
    read: () => pointer.x === 0 ? undefined : native.document.elementsFromPoint(pointer.x, pointer.y).length > 0,
    run: async phase => {
      // A stroke along a row, a different one each phase.
      const y = phase === 'answering' ? 3 : 7
      const cells = Array.from({ length: 14 }, (_, at) => gridOf().children[y]!.children[1 + at]!)
      const [first, ...rest] = cells.map(cell => {
        const box = realBounds(cell.nativeId)!
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      })
      // Two moves a cell, as a hand makes them.
      await dragFrom(first!, rest.flatMap((point, at) => {
        const from = at === 0 ? first! : rest[at - 1]!
        return [{ x: (from.x + point.x) / 2, y: point.y }, point]
      }))
      const painted = cells.filter(cell => cell.style.getPropertyValue('background-color') !== '#ffffff').length
      return { painted, of: cells.length }
    },
  },
}
const readEachFrame = (scenario: Scenario) => {
  const step = () => {
    const answered = scenario.read()
    if (answered !== undefined) reads.frames++
    if (answered === true) reads.answered++
    reading = requestAnimationFrame(step)
  }
  reading = requestAnimationFrame(step)
}

const results: Record<string, unknown> = {}
try {
  await waitFor(() => painted().length > 0)
  await sleep(300)
  const scenario = scenarios[id]
  if (scenario === undefined) throw new Error(`no scenario for ${id}`)
  for (const phase of ['answering', 'not painting'] as const) {
    answering = phase === 'answering'
    const before = native.host.geometry()
    // GPUI stops answering: the app's next read finds out, waiting out
    // gpuix's 2 s once, and the frames that were held up catch up. That
    // probe is reported on its own; the scenario's frames come after it.
    let probe: Record<string, unknown> = {}
    if (!answering) {
      frames = []
      gaps = []
      readEachFrame(scenario)
      await waitFor(() => native.host.geometry().misses > before.misses, 10_000)
      await sleep(500)
      cancelAnimationFrame(reading)
      probe = { probe: { work: stats(frames), between: stats(gaps) } }
    }
    frames = []
    gaps = []
    Object.assign(reads, { frames: 0, answered: 0 })
    readEachFrame(scenario)
    const outcome = await scenario.run(phase)
    cancelAnimationFrame(reading)
    const after = native.host.geometry()
    results[phase] = {
      ...outcome, ...probe, reads: { ...reads }, work: stats(frames), between: stats(gaps),
      queries: after.queries - before.queries, misses: after.misses - before.misses, treeReads: after.reads - before.reads,
    }
  }
} catch (error) {
  results['error'] = String(error)
} finally {
  console.log(`RESULTS ${JSON.stringify(results)}`)
  await native.close({ force: true })
  process.exit(0)
}
