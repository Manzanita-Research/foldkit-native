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

  // CLICK-THROUGH (FKN-12)
  // GPUI lets an element that paints a fill block hits to everything behind
  // it, its own ancestors included; in a browser a click on a child bubbles
  // to its parent. So a filled child of an element listening for the pointer
  // lets hits through to it, keeping its own :hover.

  /** A card listening for clicks, with filled children: a plain chip, a chip
   *  with its own :hover, and a selectable note. */
  const clickableCard = async () => {
    const renderer = await testRenderer(400, 240)
    const css = `body { margin: 0; height: 100%; background-color: #ffffff; font-family: system-ui; }
      .card { display: flex; flex-direction: column; gap: 10px; width: 300px; padding: 20px; background-color: #333333; }
      .card:hover { background-color: #00ff00; }
      .chip { width: 80px; height: 30px; background-color: #ff0000; }
      .hot { background-color: #0000ff; }
      .hot:hover { background-color: #ffff00; }
      .note { margin: 0; font-size: 20px; color: #ffffff; background-color: #222222; user-select: text; }`
    const dom = attachDom(renderer, { css })
    cleanups.push(async () => {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    })
    const document = dom.window.document
    document.body.querySelector('#app')!.outerHTML =
      '<div class="card"><div class="chip"></div><div class="chip hot"></div><p class="note">Selectable note</p></div>'
    const clicks: Array<string> = []
    document.querySelector('.card')!.addEventListener('click', event => clicks.push((event.target as unknown as Element).className))
    for (let i = 0; i < 3; i++) {
      await dom.window.happyDOM.waitUntilComplete()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    renderer.flush()
    const centre = (selector: string) => {
      const box = renderer.getElementBounds(dom.mirror.idFor(document.querySelector(selector) as unknown as Node)!)!
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, box }
    }
    /** How many pixels of this frame are each colour. */
    const count = (name: string, colours: Record<string, string>) => {
      const path = join(out, `click-through-${name}.png`)
      renderer.captureScreenshot(path)
      const image = readPng(path)
      const counts = Object.fromEntries(Object.keys(colours).map(key => [key, 0]))
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const pixel = image.pixel(x, y)
          for (const [key, colour] of Object.entries(colours)) if (near(pixel, rgb(colour), 8)) counts[key]!++
        }
      }
      return counts
    }
    return { renderer, clicks, centre, count }
  }

  test("a click on a filled child reaches its parent's listener, as the DOM bubbles it", async () => {
    const { renderer, clicks, centre } = await clickableCard()
    for (const selector of ['.chip', '.hot', '.note']) {
      const { x, y } = centre(selector)
      renderer.nativeSimulateClick(x, y)
      renderer.flush()
    }
    // GPUI hits the card, so the DOM event's target is the card, as for any
    // child that paints nothing.
    expect(clicks).toHaveLength(3)
  })

  test("over a filled child, the parent's :hover applies, and the child's own :hover still does", async () => {
    const { renderer, centre, count } = await clickableCard()
    const colours = { cardHover: '#00ff00', chipHover: '#ffff00' }
    expect(count('rest', colours)).toEqual({ cardHover: 0, chipHover: 0 })
    renderer.nativeSimulateMouseMove(centre('.chip').x, centre('.chip').y)
    const overChip = count('over-chip', colours)
    renderer.nativeSimulateMouseMove(centre('.hot').x, centre('.hot').y)
    const overHot = count('over-hot', colours)
    console.log('click-through hover on Metal:', JSON.stringify({ overChip, overHot }))
    expect(overChip.cardHover).toBeGreaterThan(0)
    expect(overChip.chipHover).toBe(0)
    expect(overHot.cardHover).toBeGreaterThan(0)
    expect(overHot.chipHover).toBeGreaterThan(0)
  })

  test('a selectable note inside a clickable card: a drag selects its text, and clicks reach the card', async () => {
    const { renderer, clicks, centre } = await clickableCard()
    const { box, x, y } = centre('.note')
    renderer.clearSelection()
    expect(renderer.dragSelect(box.x + 1, y, box.x + box.width - 1, y)).toContain('Selectable')
    renderer.clearSelection()
    renderer.flush()
    renderer.nativeSimulateClick(x, y)
    renderer.flush()
    // The drag pressed and released on the card, so it was a click too, as in
    // a browser (gpuix delivers it with the next native input), then the click.
    expect(clicks).toHaveLength(2)
  })

  /** An input and a tabindex div with :focus-visible colours, focused through
   *  GPUI (a click, then focusElement): whether GPUI moved focus, and how many
   *  red (focus-visible) and grey (resting) pixels it painted each time. */
  const focusVisible = async () => {
    const renderer = await testRenderer(400, 240)
    const css = `body { margin: 0; height: 100%; background-color: #ffffff; }
      .app { display: flex; flex-direction: column; gap: 20px; padding: 20px; }
      .field { width: 200px; height: 40px; border: 6px solid #808080; background-color: #ffffff; }
      .field:focus-visible { border-color: #ff0000; }
      .tile { width: 100px; height: 60px; background-color: #808080; }
      .tile:focus-visible { background-color: #ff0000; }`
    const dom = attachDom(renderer, { css })
    cleanups.push(async () => {
      dom.detach()
      await dom.window.happyDOM.abort()
      dom.window.close()
    })
    const document = dom.window.document
    document.body.querySelector('#app')!.outerHTML = '<div class="app"><input class="field"><div class="tile" tabindex="0"></div></div>'
    // GPUI gives an element a focus handle when something listens for keys.
    document.querySelector('.tile')!.addEventListener('keydown', () => {})
    for (let i = 0; i < 3; i++) {
      await dom.window.happyDOM.waitUntilComplete()
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    renderer.flush()
    const idOf = (selector: string) => dom.mirror.idFor(document.querySelector(selector) as unknown as Node)!
    const field = idOf('.field')
    const tile = idOf('.tile')

    /** How many pixels of the frame GPUI drew are each colour. Positions
     *  aren't used: getElementBounds doesn't match where GPUI paints. */
    const count = (name: string) => {
      const path = join(out, `focus-${name}.png`)
      renderer.captureScreenshot(path)
      const image = readPng(path)
      let red = 0, gray = 0
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const pixel = image.pixel(x, y)
          if (near(pixel, rgb('#ff0000'), 8)) red++
          else if (near(pixel, rgb('#808080'), 8)) gray++
        }
      }
      return { red, gray }
    }
    const before = count('before')
    expect(before.red).toBe(0)
    expect(before.gray).toBeGreaterThan(0)

    const fieldBox = renderer.getElementBounds(field)!
    renderer.nativeSimulateClick(fieldBox.x + fieldBox.width / 2, fieldBox.y + fieldBox.height / 2)
    renderer.flush()
    const fieldFocused = { focused: renderer.getFocusedElementId() === field, ...count('field') }
    renderer.focusElement(tile)
    renderer.flush()
    const tileFocused = { focused: renderer.getFocusedElementId() === tile, ...count('tile') }
    console.log(':focus-visible on Metal:', JSON.stringify({ before, fieldFocused, tileFocused }))
    return { fieldFocused, tileFocused }
  }

  test('GPUI moves focus to an input by a click, and to a tabindex element by focusElement', async () => {
    const { fieldFocused, tileFocused } = await focusVisible()
    expect(fieldFocused.focused).toBe(true)
    expect(tileFocused.focused).toBe(true)
  })

  // Not yet: gpuix's style has hover and active states only, so the
  // focusVisible state the mirror sends is dropped, and nothing changes on
  // screen when an element takes focus. Drop `.failing` when it's painted.
  test.failing(':focus-visible styles are painted when GPUI focuses an element', async () => {
    const { fieldFocused, tileFocused } = await focusVisible()
    expect(fieldFocused.red).toBeGreaterThan(0)
    expect(tileFocused.red).toBeGreaterThan(0)
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
