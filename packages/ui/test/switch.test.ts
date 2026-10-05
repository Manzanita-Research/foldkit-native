// Switch: scene test, and native tests on FoldKit on gpuix (headless, and
// on Metal in both themes).
import { describe, expect as bunExpect, test } from 'bun:test'
import { click, expect, given, role, scene, text } from 'foldkit/scene'

import { Toggle } from './apps.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

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
      expect(role('switch', { name: 'Airplane mode' })).toHaveAttr('aria-disabled', 'true'),
      expect(role('switch', { name: 'Location' })).toHaveAttr('aria-readonly', 'true'),
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

  test('disabled and read-only: still tab stops (so they can be read), and neither toggles', async () => {
    const app = await headless(Toggle)
    try {
      const checked = (id: string) => app.document.getElementById(id)!.getAttribute('aria-checked')
      await app.press('tab')
      await app.press('tab')
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('airplane')
      await app.press('space')
      await app.press('enter')
      bunExpect(checked('airplane')).toBe('false')
      await app.press('tab')
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('location')
      await app.press('space')
      bunExpect(checked('location')).toBe('true')
      bunExpect(app.model().on).toBe(false)
      bunExpect(app.gpui.node(app.document.getElementById('location')!.nativeId).props['aria-valuetext']).toBe('on')
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: on is the accent, off the strong border; disabled is half-strength with no hover`, async () => {
      const app = await headless(Toggle, theme)
      try {
        const tokens = THEMES[theme]
        const style = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).style
        bunExpect(style('wifi')).toMatchObject({ backgroundColor: tokens['color.border-strong'] })
        bunExpect(style('location')).toMatchObject({ backgroundColor: tokens['color.accent'] })
        bunExpect(style('airplane')['opacity']).toBe(0.5)
        bunExpect(style('airplane')['hover']).toBeUndefined()
        bunExpect(style('location')['hover']).toBeUndefined()
        bunExpect(style('wifi')['hover']).toBeDefined()
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: clicked through GPUI hit testing, and toggled from the keyboard; AccessKit has the switches`, async () => {
      const app = await metal('switch', Toggle, theme)
      try {
        app.screenshot('off')
        await app.click(app.document.getElementById('wifi')!)
        bunExpect(app.model().on).toBe(true)
        await app.press('space')
        bunExpect(app.model().on).toBe(false)
        await app.press('space')
        bunExpect(app.model().on).toBe(true)
        await app.click(app.document.getElementById('airplane')!)
        bunExpect(app.document.getElementById('airplane')!.getAttribute('aria-checked')).toBe('false')
        const tree = JSON.stringify(app.renderer.getA11yTree())
        console.log(`ui switch a11y (${theme}):`, tree.slice(0, 400))
        bunExpect(tree.toLowerCase()).toContain('switch')
        for (const name of ['Wi-Fi', 'Airplane mode', 'Location']) bunExpect(tree).toContain(name)
        await app.click(app.document.getElementById('wifi')!)
        await app.click(app.document.getElementById('wifi')!)
        await app.keys('tab')
        app.screenshot('on')
      } finally {
        app.close()
      }
    })
  }
})
