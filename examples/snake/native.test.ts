// Snake in FoldKit Native: the real app and its CSS on FoldKit on gpuix (its
// `meta.renderer`; FOLDKIT_NATIVE_RENDERER=mirror runs them on the mirror, as
// CI does too), driven by GPUI's input. FoldKit's own tests (story.test.ts,
// scene.test.ts) cover the game's logic and view; these cover it running
// natively. The game clock is real (a FoldKit Subscription ticking every 150
// ms), so each test plays a few ticks, not a whole game, and pauses before
// closing so the clock stops.
import { afterEach, describe, expect, test } from 'bun:test'

import { METAL, type Headless, type Metal, openHeadless, openMetal } from '../support/harness.ts'

type Cell = { x: number; y: number }

/** Tailwind's colours for the cells, as styles.native.css lowers them. */
const HEAD = '#008138' // bg-green-700
const BODY = '#00c758' // bg-green-500
const APPLE = '#fb2c36' // bg-red-500
const EMPTY = '#1e2939' // bg-gray-800

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Waits (a few clock ticks at most) until `done`. */
const until = async (app: { settle: () => Promise<void> }, done: () => boolean, ms = 2000) => {
  const end = Date.now() + ms
  while (!done() && Date.now() < end) {
    await sleep(10)
    await app.settle()
  }
}

/** The board as GPUI has it: each of the 400 cells' background colour, read
 *  from GPUI's tree (the DOM only says where the cells are). */
const board = (app: Headless) => {
  const grid = app.document.querySelector('.inline-block')!
  const cells: Record<string, Array<Cell>> = { [HEAD]: [], [BODY]: [], [APPLE]: [], [EMPTY]: [] }
  Array.from(grid.children).forEach((row, y) =>
    Array.from(row.children).forEach((cell, x) => {
      const background = app.nativeOf(cell as unknown as Node).style?.['backgroundColor'] as string
      ;(cells[background] ??= []).push({ x, y })
    }))
  return { head: cells[HEAD]!, body: cells[BODY]!, apples: cells[APPLE]!, empty: cells[EMPTY]!.length }
}

const status = (texts: Array<string>) => texts[3]

/** Where the DOM has the head, to know when to look at GPUI's pixels. */
const domHead = (document: Document): Cell => {
  const rows = Array.from(document.querySelector('.inline-block')!.children)
  const y = rows.findIndex(row => row.querySelector('.bg-green-700') !== null)
  return { x: Array.from(rows[y]!.children).indexOf(rows[y]!.querySelector('.bg-green-700')!), y }
}

describe('headless', () => {
  let app: Headless
  afterEach(() => app?.close())

  test('draws the whole board in GPUI, with Tailwind colours', async () => {
    app = await openHeadless('snake')
    expect(app.texts()).toEqual([
      'Snake Game', 'Score: 0', 'High Score: 0', 'Press SPACE to start',
      'Use ARROW KEYS or WASD to move', 'SPACE to pause/start', 'R to restart',
    ])
    expect(app.inSync()).toBe(true)
    // A 20 × 20 grid: the snake (head and two segments), one apple, 396 empty.
    const { head, body, apples, empty } = board(app)
    expect(head).toEqual([{ x: 10, y: 10 }])
    expect(body).toEqual([{ x: 8, y: 10 }, { x: 9, y: 10 }])
    expect(apples).toHaveLength(1)
    expect(empty).toBe(396)
    // w-6 h-6 cells; text-4xl font-bold heading; bg-black page.
    const cell = app.nativeOf(app.document.querySelector('.inline-block')!.firstElementChild!.firstElementChild! as unknown as Node)
    expect(cell.style).toMatchObject({ width: 24, height: 24 })
    const heading = app.document.querySelector('h1')!.firstChild as unknown as Node
    expect(app.nativeOf(heading).style).toMatchObject({ color: '#fff', fontSize: 36, fontWeight: 700, lineHeight: 40 })
  })

  test('space starts the clock, GPUI window keys steer, space pauses', async () => {
    app = await openHeadless('snake')
    // FoldKit listens on the document; with nothing focused, a GPUI window
    // key goes to <body> and bubbles there.
    await app.key(' ')
    expect(status(app.texts())).toBe('Playing - SPACE to pause')

    // Two ticks to the right (a slow machine may fit a third tick in before
    // the check, so: at least two, and still on the same row)…
    await until(app, () => board(app).head[0]!.x >= 12)
    const turnedAt = board(app).head[0]!
    expect(turnedAt.x).toBeGreaterThanOrEqual(12)
    expect(turnedAt.y).toBe(10)

    // …then up: the same column, moving up.
    await app.key('ArrowUp')
    await until(app, () => board(app).head[0]!.y <= 8)
    const { head, body } = board(app)
    expect(head[0]!.y).toBeLessThanOrEqual(8)
    expect(head[0]!.x).toBeGreaterThanOrEqual(turnedAt.x)
    expect(body.length).toBeGreaterThanOrEqual(2)
    expect(app.inSync()).toBe(true)

    // Paused: the Subscription's stream stops, and so does the snake.
    await app.key(' ')
    expect(status(app.texts())).toBe('Paused - SPACE to continue')
    const paused = board(app).head[0]
    await sleep(400)
    await app.settle()
    expect(board(app).head[0]).toEqual(paused!)
  })

  test('WASD steers too, and R puts the snake back', async () => {
    app = await openHeadless('snake')
    await app.key(' ')
    // FoldKit's clock ticks once as it starts, so the snake is already moving.
    const { x } = board(app).head[0]!
    await app.key('s')
    await until(app, () => board(app).head[0]!.y >= 12)
    expect(board(app).head[0]!.x).toBe(x)
    await app.key('r')
    expect(status(app.texts())).toBe('Press SPACE to start')
    expect(board(app).head).toEqual([{ x: 10, y: 10 }])
    expect(app.inSync()).toBe(true)
  })
})

describe('one tick, measured', () => {
  let app: Headless
  afterEach(() => app?.close())

  test('the document → GPUI sync per tick, and the tick rate', async () => {
    const syncs: Array<{ at: number; syncMs: number; mutations: number }> = []
    app = await openHeadless('snake', { onSynced: timings => syncs.push({ at: performance.now(), ...timings }) })
    // Everything until the board settled: the first render.
    const first = { syncMs: syncs.reduce((total, sync) => total + sync.syncMs, 0), mutations: syncs.reduce((total, sync) => total + sync.mutations, 0) }

    await app.key(' ')
    syncs.length = 0
    await sleep(1600) // about ten ticks at 150 ms
    await app.key(' ')

    const ticks = syncs.filter(sync => sync.mutations > 0).slice(0, -1) // the last is the pause
    const median = (values: Array<number>) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
    const intervals = ticks.slice(1).map((tick, i) => tick.at - ticks[i]!.at)
    const report = {
      firstRender: { syncMs: +first.syncMs.toFixed(2), mutations: first.mutations },
      ticks: ticks.length,
      syncMs: { median: +median(ticks.map(t => t.syncMs)).toFixed(2), max: +Math.max(...ticks.map(t => t.syncMs)).toFixed(2) },
      mutationsPerTick: median(ticks.map(t => t.mutations)),
      intervalMs: { median: +median(intervals).toFixed(1), max: +Math.max(...intervals).toFixed(1) },
    }
    console.log('snake tick:', JSON.stringify(report))

    // Loose budgets, to catch "broken" on noisy CI machines: the game keeps
    // its 150 ms clock, and a tick's sync is a small fraction of it.
    expect(ticks.length).toBeGreaterThanOrEqual(8)
    expect(report.intervalMs.median).toBeGreaterThan(120)
    expect(report.intervalMs.median).toBeLessThan(200)
    expect(report.syncMs.median).toBeLessThan(30)
  })
})

/** Where the snake's head is in a screenshot: the centre of its colour. */
const headIn = (shot: ReturnType<Metal['screenshot']>) => {
  let sumX = 0, sumY = 0, count = 0
  for (let y = 0; y < shot.height; y++) {
    for (let x = 0; x < shot.width; x++) {
      const [r, g, b] = shot.pixel(x, y)
      if (Math.abs(r - 0x00) < 8 && Math.abs(g - 0x81) < 8 && Math.abs(b - 0x38) < 8) {
        sumX += x; sumY += y; count++
      }
    }
  }
  return { x: sumX / count, y: sumY / count, count }
}

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal
  afterEach(() => app?.close())

  test('GPUI paints the board; keystrokes through its input pipeline play the game', async () => {
    app = await openMetal('snake')
    expect(app.painted()).toContain('Press SPACE to start')
    const start = app.screenshot('start')
    const atStart = headIn(start)
    expect(atStart.count).toBeGreaterThan(0)

    // Real keystrokes: GPUI's window key events, into the DOM, to FoldKit.
    await app.keys('space')
    expect(app.painted()).toContain('Playing - SPACE to pause')
    await until(app, () => domHead(app.document).x >= 12)
    await app.keys('up')
    await until(app, () => domHead(app.document).y <= 8)
    const playing = app.screenshot('playing')
    const midGame = headIn(playing)
    // The head moved right, then up, in the pixels GPUI drew.
    expect(midGame.x).toBeGreaterThan(atStart.x)
    expect(midGame.y).toBeLessThan(atStart.y)

    await app.keys('space')
    expect(app.painted()).toContain('Paused - SPACE to continue')
    app.screenshot('paused')
  })
})
