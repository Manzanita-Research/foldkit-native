// STORAGE
//
// `localStorage` and `sessionStorage` for a native window. sessionStorage is
// in memory: a process is a session. localStorage is a file per app,
// `<dataDir>/localStorage.json`, in the platform's place for app data:
//
//   macOS    ~/Library/Application Support/<appId>
//   Linux    $XDG_DATA_HOME/<appId>, or ~/.local/share/<appId>
//   Windows  %APPDATA%\<appId>
//
// Writes go through: each setItem, removeItem and clear rewrites the file
// before it returns (to a temporary file, then renamed over the old one, so a
// crash leaves the old file or the new one, never half of one). Nothing waits
// for a flush at close because nothing can: on macOS, closing the window ends
// the process inside GPUI with no JavaScript running, and gpuix's automation
// closes an app with SIGTERM. A write costs a serialise and a rename of the
// whole store, which is fine at the sizes apps keep there (a 32×32 canvas is
// a few kilobytes). Two processes of one app share the file, and the last
// write wins: there's no `storage` event between them.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** What FoldKit and Effect's `KeyValueStore.layerStorage` use of `Storage`. */
export type NativeStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
  key(index: number): string | null
  readonly length: number
}

const storageOver = (items: Map<string, string>, changed: () => void, beforeWrite: () => void = () => {}): NativeStorage => ({
  getItem: key => items.get(String(key)) ?? null,
  setItem: (key, value) => {
    beforeWrite()
    const previous = items.get(String(key))
    items.set(String(key), String(value))
    try {
      changed()
    } catch (error) {
      // As a browser's quota error: the write didn't happen.
      if (previous === undefined) items.delete(String(key))
      else items.set(String(key), previous)
      throw error
    }
  },
  removeItem: key => {
    const name = String(key)
    if (!items.has(name)) return
    const previous = new Map(items)
    items.delete(name)
    try {
      changed()
    } catch (error) {
      // Reinsert the whole store so rollback preserves key enumeration order.
      items.clear()
      for (const [key, value] of previous) items.set(key, value)
      throw error
    }
  },
  clear: () => {
    if (items.size === 0) return
    const previous = new Map(items)
    items.clear()
    try {
      changed()
    } catch (error) {
      for (const [key, value] of previous) items.set(key, value)
      throw error
    }
  },
  key: index => [...items.keys()][index] ?? null,
  get length() { return items.size },
})

/** In memory, for the window's life. `onWrite` runs before each setItem. */
export const memoryStorage = (onWrite: () => void = () => {}): NativeStorage =>
  storageOver(new Map(), () => {}, onWrite)

/** A safe folder name: letters, digits, dots, dashes and underscores, as
 *  reverse-DNS ids (`dev.jem.jemera`) and Wayland app ids are. */
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Where an app keeps its data on this platform. */
export const dataDirFor = (
  appId: string,
  { platform = process.platform, env = process.env, home = homedir() }: { platform?: string; env?: Record<string, string | undefined>; home?: string } = {},
): string => {
  if (!APP_ID.test(appId) || appId.includes('..')) {
    throw new Error(`appId "${appId}" can't name a folder: use letters, digits, dots, dashes and underscores, as in "dev.example.notes"`)
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', appId)
  if (platform === 'win32') return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), appId)
  // The XDG spec ignores a relative XDG_DATA_HOME.
  const xdg = env['XDG_DATA_HOME']
  return join(xdg !== undefined && isAbsolute(xdg) ? xdg : join(home, '.local', 'share'), appId)
}

/** The store in `<dir>/localStorage.json`, read once now and written through
 *  on every change. A file that isn't a store is set aside as
 *  `localStorage.json.unreadable` (and reported), and the app starts empty. */
export const fileStorage = (dir: string, report: (error: unknown, context: Record<string, unknown>) => void = () => {}): NativeStorage => {
  const path = join(dir, 'localStorage.json')
  const items = new Map<string, string>()
  let text: string | undefined
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') report(error, { path })
  }
  if (text !== undefined) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object of strings')
      const entries = Object.entries(parsed)
      if (entries.some(([, value]) => typeof value !== 'string')) throw new Error('not an object of strings')
      for (const [key, value] of entries) items.set(key, value)
    } catch (error) {
      try {
        renameSync(path, `${path}.unreadable`)
      } catch {}
      report(error, { path, setAside: `${path}.unreadable` })
    }
  }
  const write = () => {
    mkdirSync(dir, { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(items)))
    renameSync(temporary, path)
  }
  return storageOver(items, write)
}
