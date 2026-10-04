// Pixel Art on FoldKit on gpuix (the adapter: no DOM engine), driven by
// GPUI's input: the same app and CSS as native.test.ts runs on the mirror.
//
// A stroke is a mousedown on a cell, then a mouseenter on each cell the drag
// crosses, then a mouseup on document. While a button's held GPUI sends the
// moves only to the pressed cell and no enter or leave to the rest, so the
// adapter hit-tests each move against GPUI's last layout and fires the
// enters a browser would; the release goes to the pressed cell and bubbles
// to document.
import { afterEach, describe, expect, test } from 'bun:test'

import { type Headless, METAL, mountHeadless, openMetal } from '../../packages/foldkit-gpuix/test/support.ts'
import { loadExample } from '../support/example.ts'

type Metal = Awaited<ReturnType<typeof openMetal>>
type Doc = Headless['document']

const WHITE = '#ffffff' // an empty cell
const INK = '#262427' // Syntax palette, colour 0 (the default)

/** Each GPUI event re-renders and restyles a few hundred elements; the
 *  longer tests take a few seconds on a busy CI machine. */
const SLOW = 30_000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const gridOf = (document: Doc) => document.querySelector('.cursor-crosshair')!
const cellOf = (document: Doc, x: number, y: number) => gridOf(document).children[y]!.children[x]!
const row = (y: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, at) => [from + at, y] as const)

describe('headless', () => {
  let app: Headless | undefined
  afterEach(() => {
    app?.close()
    app = undefined
  })
  const open = async () => {
    const example = await loadExample('pixel-art')
    app = mountHeadless({ css: example.css, viewport: { width: example.meta.width, height: example.meta.height } })
    example.start(app.container)
    await app.settle()
    await app.settle()
    return app
  }
  /** The fake GPUI doesn't lay out: a 16 × 16 board of 20 px cells at (100, 100). */
  const CELL = 20
  const layOut = () => {
    const grid = gridOf(app!.document)
    app!.gpui.setBounds(grid.nativeId, { x: 100, y: 100, width: 16 * CELL, height: 16 * CELL })
    grid.children.forEach((line, y) => {
      app!.gpui.setBounds(line.nativeId, { x: 100, y: 100 + y * CELL, width: 16 * CELL, height: CELL })
      line.children.forEach((cell, x) => app!.gpui.setBounds(cell.nativeId, { x: 100 + x * CELL, y: 100 + y * CELL, width: CELL, height: CELL }))
    })
    app!.host.relayout()
  }
  const centre = (x: number, y: number) => ({ x: 100 + x * CELL + CELL / 2, y: 100 + y * CELL + CELL / 2 })
  /** The board as GPUI has it: each painted cell's colour, keyed "x,y". */
  const painted = () => {
    const out: Record<string, string> = {}
    gridOf(app!.document).children.forEach((line, y) => line.children.forEach((cell, x) => {
      const colour = app!.gpui.node(cell.nativeId).style['backgroundColor']
      if (colour !== WHITE) out[`${x},${y}`] = colour as string
    }))
    return out
  }
  const send = (elementId: number, event: Record<string, unknown>) => app!.host.dispatch({ elementId, ...event } as never)
  /** A drag as GPUI delivers it: the press to the cell under the pointer,
   *  then every move and the release to that same cell. */
  const drag = async (cells: ReadonlyArray<readonly [number, number]>) => {
    layOut()
    const [first, ...rest] = cells
    const id = cellOf(app!.document, first![0], first![1]).nativeId
    send(id, { eventType: 'mouseDown', ...centre(first![0], first![1]), button: 0, clickCount: 1 })
    await app!.settle()
    for (const [x, y] of rest) {
      send(id, { eventType: 'mouseMove', ...centre(x, y), pressedButton: 0 })
      await app!.settle()
    }
    const [lastX, lastY] = cells.at(-1)!
    send(id, { eventType: 'mouseUp', ...centre(lastX, lastY), button: 0, clickCount: 1 })
    await sleep(10)
    await app!.settle()
  }

  test('a drag paints every cell it crosses, and the release ends the stroke', async () => {
    await open()
    await drag(row(3, 2, 9))
    expect(painted()).toEqual(Object.fromEntries(row(3, 2, 9).map(([x, y]) => [`${x},${y}`, INK])))
    // A move after the release, with no button held: GPUI hovers itself,
    // and the brush only previews where the pointer is.
    const preview = cellOf(app!.document, 12, 10)
    send(preview.nativeId, { eventType: 'mouseEnter', hovered: true })
    await app!.settle()
    expect(painted()['12,10']).toBe(INK)
    send(preview.nativeId, { eventType: 'mouseLeave', hovered: false })
    send(cellOf(app!.document, 13, 10).nativeId, { eventType: 'mouseEnter', hovered: true })
    await app!.settle()
    expect(painted()['12,10']).toBeUndefined()
    // Each stroke is one step in the history.
    await drag([[5, 12], [5, 13], [6, 13]])
    expect(painted()).toMatchObject({ '5,12': INK, '5,13': INK, '6,13': INK })
    expect(app!.texts().filter(text => /^Back \d+$/.test(text))).toEqual(['Back 1', 'Back 2'])
  }, SLOW)

  test('a diagonal drag crosses the cells between its moves, as the pointer does', async () => {
    await open()
    // Two moves per cell, corner to corner of a 6-cell diagonal.
    const path: Array<readonly [number, number]> = [[0, 0]]
    for (let step = 1; step <= 10; step++) path.push([step / 2, step / 2])
    await drag(path)
    for (let at = 0; at <= 5; at++) expect(painted()[`${at},${at}`]).toBe(INK)
  }, SLOW)
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal | undefined
  afterEach(() => {
    app?.close()
    app = undefined
  })
  const open = async () => {
    const example = await loadExample('pixel-art')
    app = await openMetal('gpuix-pixel-art', { width: example.meta.width, height: example.meta.height }, { css: example.css })
    example.start(app.container)
    await app.settle()
    await app.settle()
    return app
  }

  test('a drag through GPUI\'s hit testing paints the cells it crosses', async () => {
    await open()
    const centre = (x: number, y: number) => {
      const box = app!.bounds(cellOf(app!.document, x, y))
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const colour = (x: number, y: number) => cellOf(app!.document, x, y).style.getPropertyValue('background-color')
    const dragAcross = async (cells: ReadonlyArray<readonly [number, number]>) => {
      const [first, ...rest] = cells.map(([x, y]) => centre(x, y))
      // Over the board before pressing, as a hand gets there.
      app!.renderer.nativeSimulateMouseMove(first!.x, first!.y)
      await app!.settle()
      app!.renderer.nativeSimulateMouseDown(first!.x, first!.y)
      await app!.settle()
      for (const point of rest) {
        app!.renderer.nativeSimulateMouseMove(point.x, point.y, 0)
        await app!.settle()
      }
      const last = rest.at(-1) ?? first!
      app!.renderer.nativeSimulateMouseUp(last.x, last.y)
      await app!.settle()
    }
    app!.screenshot('editor')
    const stroke = row(4, 2, 9)
    await dragAcross(stroke)
    for (const [x, y] of stroke) expect(colour(x, y)).toBe(INK)
    // A vertical one, after the release.
    const column = [[12, 2], [12, 3], [12, 4], [12, 5], [12, 6]] as const
    await dragAcross(column)
    for (const [x, y] of column) expect(colour(x, y)).toBe(INK)
    // Nothing between the strokes: the first ended at its release.
    expect(colour(10, 4)).toBe(WHITE)
    app!.screenshot('strokes')
  }, SLOW)
})
