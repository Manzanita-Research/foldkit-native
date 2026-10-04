// One example on FoldKit on gpuix in a real window, in its own process, for
// window.test.ts. The same input twice (gpuix's own simulated events): with
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
const elementShowing = (text: string) => native.document.querySelectorAll('*').filter(element => element.textContent.trim() === text)
  .find(element => !element.children.some(child => child.textContent.includes(text)))
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

/** The reads a pointer drag makes, every frame (as @foldkit/ui's
 *  DragAndDrop does on each move): every card's box, and what's under the
 *  pointer. Kept: whether every card had a box and the pointer was over a
 *  column, each time. */
let pointer = { x: 0, y: 0 }
const reads = { frames: 0, boxed: 0, overColumn: 0 }
const readLayout = () => {
  const cards = native.document.querySelectorAll('[data-draggable-id]')
  reads.frames++
  if (cards.every(card => card.getBoundingClientRect().width > 0)) reads.boxed++
  if (native.document.elementsFromPoint(pointer.x, pointer.y).some(element => element.hasAttribute('data-droppable-id'))) reads.overColumn++
  reading = requestAnimationFrame(readLayout)
}
let reading = 0

/** What the app does in each phase: the same input, answering or not. */
const scenarios: Record<string, () => Promise<Record<string, unknown>>> = {
  kanban: async () => {
    const card = native.document.querySelector('[data-draggable-id]')!
    const title = card.querySelector('span')!.textContent
    const { x, y } = centre(card)
    // The pointer over the board, then a card picked up with the keyboard:
    // Tab to it, Space picks it up, Down moves it, Space drops it.
    for (let step = 0; step < 20; step++) {
      pointer = { x: x + step * 10, y: y + step * 4 }
      live.simulateMouseMove(pointer.x, pointer.y)
      await sleep(16)
    }
    for (let tab = 0; tab < 10 && native.document.activeElement !== card; tab++) await key('tab')
    await key('space')
    await key('down')
    await key('space')
    await sleep(200)
    // The announcement is visually hidden (sr-only): read from the document.
    const dropped = native.document.querySelector('[aria-live]')?.textContent.startsWith(`Dropped ${title}`) === true
    // Back where it was, for the next phase.
    await key('space')
    await key('up')
    await key('space')
    await sleep(200)
    return { dropped }
  },
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
      reading = requestAnimationFrame(readLayout)
      await waitFor(() => native.host.geometry().misses > before.misses, 10_000)
      await sleep(500)
      cancelAnimationFrame(reading)
      probe = { probe: { work: stats(frames), between: stats(gaps) } }
    }
    frames = []
    gaps = []
    Object.assign(reads, { frames: 0, boxed: 0, overColumn: 0 })
    reading = requestAnimationFrame(readLayout)
    const outcome = await scenario()
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
