// Switch: scene test, and native tests on FoldKit on gpuix.
import { describe, expect as bunExpect, test } from 'bun:test'
import { click, expect, given, role, scene, text } from 'foldkit/scene'

import { Toggle } from './apps.ts'
import { METAL, headless, metal } from './run.ts'

describe('scene', () => {
  test('a switch named by its label; the switch and the label both toggle', () => {
    scene(
      { update: Toggle.update, view: Toggle.view },
      given(Toggle.init),
      expect(role('switch', { name: 'Wi-Fi' })).toHaveAttr('aria-checked', 'false'),
      click(role('switch', { name: 'Wi-Fi' })),
      expect(role('switch', { name: 'Wi-Fi' })).toHaveAttr('aria-checked', 'true'),
      click(text('Wi-Fi')),
      expect(role('switch', { name: 'Wi-Fi' })).toHaveAttr('aria-checked', 'false'),
    )
  })
})

describe('native, headless', () => {
  test('a tab stop; Space and Enter toggle (a button\'s own activation); keyboard focus shows a ring', async () => {
    const app = await headless(Toggle)
    try {
      const track = () => app.gpui.node(app.document.getElementById('wifi')!.nativeId)
      bunExpect(track().props['role']).toBe('switch')
      bunExpect(track().props['aria-label']).toBe('Wi-Fi')
      await app.press('tab')
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('wifi')
      bunExpect(track().style['boxShadow']).toMatchObject({ spreadRadius: 2 })
      await app.press('space')
      bunExpect(app.model().on).toBe(true)
      bunExpect(track().style).toMatchObject({ justifyContent: 'flex-end', backgroundColor: '#8b7cf6' })
      await app.press('enter')
      bunExpect(app.model().on).toBe(false)
      await app.click('Wi-Fi')
      bunExpect(app.model().on).toBe(true)
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!METAL)('native, Metal', () => {
  test('clicked through GPUI hit testing, and toggled from the keyboard', async () => {
    const app = await metal('switch', Toggle)
    try {
      app.screenshot('off')
      await app.click(app.document.getElementById('wifi')!)
      bunExpect(app.model().on).toBe(true)
      await app.press('space')
      bunExpect(app.model().on).toBe(false)
      await app.press('space')
      app.screenshot('on')
      bunExpect(app.model().on).toBe(true)
    } finally {
      app.close()
    }
  })
})
