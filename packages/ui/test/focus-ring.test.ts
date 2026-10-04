// Focus rings by input modality, as browsers draw `:focus-visible`: focus by
// a key shows the theme's ring, focus by a click doesn't, and `focus()` from
// script follows the latest input. Headless (the style GPUI gets), then on
// Metal (the pixels GPUI paints just outside the button's edge).
import { describe, expect, test } from 'bun:test'

import { Buttons } from './apps.ts'
import { METAL, headless, metal } from './run.ts'

/** The dusk theme's `color.focus` and `color.canvas`. */
const FOCUS = [0xb9, 0xb0, 0xff] as const
const CANVAS = [0x14, 0x13, 0x18] as const
const near = (pixel: readonly [number, number, number], colour: readonly [number, number, number]) =>
  pixel.every((value, i) => Math.abs(value - colour[i]!) <= 24)

describe('headless', () => {
  test('a click focuses without the ring; Tab, Shift-Tab and focus() after a key show it', async () => {
    const app = await headless(Buttons)
    try {
      const ring = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).style['boxShadow']
      await app.click('First')
      expect(app.document.activeElement?.getAttribute('id')).toBe('first')
      expect(ring('first')).toBeUndefined()
      expect(app.document.getElementById('first')!.matches(':focus-visible')).toBe(false)
      await app.press('tab')
      expect(ring('second')).toMatchObject({ spreadRadius: 2 })
      expect(app.document.getElementById('second')!.matches(':focus-visible')).toBe(true)
      expect(ring('first')).toBeUndefined()
      // focus() from script after a key: the ring, as the key left it.
      app.document.getElementById('first')!.focus()
      await app.settle()
      expect(ring('first')).toMatchObject({ spreadRadius: 2 })
      // After a click, focus() from script draws no ring.
      await app.click('Second')
      app.document.getElementById('first')!.focus()
      await app.settle()
      expect(ring('first')).toBeUndefined()
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!METAL)('Metal', () => {
  test('the ring paints after Tab and not after a click', async () => {
    const app = await metal('focus-ring', Buttons)
    try {
      const first = app.document.getElementById('first')!
      const second = app.document.getElementById('second')!
      /** Just outside the top edge (the border box), where the 2px ring paints. */
      const above = (shot: ReturnType<typeof app.pixels>, element: typeof first) => {
        const box = element.getBoundingClientRect()
        return shot.at(box.x + box.width / 2, box.y - 1)
      }
      await app.click(first)
      expect(app.document.activeElement).toBe(first)
      const clicked = app.pixels('clicked')
      console.log('focus ring after a click:', JSON.stringify({ first: above(clicked, first), second: above(clicked, second) }))
      expect(near(above(clicked, first), CANVAS)).toBe(true)

      await app.keys('tab')
      expect(app.document.activeElement).toBe(second)
      const tabbed = app.pixels('tabbed')
      console.log('focus ring after Tab:', JSON.stringify({ first: above(tabbed, first), second: above(tabbed, second) }))
      expect(near(above(tabbed, second), FOCUS)).toBe(true)
      expect(near(above(tabbed, first), CANVAS)).toBe(true)

      // A click on the ringed button: focused still, ring gone.
      await app.click(second)
      expect(app.document.activeElement).toBe(second)
      expect(near(above(app.pixels('clicked-again'), second), CANVAS)).toBe(true)
      expect(app.model().pressed).toEqual(['First', 'Second'])
    } finally {
      app.close()
    }
  })
})
