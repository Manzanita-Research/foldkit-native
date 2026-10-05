// Dialog: scene test, and native tests on FoldKit on gpuix.
import { describe, expect as bunExpect, test } from 'bun:test'
import { click, expect, given, keydown, role, scene, text } from 'foldkit/scene'

import { Confirm } from './apps.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

describe('scene', () => {
  test('a modal dialog named by its title; Escape and Cancel close it', () => {
    scene(
      { update: Confirm.update, view: Confirm.view },
      given(Confirm.init),
      expect(role('dialog')).toBeAbsent(),
      click(role('button', { name: 'Delete…' })),
      expect(role('dialog', { name: 'Delete file?' })).toHaveAttr('aria-modal', 'true'),
      keydown(role('dialog'), 'Escape'),
      expect(role('dialog')).toBeAbsent(),
      click(role('button', { name: 'Delete…' })),
      click(role('button', { name: 'Delete' })),
      expect(role('dialog')).toBeAbsent(),
      expect(text('Delete file?')).toBeAbsent(),
    )
  })
})

describe('native, headless', () => {
  test('opens focused on Cancel; Tab stays inside; Escape closes; focus returns to the opener', async () => {
    const app = await headless(Confirm)
    try {
      const active = () => app.document.activeElement?.textContent ?? null
      await app.press('tab')
      bunExpect(active()).toBe('Delete…')
      await app.press('enter')
      bunExpect(active()).toBe('Cancel')
      const seen: Array<string | null> = []
      for (const _ of [1, 2, 3]) {
        await app.press('tab')
        seen.push(active())
      }
      bunExpect(seen).toEqual(['Delete', 'Cancel', 'Delete'])
      await app.press('tab', { shift: true })
      bunExpect(active()).toBe('Cancel')
      await app.press('escape')
      bunExpect(app.model().open).toBe(false)
      bunExpect(active()).toBe('Delete…')
    } finally {
      app.close()
    }
  })

  test('a click on the backdrop closes it; a click in the panel doesn\'t', async () => {
    const app = await headless(Confirm)
    try {
      await app.click('Delete…')
      bunExpect(app.model().open).toBe(true)
      // The panel isn't inside the backdrop, so a click in it can't reach it.
      const backdrop = app.document.querySelector('[data-part="backdrop"]')!
      bunExpect(backdrop.contains(app.document.getElementById('confirm'))).toBe(false)
      app.host.dispatch({ eventType: 'click', elementId: backdrop.nativeId, x: 1, y: 1, button: 0, clickCount: 1 } as never)
      await app.settle()
      bunExpect(app.model().open).toBe(false)
    } finally {
      app.close()
    }
  })
})

describe('themes, headless', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: the panel is the raised surface over the theme's backdrop`, async () => {
      const app = await headless(Confirm, theme)
      try {
        const tokens = THEMES[theme]
        await app.click('Delete…')
        bunExpect(app.gpui.node(app.document.getElementById('confirm')!.nativeId).style).toMatchObject({ backgroundColor: tokens['color.surface-raised'] })
        const backdrop = app.document.querySelector('[data-ui="dialog"][data-part="backdrop"]')!
        bunExpect(app.gpui.node(backdrop.nativeId).style).toMatchObject({ backgroundColor: tokens['color.backdrop'] })
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: opened from the keyboard, focus on Cancel; AccessKit has the dialog named by its title`, async () => {
      const app = await metal('dialog-theme', Confirm, theme)
      try {
        await app.keys('tab')
        await app.press('enter')
        bunExpect(app.document.activeElement?.textContent).toBe('Cancel')
        bunExpect(app.painted()).toContain('You can’t undo this.')
        const tree = JSON.stringify(app.renderer.getA11yTree())
        console.log(`ui dialog a11y (${theme}):`, tree.slice(0, 600))
        bunExpect(tree).toContain('"Dialog"')
        bunExpect(tree).toContain('"Delete file?"')
        for (const name of ['"Cancel"', '"Delete"']) bunExpect(tree).toContain(name)
        app.screenshot('open')
        await app.press('escape')
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('open')
      } finally {
        app.close()
      }
    })
  }

  test('GPUI\'s focusNextWithin keeps Tab in the panel; the panel paints over the app', async () => {
    const app = await metal('dialog', Confirm)
    try {
      await app.click(app.document.getElementById('open')!)
      bunExpect(app.painted()).toContain('Delete file?')
      const seen: Array<string | null> = [app.document.activeElement?.textContent ?? null]
      for (const _ of [1, 2, 3]) {
        await app.keys('tab')
        seen.push(app.document.activeElement?.textContent ?? null)
      }
      console.log('ui dialog Tab:', seen.join(' → '))
      bunExpect(seen).toEqual(['Cancel', 'Delete', 'Cancel', 'Delete'])
      app.screenshot('open')
      await app.keys('escape')
      bunExpect(app.model().open).toBe(false)
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('open')
    } finally {
      app.close()
    }
  })
})
