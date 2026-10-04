// FoldKit on gpuix in a real macOS window (its own process: window-app.ts),
// with GPUI's bounds queries answering, then not: on Linux a window that
// isn't painting (hidden, minimised, behind a lock screen) answers each one
// after 2 s, with an error. The frame loop must keep its frames under budget
// all the same, and the app keep working from the last layout GPUI gave.
// Needs a logged-in macOS session; FOLDKIT_NATIVE_NO_WINDOW=1 skips it.
import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

const windows = process.platform === 'darwin' && process.env['FOLDKIT_NATIVE_NO_WINDOW'] === undefined

/** A 60 Hz frame (the frame loop asks for one every 8 ms). CI's shared
 *  runners get twice that: there it catches "broken", as TESTING.md says. */
const FRAME_MS = process.env['CI'] === undefined ? 16.7 : 33.4

type Stats = { frames: number; p50: number; p95: number; max: number; over16: number; over1s: number }
type Phase = {
  dropped: boolean
  /** The frames around the read that found GPUI not answering. */
  probe?: { work: Stats; between: Stats }
  reads: { frames: number; boxed: number; overColumn: number }
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

describe.skipIf(!windows)('geometry in a live window, GPUI answering or not (FKN-29)', () => {
  test('Kanban: frames stay under budget while bounds queries time out, and the app works from the last layout', async () => {
    const results = await run('kanban')
    console.log('kanban, live window:', JSON.stringify(results))
    const { answering, 'not painting': notPainting } = results
    for (const phase of [answering, notPainting]) {
      // The keyboard move lands either way.
      expect(phase.dropped).toBe(true)
      // Every frame's reads got every card's box and found the column under
      // the pointer: from GPUI, then from the last layout it gave.
      expect(phase.reads.frames).toBeGreaterThan(50)
      expect(phase.reads.boxed).toBe(phase.reads.frames)
      expect(phase.reads.overColumn).toBe(phase.reads.frames)
      // 95 frames in 100 take under a frame's budget (the adapter's and
      // GPUI's work on each), and nothing else holds the thread long: the
      // next frame starts within two (the frame loop's own timer, on a busy
      // machine, is in that).
      expect(phase.work.p95).toBeLessThan(FRAME_MS)
      expect(phase.between.p95).toBeLessThan(2 * FRAME_MS)
    }
    // Answering: the layout was read from GPUI's tree, and nothing missed.
    expect(answering.treeReads).toBeGreaterThan(0)
    expect(answering.misses).toBe(0)
    expect(answering.between.over1s).toBe(0)
    // Not painting: one query found out, waiting out gpuix's 2 s (the one
    // long frame), and then none was made: the app ran from the last layout.
    expect(notPainting.misses).toBe(1)
    expect(notPainting.probe!.between.over1s).toBe(1)
    expect(notPainting.treeReads).toBe(0)
    expect(notPainting.between.over1s).toBe(0)
  }, 60_000)
})
