// Real windows, driven through gpuix's automation channel (a separate process
// per app). Two places they can open:
//
// - macOS: the logged-in desktop. FOLDKIT_NATIVE_NO_WINDOW=1 skips them.
// - Linux: only inside scripts/wayland-session.sh, which runs a throwaway
//   headless Hyprland and sets FKN_LINUX_WINDOWS=1 and its own
//   WAYLAND_DISPLAY. Never on the desktop you're sitting at: without that
//   variable they skip, so a plain `bun test` can't open a window on it.
//
// gpuix 0.10 can't read a frame back on Linux (`screenshot` is macOS and
// Windows only), so `screenshotWindow` asks the compositor instead.

import { execFileSync } from 'node:child_process'

export const WINDOWS =
  (process.platform === 'darwin' && process.env['FOLDKIT_NATIVE_NO_WINDOW'] === undefined) ||
  (process.platform === 'linux' && process.env['FKN_LINUX_WINDOWS'] === '1' && (process.env['WAYLAND_DISPLAY'] ?? '') !== '')

type Screenshots = { screenshot(options: { path: string }): Promise<string> }

/** A PNG of the window as it is painted. macOS: gpuix's own frame. Linux: the
 *  session's compositor output (`grim`), which the window fills. */
export const screenshotWindow = async (app: Screenshots, path: string): Promise<void> => {
  if (process.platform === 'linux') execFileSync('grim', [path])
  else await app.screenshot({ path })
}
