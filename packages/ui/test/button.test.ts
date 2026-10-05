// Button: scene test, and native tests on FoldKit on gpuix (headless, and on
// Metal in both themes).
import { describe, expect as bunExpect, test } from 'bun:test'
import { click, expect, given, role, scene, text } from 'foldkit/scene'

import { Actions } from './apps.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

describe('scene', () => {
  test('buttons by name; a click is the Message; a disabled one says so and has nothing to click', () => {
    scene(
      { update: Actions.update, view: Actions.view },
      given(Actions.init),
      click(role('button', { name: 'Save' })),
      click(role('button', { name: 'Delete' })),
      expect(text('Pressed: Save, Delete')).toExist(),
      expect(role('button', { name: 'Archive' })).toHaveAttr('aria-disabled', 'true'),
      expect(role('button', { name: 'Save' })).toHaveAttr('type', 'button'),
    )
  })
})

describe('native, headless', () => {
  test('keyboard: Tab reaches each (the disabled one too); Enter and Space click; the disabled one ignores both', async () => {
    const app = await headless(Actions)
    try {
      const active = () => app.document.activeElement?.getAttribute('id') ?? null
      await app.press('tab')
      bunExpect(active()).toBe('save')
      await app.press('enter')
      await app.press('tab')
      bunExpect(active()).toBe('cancel')
      await app.press('space')
      await app.press('tab')
      await app.press('tab')
      bunExpect(active()).toBe('archive')
      await app.press('enter')
      await app.press('space')
      await app.click('Archive')
      bunExpect(app.model().pressed).toEqual(['Save', 'Cancel'])
      bunExpect(app.gpui.node(app.document.getElementById('archive')!.nativeId).props['role']).toBe('button')
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: primary is the accent, danger the danger colour, disabled half-strength`, async () => {
      const app = await headless(Actions, theme)
      try {
        const tokens = THEMES[theme]
        const style = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).style
        bunExpect(style('save')).toMatchObject({ backgroundColor: tokens['color.accent'] })
        bunExpect(style('cancel')).toMatchObject({ backgroundColor: tokens['color.surface'], borderColor: tokens['color.border'] })
        bunExpect(style('delete')).toMatchObject({ backgroundColor: tokens['color.danger'] })
        bunExpect(style('archive')['opacity']).toBe(0.5)
        // No hover look on a disabled button.
        bunExpect(app.gpui.node(app.document.getElementById('archive')!.nativeId).style['hover']).toBeUndefined()
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: clicked through GPUI's hit test and from the keyboard; AccessKit has the buttons`, async () => {
      const app = await metal('button', Actions, theme)
      try {
        app.screenshot('initial')
        // A disabled button takes focus from a click, as a focusable one does
        // in a browser, but no Message.
        await app.click(app.document.getElementById('archive')!)
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('archive')
        await app.click(app.document.getElementById('save')!)
        bunExpect(app.model().pressed).toEqual(['Save'])
        await app.keys('tab')
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('cancel')
        await app.press('space')
        await app.press('enter')
        bunExpect(app.model().pressed).toEqual(['Save', 'Cancel', 'Cancel'])
        bunExpect(app.painted()).toContain('Pressed: Save, Cancel, Cancel')
        const tree = JSON.stringify(app.renderer.getA11yTree())
        console.log(`ui button a11y (${theme}):`, tree.slice(0, 400))
        for (const name of ['Save', 'Cancel', 'Delete', 'Archive']) bunExpect(tree).toContain(name)
        bunExpect(tree.toLowerCase()).toContain('button')
        app.screenshot('focused')
      } finally {
        app.close()
      }
    })
  }
})
