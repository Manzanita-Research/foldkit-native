// Checkbox: scene test, and native tests on FoldKit on gpuix (headless, and
// on Metal in both themes).
import { describe, expect as bunExpect, test } from 'bun:test'
import { click, expect, given, role, scene, text } from 'foldkit/scene'

import { Checks } from './apps.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

describe('scene', () => {
  test('checkboxes named by their labels; "All" is mixed while some are ticked, and ticks the rest', () => {
    scene(
      { update: Checks.update, view: Checks.view },
      given(Checks.init),
      expect(role('checkbox', { name: 'All toppings' })).toHaveAttr('aria-checked', 'mixed'),
      expect(role('checkbox', { name: 'Cheese' })).toHaveAttr('aria-checked', 'true'),
      click(role('checkbox', { name: 'All toppings' })),
      expect(role('checkbox', { name: 'All toppings' })).toHaveAttr('aria-checked', 'true'),
      expect(role('checkbox', { name: 'Olives' })).toHaveAttr('aria-checked', 'true'),
      click(text('All toppings')),
      expect(role('checkbox', { name: 'All toppings' })).toHaveAttr('aria-checked', 'false'),
      expect(role('checkbox', { name: 'Remember me' })).toHaveAttr('aria-describedby', 'remember-description'),
      // Read-only and disabled: announced, and nothing to click.
      expect(role('checkbox', { name: 'Accepted the terms' })).toHaveAttr('aria-readonly', 'true'),
      expect(role('checkbox', { name: 'Beta features' })).toHaveAttr('aria-disabled', 'true'),
    )
  })
})

describe('native, headless', () => {
  test('keyboard: Tab through every box (read-only and disabled too); Space toggles on its release; the label toggles', async () => {
    const app = await headless(Checks)
    try {
      const active = () => app.document.activeElement?.getAttribute('id') ?? null
      const props = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).props
      bunExpect(props('all')).toMatchObject({ role: 'checkbox', 'aria-label': 'All toppings', 'aria-valuetext': 'mixed' })
      await app.press('tab')
      bunExpect(active()).toBe('all')
      await app.press('space')
      bunExpect(app.model().toppings).toEqual(['Cheese', 'Basil', 'Olives'])
      bunExpect(props('all')['aria-valuetext']).toBe('on')
      await app.press('tab')
      bunExpect(active()).toBe('cheese')
      await app.press('space')
      bunExpect(app.model().toppings).toEqual(['Basil', 'Olives'])
      bunExpect(props('all')['aria-valuetext']).toBe('mixed')
      // Enter clicks a focused button, as in a browser.
      await app.press('enter')
      bunExpect(app.model().toppings).toEqual(['Cheese', 'Basil', 'Olives'])
      const stops: Array<string | null> = []
      for (const _ of [1, 2, 3, 4, 5]) {
        await app.press('tab')
        stops.push(active())
      }
      bunExpect(stops).toEqual(['basil', 'olives', 'remember', 'terms', 'beta'])
      // Disabled and read-only keep their state under Space.
      await app.press('space')
      await app.press('tab', { shift: true })
      bunExpect(active()).toBe('terms')
      await app.press('space')
      bunExpect(app.document.getElementById('beta')!.getAttribute('aria-checked')).toBe('false')
      bunExpect(app.document.getElementById('terms')!.getAttribute('aria-checked')).toBe('true')
      await app.click('Remember me')
      bunExpect(app.model().remember).toBe(true)
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: a ticked box is the accent, an empty one the surface with a strong border; keyboard focus rings it`, async () => {
      const app = await headless(Checks, theme)
      try {
        const tokens = THEMES[theme]
        const style = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).style
        bunExpect(style('cheese')).toMatchObject({ backgroundColor: tokens['color.accent'], borderColor: tokens['color.accent'] })
        bunExpect(style('basil')).toMatchObject({ backgroundColor: tokens['color.surface'], borderColor: tokens['color.border-strong'] })
        bunExpect(style('all')).toMatchObject({ backgroundColor: tokens['color.accent'] })
        bunExpect(style('beta')['opacity']).toBe(0.5)
        bunExpect(app.texts()).toContain('✓')
        bunExpect(app.texts()).toContain('–')
        await app.press('tab')
        bunExpect(style('all')['boxShadow']).toMatchObject({ spreadRadius: 2 })
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: clicked through GPUI's hit test, toggled from the keyboard; AccessKit has the checkboxes`, async () => {
      const app = await metal('checkbox', Checks, theme)
      try {
        app.screenshot('initial')
        await app.click(app.document.getElementById('basil')!)
        bunExpect(app.model().toppings).toEqual(['Cheese', 'Basil'])
        // A click focuses without a ring; Space toggles it back.
        await app.press('space')
        bunExpect(app.model().toppings).toEqual(['Cheese'])
        await app.click(app.document.getElementById('remember-label')!)
        bunExpect(app.model().remember).toBe(true)
        await app.click(app.document.getElementById('beta')!)
        bunExpect(app.document.getElementById('beta')!.getAttribute('aria-checked')).toBe('false')
        const tree = JSON.stringify(app.renderer.getA11yTree())
        console.log(`ui checkbox a11y (${theme}):`, tree.slice(0, 600))
        bunExpect(tree.toLowerCase()).toContain('checkbox')
        bunExpect(tree).toContain('All toppings')
        await app.click(app.document.getElementById('all')!)
        bunExpect(app.model().toppings).toEqual(['Cheese', 'Basil', 'Olives'])
        await app.keys('tab')
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('cheese')
        app.screenshot('ticked')
      } finally {
        app.close()
      }
    })
  }
})
