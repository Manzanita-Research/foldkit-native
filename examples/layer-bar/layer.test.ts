// Layer bar as a real layer-shell surface, on Linux in a throwaway headless
// compositor (scripts/wayland-session.sh: headless sway, nobody's desktop).
// Skips itself anywhere else:
//
//   scripts/wayland-session.sh -- bun test examples/layer-bar/layer.test.ts
//
// What shows the surface is anchored, with its exclusive zone: it isn't one
// of sway's windows (a layer surface isn't); it's as wide as the output and
// as thick as asked; an ordinary window opened beside it is tiled below it,
// starting the bar's thickness down; and once the bar closes, that window
// takes the whole output again. A compositor screenshot of each goes to
// $FOLDKIT_NATIVE_EVIDENCE (or the session's shots folder).
import { afterAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { readPng } from '../../test/support/png.ts'
import { WINDOWS } from '../../test/support/windows.ts'
import { barWindow } from './app.ts'

const SESSION = process.platform === 'linux' && WINDOWS && process.env['FKN_SWAYSOCK'] !== undefined
const root = resolve(import.meta.dir, '../..')
const shots = process.env['FOLDKIT_NATIVE_EVIDENCE'] ?? process.env['FKN_WAYLAND_SHOTS'] ?? '/tmp'
if (SESSION) mkdirSync(shots, { recursive: true })
const THICKNESS = barWindow.height!

const sway = (...args: Array<string>) => execFileSync('swaymsg', ['-s', process.env['FKN_SWAYSOCK']!, '-r', ...args], { encoding: 'utf8' })
const settle = (ms: number) => new Promise(done => setTimeout(done, ms))

type Rect = { x: number; y: number; width: number; height: number }
type Node = { app_id?: string | null; name?: string | null; rect: Rect; nodes?: Array<Node>; floating_nodes?: Array<Node> }
/** Every window sway manages, by app id, with where it put it. */
const windows = (): Map<string, Rect> => {
  const found = new Map<string, Rect>()
  const walk = (node: Node) => {
    if (node.app_id) found.set(node.app_id, node.rect)
    for (const child of [...(node.nodes ?? []), ...(node.floating_nodes ?? [])]) walk(child)
  }
  walk(JSON.parse(sway('-t', 'get_tree')) as Node)
  return found
}
const outputRect = (): Rect => (JSON.parse(sway('-t', 'get_outputs')) as Array<{ name: string; rect: Rect }>).find(output => output.name === process.env['FKN_WAYLAND_OUTPUT'])!.rect

const open = async (id: string) => {
  const { launch } = await import('@gpuix/native/automation')
  const app = await launch({
    command: process.execPath, args: ['examples/open.ts', id], cwd: root,
    env: { ...process.env, FOLDKIT_NATIVE_AUTOMATION: '1', FOLDKIT_NATIVE_RENDERER: 'gpuix' },
  })
  const call = (method: string, params: Record<string, unknown> = {}) =>
    (app as unknown as { call: (method: string, params: Record<string, unknown>) => Promise<unknown> }).call(method, params)
  // gpuix's painted text is empty on Linux: the retained tree's text it is.
  for (const until = performance.now() + 15_000; performance.now() < until; await settle(50)) {
    if (((await call('getAllText')) as { text: Array<string> }).text.length > 0) break
  }
  await settle(600)
  return { app, call }
}
type Opened = Awaited<ReturnType<typeof open>>

/** A compositor screenshot, and the colour at a point of it. */
const shoot = (name: string) => {
  const file = join(shots, `layer-bar-${name}.png`)
  execFileSync('grim', ['-o', process.env['FKN_WAYLAND_OUTPUT']!, file])
  const image = readPng(file)
  return { file, at: (x: number, y: number) => image.pixel(x, y) }
}

describe.skipIf(!SESSION)('Layer bar, a layer-shell surface (headless compositor)', () => {
  const opened: Array<Opened> = []
  afterAll(async () => {
    for (const each of opened) await each.app.close().catch(() => {})
  })

  test('anchored along the top at its thickness, with an exclusive zone that keeps an ordinary window below it', async () => {
    const output = outputRect()
    const bar = await open('layer-bar')
    opened.push(bar)
    // Not one of sway's windows: a layer surface.
    expect(windows().has(barWindow.appId!)).toBe(false)
    // As wide as the output (the compositor's size, not the fallback's 720)
    // and as thick as asked. The window's box (the tree's root) and the
    // bar's own (the app's first element) at 0, 250 and 1000 ms, as the
    // compositor's size arrives, then until both are the output's width.
    type Box = { bounds: Rect; children?: Array<Box> }
    const boxes = async () => {
      const { tree } = (await bar.call('getTree')) as { tree: Box }
      const app = tree.children?.find(child => child.bounds.width > 0 && child.bounds.height > 0)
      return { window: tree.bounds, app: app?.bounds }
    }
    const started = performance.now()
    for (const at of [0, 250, 1000]) {
      await settle(Math.max(0, at - (performance.now() - started)))
      console.log(`layer bar at ${at} ms: output ${JSON.stringify(output)}, ${JSON.stringify(await boxes())}`)
    }
    let sized = await boxes()
    for (const until = performance.now() + 3000; performance.now() < until && (sized.window.width !== output.width || sized.app?.width !== output.width); await settle(100)) {
      sized = await boxes()
    }
    console.log('layer bar:', JSON.stringify(sized))
    expect(sized.window).toMatchObject({ width: output.width, height: THICKNESS })
    expect(sized.app).toMatchObject({ width: output.width, height: THICKNESS })
    const alone = shoot('alone')

    // An ordinary window is tiled below the bar's exclusive zone.
    const form = await open('form')
    opened.push(form)
    const tiled = windows().get('dev.foldkit-native.form')!
    console.log('beside the bar, an ordinary window is at', JSON.stringify(tiled))
    expect(tiled).toEqual({ x: output.x, y: output.y + THICKNESS, width: output.width, height: output.height - THICKNESS })
    const both = shoot('with-window')
    // The bar is still painted over the top THICKNESS rows, the window under them.
    expect(both.at(Math.round(output.width / 2), 2)).toEqual(alone.at(Math.round(output.width / 2), 2))

    // The bar goes: the window takes the whole output.
    await bar.app.close()
    opened.splice(opened.indexOf(bar), 1)
    await settle(800)
    const after = windows().get('dev.foldkit-native.form')!
    console.log('once the bar has gone, the window is at', JSON.stringify(after))
    expect(after).toEqual({ x: output.x, y: output.y, width: output.width, height: output.height })
    shoot('bar-gone')
    console.log('screenshots:', alone.file, both.file)
  }, 60_000)
})
