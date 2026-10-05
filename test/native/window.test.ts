// The real thing: the examples as separate processes, in real windows, driven
// through gpuix's automation channel (stdin/stdout) and read back from the
// window's own Metal frames. Needs a logged-in macOS desktop session; set
// FOLDKIT_NATIVE_NO_WINDOW=1 to skip on a Mac without one. On Linux they run
// inside scripts/wayland-session.sh (a headless Hyprland), read back with grim.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { near, readPng, rgb } from '../support/png.ts'
import { WINDOWS, screenshotWindow } from '../support/windows.ts'
const out = mkdtempSync(join(tmpdir(), 'foldkit-native-window-'))
afterAll(() => rmSync(out, { recursive: true, force: true }))

/** Loose for now: these catch "broken", not "a bit slower". See TESTING.md. */
const BUDGET = { launchToFirstTextMs: 5000, clickToTextMs: 1000 }

const open = async (example: string, env: Record<string, string> = {}) => {
  const { launch } = await import('@gpuix/native/automation')
  const started = performance.now()
  const app = await launch({ command: process.execPath, args: [`examples/${example}.ts`], cwd: resolve(import.meta.dir, '../..'), env: { ...process.env, ...env } })
  return { app, started }
}

describe.skipIf(!WINDOWS)('native window', () => {
  test('counter: launches, draws, and a click changes the model', async () => {
    const { app, started } = await open('counter')
    try {
      await app.getByText('Count: 0').waitFor({ timeoutMs: BUDGET.launchToFirstTextMs })
      const firstText = performance.now() - started
      const first = join(out, 'counter-0.png')
      await screenshotWindow(app, first)
      const image = readPng(first)
      expect(near(image.pixel(image.width - 5, image.height - 5), rgb('#1d1d21'))).toBe(true)

      const clicked = performance.now()
      await app.getByText('+1').click()
      await app.getByText('Count: 1').waitFor({ timeoutMs: BUDGET.clickToTextMs })
      const clickToText = performance.now() - clicked
      await app.getByText('+1').click()
      await app.getByText('+1').click()
      await app.getByText('Count: 3').waitFor({ timeoutMs: BUDGET.clickToTextMs })
      await app.getByText('Reset').click()
      await app.getByText('Count: 0').waitFor({ timeoutMs: BUDGET.clickToTextMs })
      console.log(`counter: first text ${firstText.toFixed(0)} ms after launch, click → text ${clickToText.toFixed(0)} ms`)
    } finally {
      await app.close()
    }
  }, 20_000)

  test('themes: the switch swaps every token live', async () => {
    const { app } = await open('themes')
    try {
      await app.getByText('switch theme (dusk)').waitFor({ timeoutMs: BUDGET.launchToFirstTextMs })
      const corner = async (name: string) => {
        const path = join(out, `${name}.png`)
        await screenshotWindow(app, path)
        const image = readPng(path)
        return image.pixel(image.width - 5, image.height - 5)
      }
      expect(near(await corner('dusk'), rgb('#17151c'))).toBe(true)
      await app.getByText('Threads').click()
      await app.getByText('switch theme (dusk)').click()
      await app.getByText('switch theme (paper)').waitFor({ timeoutMs: BUDGET.clickToTextMs })
      await Bun.sleep(100) // the restyle lands on the next frame
      expect(near(await corner('paper'), rgb('#f4f1ea'))).toBe(true)
      await app.getByText('switch theme (paper)').click()
      await app.getByText('switch theme (dusk)').waitFor({ timeoutMs: BUDGET.clickToTextMs })
      await Bun.sleep(100)
      expect(near(await corner('dusk-again'), rgb('#17151c'))).toBe(true)
    } finally {
      await app.close()
    }
  }, 20_000)
})
