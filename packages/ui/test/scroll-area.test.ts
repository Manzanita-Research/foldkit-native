// ScrollArea: scene test, and native tests on FoldKit on gpuix.
import { describe, expect as bunExpect, test } from 'bun:test'
import { expect, given, role, scene } from 'foldkit/scene'

import { Scroller } from './apps.ts'
import { METAL, headless, metal } from './run.ts'

describe('scene', () => {
  test('a labelled region', () => {
    scene(
      { update: Scroller.update, view: Scroller.view },
      given(Scroller.init),
      expect(role('region', { name: 'Log' })).toExist(),
      expect(role('region', { name: 'Log' })).toContainText('Line 30'),
    )
  })
})

describe('native, headless', () => {
  test('GPUI scrolls it; focused, the keys scroll it', async () => {
    const app = await headless(Scroller)
    try {
      const region = app.document.querySelector('[role="region"]')!
      bunExpect(app.gpui.node(region.nativeId).style).toMatchObject({ overflowY: 'scroll', maxHeight: 120 })
      await app.press('tab')
      bunExpect(app.document.activeElement).toBe(region)
      await app.press('pagedown')
      bunExpect(region.scrollTop).toBeGreaterThan(0)
      await app.press('home')
      bunExpect(region.scrollTop).toBe(0)
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!METAL)('native, Metal', () => {
  test('the wheel scrolls it in GPUI, and scrollTop reads where GPUI is', async () => {
    const app = await metal('scroll-area', Scroller)
    try {
      const region = app.document.querySelector('[role="region"]')!
      const box = app.bounds(region)
      bunExpect(box.height).toBe(120)
      app.renderer.nativeSimulateScrollWheel(box.x + 20, box.y + 20, 0, -96)
      await app.settle()
      console.log('ui scroll-area after wheel:', region.scrollTop)
      bunExpect(region.scrollTop).toBeGreaterThan(0)
      app.screenshot('scrolled')
      region.focus()
      await app.keys('home')
      bunExpect(region.scrollTop).toBe(0)
    } finally {
      app.close()
    }
  })
})
