// Pixel Art's saved canvas survives a restart (FKN-22): FoldKit on gpuix in a
// real window, a separate process driven through gpuix's automation.
// Change the canvas, end the process the way automation does (SIGTERM, with
// no chance to save at close), start it again over the same data folder, and
// the canvas is the one that was saved. Pick a colour from the keyboard (the
// colour group's arrow keys), then change the empty canvas to 8 × 8 without
// painting or changing the palette again. Check the saved bytes and the
// restored grid, with the selected colour shown as text (its hex code).
// On the adapter the canvas cells and
// the swatches have no height yet (gpuix has no aspect-ratio, M0 memo), so a
// person can't click one; painting and saving are covered headlessly
// (native.test.ts).
// Needs a logged-in macOS session (FOLDKIT_NATIVE_NO_WINDOW=1 skips it), or
// Linux inside scripts/wayland-session.sh.
import { afterAll, describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { WINDOWS, screenshotWindow } from '../../test/support/windows.ts'
import { STORAGE_KEY } from './constant'
import { createEmptyGrid } from './grid'
import { SavedCanvasJsonString } from './model'

const dataDir = mkdtempSync(join(tmpdir(), 'pixel-art-data-'))
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))
const evidence = process.env['FOLDKIT_NATIVE_EVIDENCE']

describe.skipIf(!WINDOWS)('Pixel Art, native window, two launches', () => {
  const launchOnce = async () => {
    const { launch } = await import('@gpuix/native/automation')
    const app = await launch({
      command: process.execPath, args: ['examples/open.ts', 'pixel-art'],
      cwd: resolve(import.meta.dir, '../..'),
      env: { ...process.env, FOLDKIT_NATIVE_RENDERER: 'gpuix', FOLDKIT_NATIVE_DATA_DIR: dataDir, FOLDKIT_NATIVE_AUTOMATION: '1' },
    })
    await app.getByText('PixelForge').waitFor({ timeoutMs: 10_000 })
    // The sidebar paints a frame or two after the header.
    await new Promise(resolve => setTimeout(resolve, 500))
    type Call = (method: string, params: Record<string, unknown>) => Promise<unknown>
    const call = (app as unknown as { call: Call }).call.bind(app)
    /** The selected colour, as the sidebar prints it: the first hex code
     *  GPUI has (the swatches' own come after it). */
    const colour = async () => ((await call('getAllText', {})) as { text: Array<string> }).text.find(text => text.startsWith('#'))
    /** The native tree's square of rows and empty leaf divs, even when its
     *  cells have no height to hit-test. No input is needed after relaunch. */
    const hasGridSize = async (size: number) => {
      type Tree = { type: string; children?: Array<Tree> }
      const { tree } = await call('getTree', {}) as { tree: Tree | null }
      const hasGrid = (node: Tree): boolean =>
        (node.children?.length === size && node.children.every(row =>
          row.children?.length === size && row.children.every(cell =>
            cell.type === 'div' && (cell.children?.length ?? 0) === 0))) ||
        (node.children ?? []).some(hasGrid)
      return tree !== null && hasGrid(tree)
    }
    return { app, call, colour, hasGridSize }
  }
  const settle = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms))

  test('a colour and empty canvas size picked before the process ended are restored when it starts again', async () => {
    const file = join(dataDir, 'localStorage.json')
    const savedCanvas = () => Schema.decodeSync(SavedCanvasJsonString)(JSON.parse(readFileSync(file, 'utf8'))[STORAGE_KEY])
    const first = await launchOnce()
    let picked: string | undefined
    try {
      const start = await first.colour()
      expect(start).toBe('#262427')
      expect(await first.hasGridSize(16)).toBe(true)
      // Focus the grid size group (16 is already chosen), Tab to the colour
      // group, and move its selection one to the right.
      await first.app.getByText('16').click()
      await settle(200)
      await first.call('keystrokes', { keys: 'tab' })
      await settle(200)
      await first.call('keystrokes', { keys: 'right' })
      for (let i = 0; i < 20 && (await first.colour()) === start; i++) await settle(100)
      picked = await first.colour()
      expect(picked).not.toBe(start)
      // Written through: on disk before anything closes.
      for (let i = 0; i < 20 && !existsSync(file); i++) await settle(100)
      const before = savedCanvas()
      expect(before.selectedColorIndex).toBe(1)
      expect(before.gridSize).toBe(16)
      expect(before.grid).toEqual(createEmptyGrid(16))

      // Resize the blank canvas and make no further painting/palette changes.
      await first.app.getByTestId('grid-size-picker-option-0').getByText('8').click()
      for (let i = 0; i < 20 && savedCanvas().gridSize !== 8; i++) await settle(100)
      const resized = savedCanvas()
      expect(resized.gridSize).toBe(8)
      expect(resized.grid).toEqual(createEmptyGrid(8))
      expect(resized.selectedColorIndex).toBe(before.selectedColorIndex)
      expect(resized.paletteThemeIndex).toBe(before.paletteThemeIndex)
      expect(await first.hasGridSize(8)).toBe(true)
      if (evidence !== undefined) await screenshotWindow(first.app, join(evidence, 'pixel-art-restart-1-picked.png'))
    } finally {
      // gpuix's automation ends the app with SIGTERM: no close, no flush.
      await first.app.close()
    }
    await settle(500)

    const second = await launchOnce()
    try {
      const after = await second.colour()
      console.log(`Pixel Art restart: #262427 at the first start, ${picked} picked, ${after} at the second start`)
      expect(after).toBe(picked)
      expect(await second.hasGridSize(8)).toBe(true)
      const restored = savedCanvas()
      expect(restored.gridSize).toBe(8)
      expect(restored.grid).toEqual(createEmptyGrid(8))
      expect(restored.selectedColorIndex).toBe(1)
      const { text } = await second.call('getAllText', {}) as { text: Array<string> }
      expect(text.filter(item => /^(Back|Forward) \d+$|^Current$/.test(item))).toEqual(['Current'])
      if (evidence !== undefined) await screenshotWindow(second.app, join(evidence, 'pixel-art-restart-2-relaunched.png'))
    } finally {
      await second.app.close()
    }
  }, 60_000)
})
