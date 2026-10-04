// Real GPUI, offscreen. gpuix's TestRenderer runs GPUI's own layout, hit
// testing and Metal renderer without a window, so these need a Mac (or
// Windows, untested) but no screen. Linux has no read-back (wgpu), so they skip.
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { attachDom } from '../../src/index.ts'
import { createFakeGpui } from '../support/fake-gpui.ts'
import { near, readPng, rgb } from '../support/png.ts'

const metal = process.platform === 'darwin'
const out = mkdtempSync(join(tmpdir(), 'foldkit-native-metal-'))
const cleanups: Array<() => Promise<void> | void> = []
afterAll(() => rmSync(out, { recursive: true, force: true }))
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const testRenderer = async (width: number, height: number) => {
  const { TestRenderer } = await import('@gpuix/native/testing')
  return new TestRenderer({ width, height })
}

describe.skipIf(!metal)('Metal, offscreen', () => {
  test('a FoldKit counter draws, and a click through GPUI hit testing updates the model', async () => {
    const renderer = await testRenderer(480, 320)
    const css = `body { margin: 0; height: 100%; background-color: #1d1d21; font-family: system-ui; }
      .count { color: #f2f2f2; font-size: 22px; margin: 0; }
      .button { width: 120px; height: 40px; background-color: #3b82f6; color: #ffffff; }`
    const dom = attachDom(renderer, { css })
    cleanups.push(async () => {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    })
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        await dom.window.happyDOM.waitUntilComplete()
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      renderer.flush()
    }

    const { Runtime } = await import('foldkit')
    const Message = defineMessageUnion({ ClickedIncrement: {} })
    let model = { count: 0 }
    Runtime.run(Runtime.makeElement({
      Model: Schema.Struct({ count: Schema.Number }),
      init: () => ({ model }),
      update: (current: { count: number }) => ({ model: (model = { count: current.count + 1 }) }),
      view: (current: { count: number }, h: any) => h.div([], [
        h.p([h.Class('count')], [`Count: ${current.count}`]),
        h.div([h.Class('button'), h.OnClick(Message.ClickedIncrement())], ['+1']),
      ]),
      container: dom.container,
    } as never))
    await settle()
    expect(renderer.getPaintedText()).toContain('Count: 0')

    // The frame GPUI drew: background and button colours where layout put them.
    const button = dom.window.document.querySelector('.button')!
    const bounds = renderer.getElementBounds(dom.mirror.idFor(button as unknown as Node)!)!
    expect(bounds).toMatchObject({ width: 120, height: 40 })
    const before = join(out, 'counter-0.png')
    renderer.captureScreenshot(before)
    const image = readPng(before)
    const scale = image.width / 480
    expect(near(image.pixel(Math.round(470 * scale), Math.round(310 * scale)), rgb('#1d1d21'))).toBe(true)
    const inside = image.pixel(Math.round((bounds.x + 110) * scale), Math.round((bounds.y + 35) * scale))
    expect(near(inside, rgb('#3b82f6'))).toBe(true)

    // A click at the button's painted centre, through GPUI's hit test.
    renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await settle()
    expect(model.count).toBe(1)
    expect(renderer.getPaintedText()).toContain('Count: 1')
    expect(renderer.getRetainedElementCount()).toBeGreaterThan(0)
  })

  test("GPUI's own text selection: UI text and buttons don't select, opted-in text does", async () => {
    const renderer = await testRenderer(480, 320)
    const css = `body { margin: 0; height: 100%; background-color: #1d1d21; font-family: system-ui; color: #f2f2f2; }
      .app { display: flex; flex-direction: column; gap: 12px; padding: 20px; }
      .title, .note { margin: 0; font-size: 20px; }
      .note { user-select: text; }
      .button { width: 120px; height: 40px; background-color: #3b82f6; color: #ffffff; font-size: 20px; }`
    const dom = attachDom(renderer, { css })
    cleanups.push(async () => {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    })
    const document = dom.window.document
    document.body.querySelector('#app')!.outerHTML =
      '<div class="app"><p class="title">FoldKit Native</p><p class="note">Selectable note</p><div class="button">Increment</div></div>'
    for (let i = 0; i < 3; i++) {
      await dom.window.happyDOM.waitUntilComplete()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    renderer.flush()
    /** Drag from just inside an element's left edge to its right edge. */
    const dragAcross = (selector: string) => {
      const bounds = renderer.getElementBounds(dom.mirror.idFor(document.querySelector(selector) as unknown as Node)!)!
      const y = bounds.y + bounds.height / 2
      renderer.clearSelection()
      return renderer.dragSelect(bounds.x + 1, y, bounds.x + bounds.width - 1, y)
    }
    expect(dragAcross('.title')).toBeNull()
    expect(dragAcross('.button')).toBeNull()
    expect(dragAcross('.note')).toContain('Selectable')
  })

  test('the fake GPUI tree agrees with the real one', async () => {
    // Record what the mirror sends for a run of edits, replay it into GPUI's
    // real retained tree, and compare: the unit tests' fake must not drift.
    const fake = createFakeGpui()
    const dom = attachDom(fake.renderer)
    cleanups.push(async () => {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    })
    const document = dom.window.document
    let seed = 11
    const random = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n
    for (let step = 0; step < 300; step++) {
      const all = [dom.container, ...Array.from(dom.container.querySelectorAll('*'))] as Array<HTMLElement>
      const parent = all[random(all.length)]!
      const op = random(4)
      if (op === 0 || parent.children.length === 0) {
        const child = document.createElement('div') as unknown as HTMLElement
        child.textContent = `n${step}`
        parent.insertBefore(child, parent.children[random(parent.children.length + 1)] ?? null)
      } else if (op === 1 && parent !== dom.container) parent.remove()
      else if (op === 2) parent.appendChild(parent.children[random(parent.children.length)]!)
      else parent.firstChild!.textContent = `t${step}`
      if (step % 20 === 0) await dom.window.happyDOM.waitUntilComplete()
    }
    await dom.window.happyDOM.waitUntilComplete()

    const real = await testRenderer(400, 300)
    for (const batch of fake.batches) real.applyBatch(JSON.stringify(batch))
    real.flush()
    type Json = { type: string; text?: string; children?: Array<Json> }
    const shape = ({ type, text, children }: Json): Json =>
      ({ type, ...(text === undefined ? {} : { text }), ...(children?.length ? { children: children.map(shape) } : {}) })
    expect(shape(real.toJSON() as Json)).toEqual(fake.tree()!)
    expect(real.getRetainedElementCount()).toBe(fake.retainedCount())
  })
})
