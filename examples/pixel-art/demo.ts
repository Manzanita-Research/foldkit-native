// The walk-through for `bun run record pixel-art`: paint a small heart with
// pointer drags, change colour, undo and redo with ⌘Z / ⌘⇧Z, step back
// through the history, and open the grid size Dialog.
import { type Demo, nth } from '../../scripts/record.ts'

export const ready = 'PixelForge'

/** Cells (x, y) on the 16 × 16 board, a stroke per row. */
const HEART: ReadonlyArray<readonly [number, number, number]> = [
  // [y, fromX, toX]
  [4, 4, 6], [4, 9, 11],
  [5, 3, 12], [6, 3, 12], [7, 3, 12],
  [8, 4, 11], [9, 5, 10], [10, 6, 9], [11, 7, 8],
]

export const demo: Demo = async (app, pause) => {
  const key = (keys: string) => app.call('keystrokes', { keys })
  // Cells have no text to find them by. The board fills the middle of three
  // equal columns (GPUI's grids have equal tracks), square, top-aligned with
  // the TOOLS and HISTORY panels on either side.
  const tools = await app.getByText('TOOLS').bounds()
  const history = await app.getByText('HISTORY').bounds()
  const gap = 24
  const column = (history.x - tools.x) / 2 - gap
  const side = Math.min(512, column)
  const left = tools.x + column + gap + (column - side) / 2
  const cell = (x: number, y: number) => ({ x: left + (x + 0.5) * side / 16, y: tools.y + (y + 0.5) * side / 16 })

  await pause(1000)
  // The swatch's (screen-reader) label; once red is picked it shows twice.
  await app.mouse.click(await nth(app, '#ff7272')); await pause(400)
  for (const [y, fromX, toX] of HEART) {
    await app.mouse.drag(cell(fromX, y), cell(toX, y), { steps: toX - fromX })
    await pause(200)
  }
  await pause(800)

  // Undo the last three strokes, then redo them.
  for (let i = 0; i < 3; i++) { await key('cmd-z'); await pause(350) }
  for (let i = 0; i < 3; i++) { await key('cmd-shift-z'); await pause(350) }
  await pause(600)

  // Back through the history, and forward again.
  await app.getByText('Back 4').click(); await pause(1000)
  await app.getByText('Forward 4').click(); await pause(800)

  // The grid size Dialog, cancelled.
  await app.mouse.click(await nth(app, '8')); await pause(1500)
  await app.getByText('Cancel').click(); await pause(1200)
}
