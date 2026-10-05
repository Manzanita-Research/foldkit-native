// The gallery drawn by GPUI, on FoldKit on gpuix as `bun run gallery` draws
// it (FOLDKIT_NATIVE_RENDERER=mirror runs it on the mirror, as CI does too):
// with more examples than fit the window, the list scrolls under the wheel
// (FKN-14: it didn't, because `overflow: auto` never reached GPUI as a
// scroller), and a click anywhere on a card opens its example (FKN-12).
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { NativeRenderer } from '@gpuix/native/host'
import { mountHeadless, openMetal } from '../../packages/foldkit-gpuix/test/support.ts'
import { attachDom } from '../../src/index.ts'
import { createFakeGpui } from '../../test/support/fake-gpui.ts'
import { METAL, blocks } from '../support/harness.ts'
import { type Entry, Model, init, setLauncher, update, view } from './main'

const MIRROR = process.env['FOLDKIT_NATIVE_RENDERER'] === 'mirror'
const SIZE = { width: 960, height: 760 }
const css = readFileSync(join(import.meta.dir, 'styles.native.css'), 'utf8')
const entries: Array<Entry> = Array.from({ length: 10 }, (_, i) => ({
  id: `example-${i}`, title: `Example ${i}`, blurb: 'A FoldKit app, drawn natively.',
  foldkit: 'Something from FoldKit', gpui: 'Something from GPUI', ported: i % 2 === 0, command: [],
}))

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  setLauncher(() => {})
})

const run = async (container: HTMLElement) => {
  const { Runtime } = await import('foldkit')
  Runtime.run(Runtime.makeElement({ Model, init: init(entries), update, view, container } as never))
}

/** The gallery on the renderer, over `renderer` (the fake GPUI or Metal's).
 *  `idOf` is the gpuix id of the element `selector` finds. */
const open = async (renderer: NativeRenderer) => {
  if (MIRROR) {
    const dom = attachDom(renderer, { css, viewport: SIZE })
    cleanups.push(async () => {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    })
    await run(dom.container)
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        await dom.window.happyDOM.waitUntilComplete()
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      ;(renderer as { flush?: () => void }).flush?.()
    }
    await settle()
    const idOf = (selector: string) => dom.mirror.idFor(dom.window.document.querySelector(selector) as unknown as Node)!
    return { settle, idOf, element: (selector: string) => dom.window.document.querySelector(selector) as unknown as Element, idFor: (element: Element) => dom.mirror.idFor(element as unknown as Node) }
  }
  return undefined
}

/** Headless: the fake GPUI. */
const openHeadless = async () => {
  const gpui = createFakeGpui()
  const onMirror = await open(gpui.renderer)
  if (onMirror !== undefined) return { gpui, ...onMirror, dispatch: async (event: Record<string, unknown>) => {
    const { createRendererState } = await import('@gpuix/native/host')
    createRendererState(gpui.renderer).dispatch(event as never)
  } }
  const app = mountHeadless({ css, viewport: SIZE })
  cleanups.push(() => app.close())
  await run(app.container)
  await app.settle()
  const element = (selector: string) => app.document.querySelector(selector) as unknown as Element
  return {
    gpui: app.gpui, settle: app.settle, element,
    idOf: (selector: string) => app.document.querySelector(selector)!.nativeId,
    idFor: (at: Element) => (at as unknown as { nativeId: number }).nativeId,
    dispatch: async (event: Record<string, unknown>) => void app.host.dispatch(event as never),
  }
}

/** Metal, offscreen: GPUI's own layout, hit testing and wheel. */
const openOnMetal = async () => {
  const { TestRenderer } = await import('@gpuix/native/testing')
  if (MIRROR) {
    const renderer = new TestRenderer(SIZE)
    const onMirror = (await open(renderer as unknown as NativeRenderer))!
    return { renderer, ...onMirror, screenshot: (name: string) => renderer.captureScreenshot(join(evidence(), `gallery-mirror-${name}.png`)) }
  }
  const app = await openMetal('gallery', SIZE, { css })
  cleanups.push(() => app.close())
  await run(app.container)
  await app.settle()
  return {
    renderer: app.renderer, settle: app.settle,
    idOf: (selector: string) => app.document.querySelector(selector)!.nativeId,
    screenshot: (name: string) => app.screenshot(name),
  }
}
const evidence = () => process.env['FOLDKIT_NATIVE_EVIDENCE'] ?? tmpdir()

test('the list is a GPUI scroller', async () => {
  const { gpui, idOf } = await openHeadless()
  expect(gpui.node(idOf('.scroll')).style).toMatchObject({ overflowY: 'scroll' })
})

// FKN-12: a filled child (the badge) blocked GPUI's hit test, so a click on
// it never reached the card. It lets hits through now, as a browser bubbles.
test("a click on a card's badge opens the example", async () => {
  const { gpui, element, idFor, settle, dispatch } = await openHeadless()
  const launched: Array<Array<string>> = []
  setLauncher(command => launched.push(command))
  const native = (at: Element) => gpui.node(idFor(at)!)
  const badge = element('.badge')
  expect(native(badge).style).toMatchObject({ pointerEvents: 'none' })
  expect(native(badge).style['backgroundColor']).toBeDefined()
  // As GPUI's hit test goes: up from the badge to the card listening for the click.
  let at = badge
  while (!native(at).listeners.has('click')) {
    expect(blocks(native(at).style)).toBe(false)
    at = at.parentElement!
  }
  expect(at.getAttribute('aria-label')).toBe('Open Example 0')
  await dispatch({ eventType: 'click', elementId: native(at).id, x: 1, y: 1, button: 0, clickCount: 1 })
  await settle()
  expect(launched).toHaveLength(1)
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  test('the wheel scrolls the list', async () => {
    const { renderer, settle, idOf, screenshot } = await openOnMetal()
    const last = () => renderer.getElementBounds(idOf('.grid > :last-child'))!.y
    const before = last()
    expect(before).toBeGreaterThan(760)
    screenshot('top')
    renderer.nativeSimulateScrollWheel(480, 400, 0, -400)
    await settle()
    renderer.flush()
    screenshot('scrolled')
    expect(last()).toBeLessThan(before - 200)
  })

  test("a click on a card's badge, through GPUI's hit test, opens the example", async () => {
    const { renderer, settle, idOf } = await openOnMetal()
    const launched: Array<Array<string>> = []
    setLauncher(command => launched.push(command))
    const badge = renderer.getElementBounds(idOf('.badge'))!
    renderer.nativeSimulateClick(badge.x + badge.width / 2, badge.y + badge.height / 2)
    await settle()
    expect(launched).toHaveLength(1)
  })
})
