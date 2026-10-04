// FoldKit on gpuix in a real macOS window (its own process: window-app.ts),
// with GPUI's bounds queries answering, then not: on Linux a window that
// isn't painting (hidden, minimised, behind a lock screen) answers each one
// after 2 s, with an error. The frame loop must keep its frames under budget
// all the same, and Kanban's drag and Pixel Art's hover keep working from
// the last layout GPUI gave.
// Needs a logged-in macOS session; FOLDKIT_NATIVE_NO_WINDOW=1 skips it.
import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

const windows = process.platform === 'darwin' && process.env['FOLDKIT_NATIVE_NO_WINDOW'] === undefined

/** A 60 Hz frame (the frame loop asks for one every 8 ms). CI's shared
 *  runners get twice that: there it catches "broken", as TESTING.md says. */
const FRAME_MS = process.env['CI'] === undefined ? 16.7 : 33.4

type Stats = { frames: number; p50: number; p95: number; max: number; over16: number; over1s: number }
type Phase = Record<string, unknown> & {
  /** The frames around the read that found GPUI not answering. */
  probe?: { work: Stats; between: Stats }
  /** The app's own reads each frame, and how many were all answered. */
  reads: { frames: number; answered: number }
  work: Stats
  between: Stats
  queries: number
  misses: number
  treeReads: number
}

const run = async (example: string): Promise<Record<'answering' | 'not painting', Phase>> => {
  const child = Bun.spawn([process.execPath, 'packages/foldkit-gpuix/test/window-app.ts', example], {
    cwd: resolve(import.meta.dir, '../../..'), stdin: 'ignore', stdout: 'pipe', stderr: 'inherit',
  })
  const killer = setTimeout(() => child.kill(), 40_000)
  const out = await new Response(child.stdout).text()
  clearTimeout(killer)
  const line = out.split('\n').find(text => text.startsWith('RESULTS '))
  if (line === undefined) throw new Error(`no results from window-app.ts:\n${out}`)
  const results = JSON.parse(line.slice('RESULTS '.length))
  if (results.error !== undefined) throw new Error(results.error)
  return results
}

/** What holds in both phases, and how each differs: answering, the layout
 *  is read from GPUI's tree; not painting, one read finds out (it waits out
 *  gpuix's 2 s: the one long frame), then none is made and the app runs
 *  from the last layout GPUI gave. */
const budgets = ({ answering, 'not painting': notPainting }: Record<'answering' | 'not painting', Phase>, frameMs = FRAME_MS) => {
  for (const phase of [answering, notPainting]) {
    // Every frame's own reads were answered: from GPUI, then from the last layout.
    expect(phase.reads.frames).toBeGreaterThan(30)
    expect(phase.reads.answered).toBe(phase.reads.frames)
    // 95 frames in 100 take under a frame's budget (the adapter's and
    // GPUI's work on each), and nothing else holds the thread long: the
    // next frame starts within two (the frame loop's own timer, on a busy
    // machine, is in that).
    expect(phase.work.p95).toBeLessThan(frameMs)
    expect(phase.between.p95).toBeLessThan(2 * frameMs)
  }
  expect(answering.treeReads).toBeGreaterThan(0)
  expect(answering.misses).toBe(0)
  expect(answering.between.over1s).toBe(0)
  expect(notPainting.misses).toBe(1)
  expect(notPainting.probe!.between.over1s).toBe(1)
  expect(notPainting.treeReads).toBe(0)
  expect(notPainting.between.over1s).toBe(0)
}

describe.skipIf(!windows)('geometry in a live window, GPUI answering or not (FKN-29)', () => {
  test('Kanban: a pointer drag and a keyboard move land, with frames under budget, either way', async () => {
    const results = await run('kanban')
    console.log('kanban, live window:', JSON.stringify(results))
    for (const phase of Object.values(results)) expect(phase).toMatchObject({ movedByPointer: true, movedByKeyboard: true })
    budgets(results)
  }, 60_000)

  test('Pixel Art: a stroke paints every cell the drag crosses, with frames under budget, either way', async () => {
    const results = await run('pixel-art')
    console.log('pixel-art, live window:', JSON.stringify(results))
    for (const phase of Object.values(results)) expect(phase.painted).toBe(phase.of)
    // Twice the budget: each cell a stroke paints is one style change, and
    // gpuix's applyBatch takes ~10 ms to apply it in a live window (0.5 ms
    // of the adapter's own work around it), with or without geometry. A
    // frame budget for drawing is a gpuix matter; this checks geometry adds
    // nothing to it.
    budgets(results, 2 * FRAME_MS)
  }, 60_000)
})
