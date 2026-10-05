// native-ui in a real window (FoldKit on gpuix, a separate process),
// driven through gpuix's automation channel. A button activates on Space's
// key-up, as in a browser. gpuix's `keystrokes` sends key-down only, in a
// live window as offscreen, so a whole "space" keystroke from automation
// does nothing; key-down then key-up activates once, on the release. (A
// physical keyboard sends both; that part still wants a person.)
// Needs a logged-in macOS session (FOLDKIT_NATIVE_NO_WINDOW=1 skips it), or
// Linux inside scripts/wayland-session.sh.
import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { WINDOWS } from '../../test/support/windows.ts'

describe.skipIf(!WINDOWS)('native-ui, native window', () => {
  test('Tab reaches the switch; Space flips the theme once, on its release', async () => {
    const { launch } = await import('@gpuix/native/automation')
    const app = await launch({
      command: process.execPath, args: ['examples/open.ts', 'native-ui'],
      cwd: resolve(import.meta.dir, '../..'), env: { ...process.env },
    })
    type Call = (method: string, params: Record<string, unknown>) => Promise<unknown>
    const call = (app as unknown as { call: Call }).call.bind(app)
    const theme = async () => {
      const text = await app.getByText('FoldKit on gpuix').textContent()
      return text.includes('· dark') ? 'dark' : text.includes('· light') ? 'light' : text
    }
    const settle = () => new Promise(resolve => setTimeout(resolve, 150))
    try {
      await app.getByText('Dark theme').waitFor({ timeoutMs: 8000 })
      expect(await theme()).toBe('dark')
      // Tab: the page's first stop, then name, email, the switch.
      for (const _ of [1, 2, 3, 4]) {
        await call('keystrokes', { keys: 'tab' })
        await settle()
      }
      const seen: Array<string> = [await theme()]
      // A whole keystroke, as the automation channel sends one: down only.
      await call('keystrokes', { keys: 'space' })
      await settle()
      seen.push(await theme())
      // Down, then up, apart: the activation comes with the release.
      await call('keyDown', { key: 'space' })
      await settle()
      seen.push(await theme())
      await call('keyUp', { key: 'space' })
      await settle()
      seen.push(await theme())
      console.log('native-ui window, Space:', JSON.stringify(seen))
      expect(seen).toEqual(['dark', 'dark', 'dark', 'light'])
    } finally {
      await app.close()
    }
  })
})
