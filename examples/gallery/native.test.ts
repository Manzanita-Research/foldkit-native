// The gallery drawn by GPUI: with more examples than fit the window, the
// list scrolls under the wheel (FKN-14: it didn't, because `overflow: auto`
// never reached GPUI as a scroller).
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { attachDom } from '../../src/index.ts'
import { createFakeGpui } from '../../test/support/fake-gpui.ts'
import { METAL, blocks } from '../support/harness.ts'
import { type Entry, Model, init, setLauncher, update, view } from './main'

const css = readFileSync(join(import.meta.dir, 'styles.native.css'), 'utf8')
const entries: Array<Entry> = Array.from({ length: 10 }, (_, i) => ({
  id: `example-${i}`, title: `Example ${i}`, blurb: 'A FoldKit app, drawn natively.',
  foldkit: 'Something from FoldKit', gpui: 'Something from GPUI', ported: i % 2 === 0, command: [],
}))

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const open = async (renderer: Parameters<typeof attachDom>[0]) => {
  const dom = attachDom(renderer, { css, viewport: { width: 960, height: 760 } })
  cleanups.push(async () => {
    dom.detach()
    await dom.window.happyDOM.abort()
    dom.window.close()
  })
  const { Runtime } = await import('foldkit')
  Runtime.run(Runtime.makeElement({ Model, init: init(entries), update, view, container: dom.container } as never))
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await dom.window.happyDOM.waitUntilComplete()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  await settle()
  return { dom, settle, idOf: (selector: string) => dom.mirror.idFor(dom.window.document.querySelector(selector) as unknown as Node)! }
}

test('the list is a GPUI scroller', async () => {
  const gpui = createFakeGpui()
  const { idOf } = await open(gpui.renderer)
  expect(gpui.node(idOf('.scroll')).style).toMatchObject({ overflowY: 'scroll' })
})

// FKN-12: a filled child (the badge) blocked GPUI's hit test, so a click on
// it never reached the card. It lets hits through now, as a browser bubbles.
test("a click on a card's badge opens the example", async () => {
  const gpui = createFakeGpui()
  const { dom, settle, idOf } = await open(gpui.renderer)
  const launched: Array<Array<string>> = []
  setLauncher(command => launched.push(command))
  try {
    const native = (element: Element) => gpui.node(dom.mirror.idFor(element as unknown as Node)!)
    const badge = dom.window.document.querySelector('.badge')! as unknown as Element
    expect(native(badge).style).toMatchObject({ backgroundColor: 'rgba(255, 255, 255, .07)', pointerEvents: 'none' })
    // As GPUI's hit test goes: up from the badge to the card listening for the click.
    let at = badge
    while (!native(at).listeners.has('click')) {
      expect(blocks(native(at).style)).toBe(false)
      at = at.parentElement!
    }
    expect(at.getAttribute('aria-label')).toBe('Open Example 0')
    const { createRendererState } = await import('@gpuix/native/host')
    createRendererState(gpui.renderer).dispatch({ eventType: 'click', elementId: native(at).id, x: 1, y: 1, button: 0, clickCount: 1 } as never)
    await settle()
    expect(launched).toHaveLength(1)
  } finally {
    setLauncher(() => {})
  }
})

describe.skipIf(!METAL)('Metal, offscreen', () => {
  test('the wheel scrolls the list', async () => {
    const { TestRenderer } = await import('@gpuix/native/testing')
    const renderer = new TestRenderer({ width: 960, height: 760 })
    const { settle, idOf } = await open(renderer)
    renderer.flush()
    const last = () => renderer.getElementBounds(idOf('.grid > :last-child'))!.y
    const out = process.env['FOLDKIT_NATIVE_EVIDENCE'] ?? tmpdir()
    mkdirSync(out, { recursive: true })
    const before = last()
    expect(before).toBeGreaterThan(760)
    renderer.captureScreenshot(join(out, 'gallery-top.png'))
    renderer.nativeSimulateScrollWheel(480, 400, 0, -400)
    await settle()
    renderer.flush()
    renderer.captureScreenshot(join(out, 'gallery-scrolled.png'))
    expect(last()).toBeLessThan(before - 200)
  })

  test("a click on a card's badge, through GPUI's hit test, opens the example", async () => {
    const { TestRenderer } = await import('@gpuix/native/testing')
    const renderer = new TestRenderer({ width: 960, height: 760 })
    const { settle, idOf } = await open(renderer)
    renderer.flush()
    const launched: Array<Array<string>> = []
    setLauncher(command => launched.push(command))
    try {
      const badge = renderer.getElementBounds(idOf('.badge'))!
      renderer.nativeSimulateClick(badge.x + badge.width / 2, badge.y + badge.height / 2)
      await settle()
      expect(launched).toHaveLength(1)
    } finally {
      setLauncher(() => {})
    }
  })
})
