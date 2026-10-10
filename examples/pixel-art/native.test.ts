// Pixel Art in FoldKit Native: the real app and its CSS on FoldKit on gpuix
// (its `meta.renderer`; FOLDKIT_NATIVE_RENDERER=mirror runs them on the
// mirror, as CI does too), driven by GPUI's input. FoldKit's own tests
// (story.test.ts, scene.test.ts) cover the editor's logic and view; these
// cover it running natively: cells painted by GPUI presses and drags, tools
// and colours from the keyboard and the toolbar, undo and redo from GPUI's
// modified keys, time travel through the history, FoldKit UI's Dialog and
// Listbox, and the saved canvas coming in as Flags.
//
// A stroke is a mousedown on a cell, then a mouseenter on each cell the drag
// crosses, then a mouseup on document. While a button's held GPUI sends the
// moves only to the pressed cell and no enter or leave to the rest, so the
// renderer hit-tests each move against GPUI's last layout and fires the enters
// a browser would; the release goes to the pressed cell and bubbles to
// document.
import { afterEach, describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { pixelAt } from '../../test/support/native-geometry.ts'

import { METAL, type Headless, type Metal, openHeadless, openMetal, rendererFor } from '../support/harness.ts'
import { STORAGE_KEY } from './constant'
import { SavedCanvasJsonString } from './model'

const RENDERER = await rendererFor('pixel-art')

const WHITE = '#ffffff' // an empty cell
const INK = '#262427' // Syntax palette, colour 0 (the default)
const RED = '#ff7272' // Syntax palette, colour 4
const INDIGO = '#4f39f6' // bg-indigo-600: the selected tool, the current history step

/** Each GPUI event re-renders and restyles a few hundred elements headless;
 *  the longer tests take a few seconds on a busy CI machine. */
const SLOW = 30_000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Waits for FoldKit's Commands (saving the canvas, exporting) to come back. */
const until = async (app: { settle: () => Promise<void> }, done: () => boolean, ms = 1000) => {
  const end = Date.now() + ms
  while (!done() && Date.now() < end) {
    await sleep(10)
    await app.settle()
  }
}

const gridOf = (document: Document) => document.querySelector('.cursor-crosshair')!
const cellOf = (document: Document, x: number, y: number) =>
  gridOf(document).children[y]!.children[x]! as unknown as Node

/** The board as GPUI has it: each painted cell's background colour, read from
 *  GPUI's tree (the DOM only says where the cells are), keyed "x,y". */
const board = (app: Headless) => {
  const painted: Record<string, string> = {}
  const rows = Array.from(gridOf(app.document).children)
  rows.forEach((row, y) =>
    Array.from(row.children).forEach((cell, x) => {
      const background = app.nativeOf(cell as unknown as Node).style?.['backgroundColor']
      if (background !== WHITE) painted[`${x},${y}`] = background as string
    }))
  return { size: rows.length, painted }
}
const stroke = (cells: Array<[number, number]>, color: string) =>
  Object.fromEntries(cells.map(([x, y]) => [`${x},${y}`, color]))

/** The fake GPUI doesn't lay out: the board as 20 px cells at (100, 100). */
const CELL = 20
const layOut = (app: Headless) => {
  const grid = gridOf(app.document)
  const size = grid.children.length
  app.gpui.setBounds(app.idOf(grid), { x: 100, y: 100, width: size * CELL, height: size * CELL })
  Array.from(grid.children).forEach((line, y) => {
    app.gpui.setBounds(app.idOf(line), { x: 100, y: 100 + y * CELL, width: size * CELL, height: CELL })
    Array.from(line.children).forEach((cell, x) => app.gpui.setBounds(app.idOf(cell), { x: 100 + x * CELL, y: 100 + y * CELL, width: CELL, height: CELL }))
  })
  app.relayout()
}
const centre = (x: number, y: number) => ({ x: 100 + x * CELL + CELL / 2, y: 100 + y * CELL + CELL / 2 })

/** GPUI's input, as gpuix delivers it: a press to the cell under the
 *  pointer, then every move and the release to that same cell (GPUI sends no
 *  enter or leave to the others while a button's held). */
let pressed: { cell: Node; x: number; y: number } | undefined
const press = async (app: Headless, x: number, y: number) => {
  layOut(app)
  const cell = cellOf(app.document, x, y)
  pressed = { cell, ...centre(x, y) }
  app.send(cell, { eventType: 'mouseDown', ...centre(x, y), button: 0, clickCount: 1 })
  await app.settle()
}
const move = async (app: Headless, x: number, y: number) => {
  pressed = { ...pressed!, ...centre(x, y) }
  app.send(pressed.cell, { eventType: 'mouseMove', ...centre(x, y), pressedButton: 0 })
  await app.settle()
}
const release = async (app: Headless) => {
  const { cell, x, y } = pressed!
  pressed = undefined
  if (!app.send(cell, { eventType: 'mouseUp', x, y, button: 0, clickCount: 1 })) throw new Error('nothing heard the release')
  await sleep(10)
  await app.settle()
}
/** A click on a cell: a stroke of one. */
const tap = async (app: Headless, x: number, y: number) => {
  await press(app, x, y)
  await release(app)
}
/** With no button held, GPUI hovers itself: the pointer entering a cell. */
const enter = async (app: Headless, x: number, y: number) => {
  app.send(cellOf(app.document, x, y), { eventType: 'mouseEnter', hovered: true })
  await app.settle()
}
/** The pointer leaves the board: no brush preview under it. */
const leave = async (app: Headless) => {
  app.send(gridOf(app.document).parentElement!, { eventType: 'mouseLeave', hovered: false })
  await app.settle()
}
/** A drag along a row: a press, a move into each cell, and the release. */
const drag = async (app: Headless, y: number, fromX: number, toX: number) => {
  await press(app, fromX, y)
  for (let x = fromX + 1; x <= toX; x++) await move(app, x, y)
  await release(app)
}
const shortcut = (app: Headless, keystroke: string) => app.shortcut(keystroke)

const checked = (document: Document, group: string) =>
  document.querySelector(`[aria-label="${group}"] [aria-checked=true]`)?.textContent
const history = (texts: Array<string>) => texts.filter(text => /^(Back|Forward) \d+$|^Current$/.test(text))

describe('headless', () => {
  let app: Headless
  afterEach(() => app?.close())

  test('draws the editor in GPUI: a 16 × 16 board, the toolbar and the history, with Tailwind styles', async () => {
    app = await openHeadless('pixel-art')
    const texts = app.texts()
    expect(texts.slice(0, 5)).toEqual(['PixelForge', 'Built with Foldkit', '/', 'Source on GitHub', 'Export PNG'])
    // Tailwind's `uppercase` reaches GPUI as capitals.
    for (const label of ['TOOLS', 'MIRROR', 'GRID SIZE', 'COLOR', 'HISTORY']) expect(texts).toContain(label)
    expect(history(texts)).toEqual(['Current'])
    expect(app.inSync()).toBe(true)

    // 256 live cells, all empty.
    expect(board(app)).toEqual({ size: 16, painted: {} })
    expect(gridOf(app.document).children[0]!.children).toHaveLength(16)

    // bg-gray-900 page; the selected tool in bg-indigo-600; Undo disabled (opacity-40).
    const page = app.document.querySelector('.min-h-screen') as unknown as Node
    expect(app.nativeOf(page).style).toMatchObject({ display: 'flex', flexDirection: 'column', backgroundColor: '#101828' })
    expect(checked(app.document, 'Drawing tool')).toBe('BrushB')
    const brush = app.document.querySelector('[aria-label="Drawing tool"] [aria-checked=true]') as unknown as Node
    expect(app.nativeOf(brush).style).toMatchObject({ backgroundColor: INDIGO, paddingLeft: 12, borderTopLeftRadius: 4 })
    const undo = app.document.querySelector('[aria-disabled=true]') as unknown as Node
    expect(app.nativeOf(undo).style).toMatchObject({ opacity: 0.4 })
  }, SLOW)

  test('a GPUI drag paints a stroke, and each press is a step in the history', async () => {
    app = await openHeadless('pixel-art')
    await drag(app, 3, 2, 9)
    expect(board(app).painted).toEqual(stroke([[2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3]], INK))
    expect(history(app.texts())).toEqual(['Current', 'Back 1'])

    await tap(app, 12, 12)
    expect(board(app).painted['12,12']).toBe(INK)
    expect(history(app.texts())).toEqual(['Current', 'Back 1', 'Back 2'])
    expect(app.inSync()).toBe(true)
  }, SLOW)

  // The mirror sends what GPUI hit-tests on each move; the adapter also
  // fills in the cells between two moves, as a browser's pointer crosses them.
  test.skipIf(RENDERER !== 'gpuix')('a diagonal drag crosses the cells between its moves, as the pointer does', async () => {
    app = await openHeadless('pixel-art')
    // Two moves per cell, corner to corner of a 6-cell diagonal.
    await press(app, 0, 0)
    for (let step = 1; step <= 10; step++) await move(app, step / 2, step / 2)
    await release(app)
    for (let at = 0; at <= 5; at++) expect(board(app).painted[`${at},${at}`]).toBe(INK)
  }, SLOW)

  test('releasing the mouse ends the stroke: the pointer moving on only previews the brush', async () => {
    app = await openHeadless('pixel-art')
    await drag(app, 3, 2, 4)
    // With the stroke over, the cell under the pointer shows the brush's
    // preview, and the one it leaves goes back to empty.
    await enter(app, 10, 10)
    await enter(app, 11, 10)
    expect(board(app).painted).toEqual({ ...stroke([[2, 3], [3, 3], [4, 3]], INK), '11,10': INK })
    await leave(app)
    expect(board(app).painted).toEqual(stroke([[2, 3], [3, 3], [4, 3]], INK))
  }, SLOW)

  test('undo and redo from GPUI window keys with modifiers: Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, ⌘Z', async () => {
    app = await openHeadless('pixel-art')
    await tap(app, 1, 1)
    await tap(app, 2, 2)
    await tap(app, 3, 3)
    // Off the board, so no cell shows the brush's preview.
    await leave(app)
    expect(Object.keys(board(app).painted)).toEqual(['1,1', '2,2', '3,3'])

    await shortcut(app, 'ctrl-z')
    expect(Object.keys(board(app).painted)).toEqual(['1,1', '2,2'])
    expect(history(app.texts())).toEqual(['Forward 1', 'Current', 'Back 1', 'Back 2'])
    await shortcut(app, 'cmd-z')
    expect(Object.keys(board(app).painted)).toEqual(['1,1'])

    await shortcut(app, 'ctrl-shift-z')
    expect(Object.keys(board(app).painted)).toEqual(['1,1', '2,2'])
    await shortcut(app, 'ctrl-y')
    expect(Object.keys(board(app).painted)).toEqual(['1,1', '2,2', '3,3'])
    expect(history(app.texts())).toEqual(['Current', 'Back 1', 'Back 2', 'Back 3'])

    // A plain z is not undo; the Undo button is.
    await app.key('z')
    expect(Object.keys(board(app).painted)).toHaveLength(3)
    await app.click('Undo')
    expect(Object.keys(board(app).painted)).toHaveLength(2)
    expect(app.inSync()).toBe(true)
  }, SLOW)

  test('time travel: clicking a step in the history goes back to it, and forward again', async () => {
    app = await openHeadless('pixel-art')
    await tap(app, 0, 0)
    await tap(app, 1, 0)
    await tap(app, 2, 0)
    await leave(app)
    await app.click('Back 2')
    expect(Object.keys(board(app).painted)).toEqual(['0,0'])
    expect(history(app.texts())).toEqual(['Forward 2', 'Forward 1', 'Current', 'Back 1'])
    // The current step is highlighted in GPUI.
    const current = Array.from(app.document.querySelectorAll('span')).find(span => span.textContent === 'Current')!.parentElement!
    expect(app.nativeOf(current as unknown as Node).style).toMatchObject({ backgroundColor: INDIGO })
    await app.click('Forward 2')
    expect(Object.keys(board(app).painted)).toEqual(['0,0', '1,0', '2,0'])
  }, SLOW)

  test('tools from the keyboard and the RadioGroup: B, F, E; fill floods, the eraser clears', async () => {
    app = await openHeadless('pixel-art')
    // A vertical wall down column 4.
    for (let y = 0; y < 16; y++) await tap(app, 4, y)

    await app.key('f')
    expect(checked(app.document, 'Drawing tool')).toBe('FillF')
    await tap(app, 0, 0)
    // Everything left of the wall: 4 × 16 cells, plus the wall itself.
    expect(Object.keys(board(app).painted)).toHaveLength(5 * 16)

    await app.key('e')
    expect(checked(app.document, 'Drawing tool')).toBe('EraserE')
    await tap(app, 4, 0)
    expect(board(app).painted['4,0']).toBeUndefined()

    await app.click('Brush')
    expect(checked(app.document, 'Drawing tool')).toBe('BrushB')
    const brush = app.document.querySelector('[aria-label="Drawing tool"] [aria-checked=true]') as unknown as Node
    expect(app.nativeOf(brush).style).toMatchObject({ backgroundColor: INDIGO })
  }, SLOW)

  test('a colour from the palette, and mirror drawing from the Switch', async () => {
    app = await openHeadless('pixel-art')
    await app.click(RED)
    expect(checked(app.document, 'Color palette')).toBe(RED)
    expect(app.texts()).toContain(RED) // the selected colour's label

    await app.click('Mirror horizontal')
    expect(app.document.querySelector('[role=switch]')!.getAttribute('aria-checked')).toBe('true')
    await tap(app, 2, 5)
    expect(board(app).painted).toEqual(stroke([[2, 5], [13, 5]], RED))
  }, SLOW)

  test('the grid size Dialog: Cancel keeps the canvas, confirming resizes it and clears the history', async () => {
    app = await openHeadless('pixel-art')
    await tap(app, 3, 3)

    // A painted canvas asks first.
    await app.click('8')
    const dialog = app.document.querySelector('dialog#grid-size-confirm-dialog') as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(app.texts()).toContain('Change to 8×8?')
    expect(app.texts()).toContain('This will clear your canvas and reset undo history.')
    // The <dialog> fills the window and centres its panel (open:flex).
    expect(app.nativeOf(dialog as unknown as Node).style).toMatchObject({
      display: 'flex', position: 'fixed', alignItems: 'center', justifyContent: 'center',
    })
    expect(app.inSync()).toBe(true)

    await app.click('Cancel')
    expect(dialog.open).toBe(false)
    expect(app.texts()).not.toContain('Change to 8×8?')
    expect(board(app)).toEqual({ size: 16, painted: stroke([[3, 3]], INK) })

    await app.click('8')
    await app.click('Clear and Resize')
    expect(dialog.open).toBe(false)
    expect(board(app)).toEqual({ size: 8, painted: {} })
    expect(checked(app.document, 'Grid size')).toBe('8')
    expect(history(app.texts())).toEqual(['Current'])
  }, SLOW)

  test('Export PNG fails into the error Dialog (no 2D canvas yet), and Dismiss closes it', async () => {
    app = await openHeadless('pixel-art')
    await app.click('Export PNG')
    await until(app, () => app.texts().includes('Export Failed'))
    expect(app.texts().slice(-3)).toEqual(['Export Failed', 'Canvas 2D context not available', 'Dismiss'])
    await app.click('Dismiss')
    expect(app.texts()).not.toContain('Export Failed')
  }, SLOW)

  test('the palette theme Listbox opens, and picking a theme recolours the palette', async () => {
    app = await openHeadless('pixel-art')
    await tap(app, 0, 0)
    await app.click('Syntax')
    expect(app.texts()).toEqual(expect.arrayContaining(['ISO50', 'Sunset', 'Ocean', 'Mono']))
    expect(app.document.querySelector('[role=listbox]')).not.toBeNull()

    await app.click('Ocean')
    expect(app.document.querySelector('[role=listbox]')).toBeNull()
    // The painted cell is a palette index, so it takes Ocean's colour 0.
    expect(board(app).painted['0,0']).toBe('#0a1628')
    expect(app.texts()).toContain('Ocean')
  }, SLOW)
})

describe('saved canvas', () => {
  let app: Headless
  afterEach(() => app?.close())

  test('comes in as Flags from localStorage, and is saved back after each change', async () => {
    // An 8 × 8 canvas with one red cell in the corner, saved by an earlier run.
    const grid = Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x) => (x === 7 && y === 7 ? { _tag: 'Some', value: 4 } : { _tag: 'None' })))
    app = await openHeadless('pixel-art', { storage: { [STORAGE_KEY]: JSON.stringify({ grid, gridSize: 8, paletteThemeIndex: 0, selectedColorIndex: 4 }) } })

    expect(board(app).size).toBe(8)
    expect(board(app).painted).toEqual({ '7,7': RED })

    // Paint, then undo: FoldKit's SaveCanvas Command writes the canvas back.
    await tap(app, 0, 0)
    await shortcut(app, 'ctrl-z')
    for (let i = 0; i < 20 && app.localStorage.getItem(STORAGE_KEY)?.includes('"selectedColorIndex":4') !== true; i++) {
      await sleep(10)
      await app.settle()
    }
    const saved = Schema.decodeSync(SavedCanvasJsonString)(app.localStorage.getItem(STORAGE_KEY)!)
    expect(saved.gridSize).toBe(8)
    expect(saved.selectedColorIndex).toBe(4)
  }, SLOW)
})

describe('a stroke across a 32 × 32 board, measured', () => {
  let app: Headless
  afterEach(() => app?.close())

  test('the document → GPUI sync for each cell the pointer crosses', async () => {
    const syncs: Array<{ syncMs: number; mutations: number }> = []
    const empty = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => ({ _tag: 'None' })))
    app = await openHeadless('pixel-art', {
      onSynced: timings => syncs.push(timings),
      storage: { [STORAGE_KEY]: JSON.stringify({ grid: empty, gridSize: 32, paletteThemeIndex: 0, selectedColorIndex: 0 }) },
    })
    expect(board(app).size).toBe(32)
    const first = { syncMs: syncs.reduce((total, sync) => total + sync.syncMs, 0), mutations: syncs.reduce((total, sync) => total + sync.mutations, 0) }

    // A diagonal stroke: every step changes a row and the history thumbnail.
    await press(app, 0, 0)
    syncs.length = 0
    const started = performance.now()
    for (let i = 1; i < 32; i++) await move(app, i, i)
    const elapsed = performance.now() - started
    await release(app)
    const steps = syncs.filter(sync => sync.mutations > 0)
    const median = (values: Array<number>) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
    const report = {
      cells: 32 * 32,
      firstRender: { syncMs: +first.syncMs.toFixed(2), mutations: first.mutations },
      steps: steps.length,
      syncMs: { median: +median(steps.map(s => s.syncMs)).toFixed(2), max: +Math.max(...steps.map(s => s.syncMs)).toFixed(2) },
      mutationsPerStep: median(steps.map(s => s.mutations)),
      msPerCellCrossed: +(elapsed / 31).toFixed(1),
    }
    console.log('pixel-art stroke:', JSON.stringify(report))

    for (let i = 0; i < 32; i++) expect(board(app).painted[`${i},${i}`]).toBe(INK)
    // Loose budgets, to catch "broken" on noisy CI machines: FoldKit's keyed
    // lazy rows mean a step touches one row, not the whole board.
    expect(steps.length).toBeGreaterThanOrEqual(31)
    expect(report.syncMs.median).toBeLessThan(30)
  }, SLOW)
})

/** The colour GPUI painted at a point, in logical pixels. */
const colourAt = (shot: ReturnType<Metal['screenshot']>, point: { x: number; y: number }) => {
  const [r, g, b] = pixelAt(shot, shot.logicalSize, point)
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`
}

describe.skipIf(!METAL)('Metal, offscreen', () => {
  let app: Metal
  afterEach(() => app?.close())

  test('GPUI paints the editor; drags through its hit testing paint; ⌘Z, the history and a Dialog', async () => {
    app = await openMetal('pixel-art')
    const centre = (x: number, y: number) => {
      const box = app.boundsOf(cellOf(app.document, x, y) as unknown as Element, `cell ${x},${y}`)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const domColour = (x: number, y: number) => (cellOf(app.document, x, y) as unknown as HTMLElement).style.backgroundColor
    const dragAcross = async (cells: Array<[number, number]>) => {
      const [first, ...rest] = cells.map(([x, y]) => centre(x, y))
      // Over the board before pressing, as a hand gets there.
      app.renderer.nativeSimulateMouseMove(first!.x, first!.y)
      await app.settle()
      app.renderer.nativeSimulateMouseDown(first!.x, first!.y)
      await app.settle()
      for (const point of rest) {
        app.renderer.nativeSimulateMouseMove(point.x, point.y, 0)
        await app.settle()
      }
      const last = rest.at(-1) ?? first!
      app.renderer.nativeSimulateMouseUp(last.x, last.y)
      await app.settle()
    }

    app.screenshot('editor')
    expect(app.painted()).toEqual(expect.arrayContaining(['PixelForge', 'TOOLS', 'HISTORY', 'Current']))
    // The board is laid out as a square of square cells.
    const board = app.boundsOf(gridOf(app.document), 'board')
    expect(board.width).toBeGreaterThan(200)
    expect(Math.abs(board.width - board.height)).toBeLessThan(2)

    // A horizontal stroke in ink, dragged through GPUI's hit testing.
    const row: Array<[number, number]> = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4]]
    await dragAcross(row)
    for (const [x, y] of row) expect(domColour(x, y)).toBe(INK)
    expect(colourAt(app.screenshot('stroke'), centre(5, 4))).toBe(INK)

    // Red, from the palette, and a vertical stroke.
    const swatch = app.document.querySelector('[aria-label="Color palette"]')!.children[4]!
    const box = app.boundsOf(swatch, 'red swatch')
    app.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
    await app.settle()
    const column: Array<[number, number]> = [[12, 2], [12, 3], [12, 4], [12, 5], [12, 6], [12, 7], [12, 8]]
    await dragAcross(column)
    const painting = app.screenshot('painting')
    expect(colourAt(painting, centre(12, 6))).toBe(RED)
    expect(colourAt(painting, centre(5, 4))).toBe(INK)

    // Undo and redo through GPUI's keystrokes.
    await app.keys('cmd-z')
    expect(domColour(12, 6)).toBe(WHITE)
    await app.keys('cmd-shift-z')
    expect(domColour(12, 6)).toBe(RED)

    // Time travel: back to before the red stroke, through the history panel.
    await app.click('Back 1')
    expect(domColour(12, 6)).toBe(WHITE)
    expect(app.painted()).toEqual(expect.arrayContaining(['Forward 1', 'Current']))
    app.screenshot('history')

    // The grid size Dialog, and Cancel.
    await app.click('8')
    expect(app.painted()).toContain('Change to 8×8?')
    app.screenshot('dialog')
    await app.click('Cancel')
    expect(app.painted()).not.toContain('Change to 8×8?')
    expect(gridOf(app.document).children).toHaveLength(16)


    // The palette theme Listbox opens, as wide as its button: FoldKit sizes
    // it from getBoundingClientRect, which GPUI's layout now answers.
    await app.click('Syntax')
    const panel = app.boundsOf(app.document.querySelector('[role=listbox]')!, 'listbox')
    expect(panel.width).toBeGreaterThan(100)
    app.screenshot('listbox')
  }, SLOW)

  // FoldKit clears the brush preview on the board's mouseleave. GPUI only
  // hovers the topmost element listening under the pointer, and the board is
  // all cells, so on the mirror the board itself is never entered or left:
  // the preview stays on the last cell after the pointer goes. The adapter
  // follows the pointer itself and fires mouseleave on an ancestor whichever
  // child the pointer leaves through, as a browser does.
  test.skipIf(RENDERER !== 'gpuix')('moving off the board clears the brush preview', async () => {
    app = await openMetal('pixel-art')
    const cell = app.boundsOf(cellOf(app.document, 5, 5) as unknown as Element, 'cell 5,5')
    app.renderer.nativeSimulateMouseMove(cell.x + cell.width / 2, cell.y + cell.height / 2)
    await app.settle()
    expect((cellOf(app.document, 5, 5) as unknown as HTMLElement).style.backgroundColor).toBe(INK)
    const away = app.bounds('Undo')
    app.renderer.nativeSimulateMouseMove(away.x + away.width / 2, away.y + away.height / 2)
    await app.settle()
    expect((cellOf(app.document, 5, 5) as unknown as HTMLElement).style.backgroundColor).toBe(WHITE)
  }, SLOW)

  // floating-ui (under @foldkit/ui's anchor) caps the panel at the room left
  // in the viewport, read from documentElement.clientHeight and the scroll
  // ancestors' clientHeight. On the mirror happy-dom has no layout, so those
  // are 0, the panel's max-height is 0px, and its options are clipped away.
  // The adapter answers them from GPUI's layout.
  test.skipIf(RENDERER !== 'gpuix')('the theme Listbox shows its options, and picking one recolours the board', async () => {
    app = await openMetal('pixel-art')
    await app.click('Syntax')
    expect(app.boundsOf(app.document.querySelector('[role=listbox]')!, 'listbox').height).toBeGreaterThan(100)
    expect(app.painted()).toEqual(expect.arrayContaining(['ISO50', 'Sunset', 'Ocean', 'Mono']))
    app.screenshot('theme-list')
    await app.click('Ocean')
    expect(app.document.querySelector('[role=listbox]')).toBeNull()
    expect(app.painted()).toContain('Ocean')
    app.screenshot('ocean')
  }, SLOW)

  test('a drag across a 32 × 32 board through GPUI: every cell it crosses, and how many moves a second', async () => {
    app = await openMetal('pixel-art')
    // An empty canvas changes size without asking.
    await app.click('32')
    expect(gridOf(app.document).children).toHaveLength(32)
    const centre = (x: number, y: number) => {
      const box = app.boundsOf(cellOf(app.document, x, y) as unknown as Element, `cell ${x},${y}`)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    // Corner to corner, two moves a cell, each one drawn by GPUI before the
    // next: a move, then one frame, as a window gets them (nativeSimulate*
    // would lay out and paint twice per move).
    const from = centre(0, 0)
    const to = centre(31, 31)
    const moves = 31 * 2
    app.renderer.nativeSimulateMouseDown(from.x, from.y)
    await app.settle()
    const started = performance.now()
    for (let i = 1; i <= moves; i++) {
      app.renderer.dispatchMouseMove(from.x + (to.x - from.x) * i / moves, from.y + (to.y - from.y) * i / moves, 0)
      await app.settle()
    }
    const elapsed = performance.now() - started
    app.renderer.nativeSimulateMouseUp(to.x, to.y)
    await app.settle()
    console.log('pixel-art Metal drag:', JSON.stringify({
      cells: 32 * 32, moves, ms: Math.round(elapsed), movesPerSecond: Math.round(moves / (elapsed / 1000)),
      msPerMove: +(elapsed / moves).toFixed(1),
    }))
    for (let i = 0; i < 32; i++) {
      expect((cellOf(app.document, i, i) as unknown as HTMLElement).style.backgroundColor).toBe(INK)
    }
    app.screenshot('big-stroke')
  }, SLOW)
})
