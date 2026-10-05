// FoldKit on gpuix in real windows on Linux/Wayland (FKN-26). gpuix has no
// offscreen renderer or frame read-back on Linux, so this is the Linux test
// session: each app is a separate process in a window on a throwaway headless
// compositor (scripts/wayland-session.sh), driven through gpuix's automation
// channel and read back from the compositor (grim). Skips itself anywhere
// else, so a plain `bun test` never opens a window on a desktop:
//
//   scripts/wayland-session.sh -- bun test packages/foldkit-gpuix/test/linux-session.test.ts
//
// Evidence PNGs go to $FOLDKIT_NATIVE_EVIDENCE, or the session's shots folder.
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { exampleIds } from '../../../examples/support/example.ts'
import { readPng } from '../../../test/support/png.ts'
import { WINDOWS, screenshotWindow } from '../../../test/support/windows.ts'

const SESSION = process.platform === 'linux' && WINDOWS && process.env['FKN_SWAYSOCK'] !== undefined
const root = resolve(import.meta.dir, '../../..')
const shots = process.env['FOLDKIT_NATIVE_EVIDENCE'] ?? process.env['FKN_WAYLAND_SHOTS'] ?? '/tmp'
if (SESSION) mkdirSync(shots, { recursive: true })

const sway = (...args: Array<string>) => execFileSync('swaymsg', ['-s', process.env['FKN_SWAYSOCK']!, '-r', ...args], { encoding: 'utf8' })
const output = () => process.env['FKN_WAYLAND_OUTPUT']!
const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type Opened = Awaited<ReturnType<typeof open>>
const open = async (args: Array<string>, env: Record<string, string> = {}) => {
  const { launch } = await import('@gpuix/native/automation')
  const started = performance.now()
  const app = await launch({ command: process.execPath, args, cwd: root, env: { ...process.env, FOLDKIT_NATIVE_AUTOMATION: '1', ...env } })
  const call = (method: string, params: Record<string, unknown> = {}) =>
    (app as unknown as { call: (method: string, params: Record<string, unknown>) => Promise<unknown> }).call(method, params)
  const texts = async () => ((await call('getAllText')) as { text: Array<string> }).text
  const waitForText = async (timeoutMs: number) => {
    for (const until = performance.now() + timeoutMs; performance.now() < until; await settle(20)) {
      if ((await texts()).length >= 1) return performance.now() - started
    }
    throw new Error(`${args.join(' ')} showed no text in ${timeoutMs} ms`)
  }
  return { app, call, texts, waitForText }
}

/** How many different colours a screenshot has, sampled on a grid. */
const colours = (path: string) => {
  const image = readPng(path)
  const seen = new Set<string>()
  for (let y = 4; y < image.height; y += 9) for (let x = 4; x < image.width; x += 9) seen.add(image.pixel(x, y).join(','))
  return seen.size
}

const windows = () => (sway('-t', 'get_tree').match(/"app_id": "([^"]*)"/g) ?? []).map(entry => entry.slice(11, -1))

describe.skipIf(!SESSION)('FoldKit on gpuix, a real window on Linux (headless compositor)', () => {
  const opened: Array<Opened> = []
  afterAll(async () => {
    for (const each of opened) await each.app.close()
  })

  for (const id of exampleIds()) {
    test(`${id}: paints in a window, and the compositor's frame shows it`, async () => {
      const win = await open(['examples/open.ts', id], { FOLDKIT_NATIVE_RENDERER: 'gpuix' })
      opened.push(win)
      const firstText = await win.waitForText(15_000)
      await settle(800) // a frame or two for the rest to paint
      expect(windows()).toContain(`dev.foldkit-native.${id}`)
      const file = join(shots, `linux-${id}.png`)
      await screenshotWindow(win.app, file)
      const distinct = colours(file)
      console.log(`${id}: first text ${firstText.toFixed(0)} ms after spawn, ${distinct} colours in the compositor's frame`)
      // A window GPUI hasn't painted is one flat colour (or black).
      expect(distinct).toBeGreaterThan(8)
      await win.app.close()
      opened.splice(opened.indexOf(win), 1)
    }, 30_000)
  }

  // Why m6's live window "didn't paint for automation" (FKN-26): GPUI draws on
  // the compositor's frame callbacks, and a compositor sends none to an output
  // that's asleep (DPMS off). Once the app asks for a frame (any repaint),
  // gpuix's queries that run on the UI thread (`getTree`, `getBounds`, every
  // click's lookup) wait for it, so they time out after 2 s; `getAllText` is
  // read from JavaScript and doesn't. The app itself keeps running.
  // A headless output can't sleep. This turns the output off and on again.
  test('with the output asleep, UI-thread queries time out after 2 s; awake again, they answer', async () => {
    const win = await open(['examples/open.ts', 'big-list'], { FOLDKIT_NATIVE_RENDERER: 'gpuix' })
    opened.push(win)
    await win.waitForText(15_000)
    await settle(500)
    const tree = async () => {
      const started = performance.now()
      const result = await win.call('getTree').then(() => 'answered', (error: Error) => String(error.message))
      return { result, ms: performance.now() - started }
    }
    expect((await tree()).result).toBe('answered')
    try {
      sway('output', output(), 'power', 'off')
      for (let waited = 0; sway('-t', 'get_outputs').includes('"power": true') && waited < 2000; waited += 50) await settle(50)
      await settle(1000) // the compositor stops its frame callbacks a moment after
      // An idle window has no frame outstanding and still answers: it takes a
      // repaint (here a click on the title; in an app, any state change) to
      // ask for a frame that never comes.
      await win.call('click', { x: 120, y: 40 }).catch(() => undefined)
      const asleep = await tree()
      expect(asleep.result).toMatch(/Timed out after 2 seconds/)
      expect(asleep.ms).toBeGreaterThan(1500)
      expect((await win.texts()).length).toBeGreaterThan(3) // JavaScript's own view never blocks
    } finally {
      sway('output', output(), 'power', 'on')
    }
    await settle(300)
    const awake = await tree()
    expect(awake.result).toBe('answered')
    expect(awake.ms).toBeLessThan(1000)
    await win.app.close()
    opened.splice(opened.indexOf(win), 1)
  }, 30_000)

  // gpuix 0.10's painted-text read is empty on Linux while a window is
  // painted (its record is likely thread-local to GPUI's own UI thread). So
  // waits that mean "painted" (scripts/measure.ts on macOS) use `getAllText`
  // here, a frame early. When this fails, gpuix fixed it: use painted text.
  test('getPaintedText is empty on Linux although the window is painted', async () => {
    const win = await open(['examples/open.ts', 'big-list'], { FOLDKIT_NATIVE_RENDERER: 'gpuix' })
    opened.push(win)
    await win.waitForText(15_000)
    await settle(800)
    expect(((await win.call('getPaintedText')) as { text: Array<string> }).text).toEqual([])
    expect((await win.texts()).length).toBeGreaterThan(10)
    await win.app.close()
    opened.splice(opened.indexOf(win), 1)
  }, 30_000)
})

// The compositor closes the window (a person's click on its close button
// sends xdg_toplevel.close; sway's `kill` does the same): GPUI's loop ends and
// the adapter runs the close handlers with reason 'window', which can't veto.
describe.skipIf(!SESSION)('a window the compositor closes (Linux)', () => {
  const SCRIPT = join(import.meta.dir, 'app-process.ts')
  const closeFromCompositor = async (mode: string) => {
    const child = Bun.spawn([process.execPath, SCRIPT, mode], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: process.env as Record<string, string> })
    const killer = setTimeout(() => child.kill(), 20_000)
    let out = ''
    void (async () => {
      const reader = child.stdout.getReader()
      for (let read = await reader.read(); !read.done; read = await reader.read()) out += new TextDecoder().decode(read.value)
    })()
    const stderr = new Response(child.stderr).text()
    const until = async (word: string) => {
      for (const limit = performance.now() + 15_000; !out.includes(word); await settle(50)) {
        if (performance.now() > limit) throw new Error(`never said "${word}": ${out}`)
      }
    }
    await until('ready')
    sway('[app_id="dev.foldkit-native.app-process"] kill')
    return { child, killer, out: () => out, until, stderr }
  }

  test('exitOnClose: false: the handlers run with reason "window", app.closed settles, the process goes on, with no frame errors', async () => {
    const { child, killer, out, until, stderr } = await closeFromCompositor('real-window-gone-host')
    try {
      await until('closed')
      await settle(1000) // a loop that never ended would report a frame error each frame
      expect(out()).toMatch(/onClose window \d+/)
      expect(windows()).not.toContain('dev.foldkit-native.app-process')
      expect(child.signalCode).toBeNull() // gpuix 0.10 holds the process open (README: limits)
    } finally {
      child.kill()
      clearTimeout(killer)
    }
    expect(await stderr).not.toContain('frame error')
  }, 30_000)

  test('exitOnClose (the default): the process ends with exit 0 after the handlers ran', async () => {
    const { child, killer, out, stderr } = await closeFromCompositor('real-window-gone-exit')
    const code = await child.exited
    clearTimeout(killer)
    expect(code).toBe(0)
    expect(child.signalCode).toBeNull()
    await settle(100)
    expect(out()).toMatch(/onClose window \d+/)
    expect(await stderr).not.toContain('frame error')
  }, 30_000)
})
