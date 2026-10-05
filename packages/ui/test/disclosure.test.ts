// Disclosure: scene test, and native tests on FoldKit on gpuix (headless,
// and on Metal in both themes).
import { describe, expect as bunExpect, test } from 'bun:test'
import { click, expect, given, role, scene, text } from 'foldkit/scene'

import { Questions } from './apps.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

describe('scene', () => {
  test('a button that says whether it\'s expanded and controls the panel it shows', () => {
    scene(
      { update: Questions.update, view: Questions.view },
      given(Questions.init),
      expect(role('button', { name: 'What is FoldKit Native?' })).toHaveAttr('aria-expanded', 'true'),
      expect(role('button', { name: 'What is FoldKit Native?' })).toHaveAttr('aria-controls', 'what-panel'),
      expect(text('FoldKit apps, drawn by GPUI in the same process.')).toExist(),
      expect(role('button', { name: 'Does it run on Linux?' })).toHaveAttr('aria-expanded', 'false'),
      expect(text('Yes, on Wayland, with the same components.')).toBeAbsent(),
      click(role('button', { name: 'Does it run on Linux?' })),
      expect(text('Yes, on Wayland, with the same components.')).toExist(),
      click(role('button', { name: 'What is FoldKit Native?' })),
      expect(text('FoldKit apps, drawn by GPUI in the same process.')).toBeAbsent(),
      expect(role('button', { name: 'Can I use it at work?' })).toHaveAttr('aria-disabled', 'true'),
    )
  })
})

describe('native, headless', () => {
  test('keyboard: Tab to each (the disabled one too); Enter and Space toggle; the disabled one stays shut', async () => {
    const app = await headless(Questions)
    try {
      const active = () => app.document.activeElement?.getAttribute('id') ?? null
      const expanded = (id: string) => app.gpui.node(app.document.getElementById(`${id}-button`)!.nativeId).props['aria-expanded']
      bunExpect([expanded('what'), expanded('linux')]).toEqual([true, false])
      bunExpect(app.gpui.node(app.document.getElementById('what-button')!.nativeId).props['aria-label']).toBe('What is FoldKit Native?')
      await app.press('tab')
      bunExpect(active()).toBe('what-button')
      await app.press('enter')
      bunExpect(app.model().open).toEqual([])
      bunExpect(app.texts()).not.toContain('FoldKit apps, drawn by GPUI in the same process.')
      await app.press('tab')
      bunExpect(active()).toBe('linux-button')
      await app.press('space')
      bunExpect(app.model().open).toEqual(['linux'])
      bunExpect(expanded('linux')).toBe(true)
      bunExpect(app.texts()).toContain('Yes, on Wayland, with the same components.')
      await app.press('tab')
      bunExpect(active()).toBe('work-button')
      await app.press('enter')
      await app.press('space')
      bunExpect(app.model().open).toEqual(['linux'])
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: the trigger sits on the canvas and hovers the highlight; the answer is muted text`, async () => {
      const app = await headless(Questions, theme)
      try {
        const tokens = THEMES[theme]
        const trigger = app.gpui.node(app.document.getElementById('what-button')!.nativeId).style
        bunExpect(trigger).toMatchObject({ backgroundColor: tokens['color.canvas'], hover: { backgroundColor: tokens['color.highlight'] } })
        bunExpect(app.gpui.node(app.document.getElementById('work-button')!.nativeId).style['opacity']).toBe(0.5)
        const answer = app.document.getElementById('what-panel')!.firstElementChild!.firstChild!
        bunExpect(app.gpui.node(answer.nativeId).style).toMatchObject({ color: tokens['color.text-muted'] })
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: clicked through GPUI's hit test and toggled from the keyboard; AccessKit has the buttons, expanded or not`, async () => {
      const app = await metal('disclosure', Questions, theme)
      try {
        app.screenshot('initial')
        await app.click(app.document.getElementById('linux-button')!)
        bunExpect(app.painted()).toContain('Yes, on Wayland, with the same components.')
        await app.press('enter')
        bunExpect(app.model().open).toEqual(['what'])
        await app.press('space')
        bunExpect(app.model().open).toEqual(['what', 'linux'])
        await app.click(app.document.getElementById('work-button')!)
        bunExpect(app.model().open).toEqual(['what', 'linux'])
        const tree = JSON.stringify(app.renderer.getA11yTree())
        console.log(`ui disclosure a11y (${theme}):`, tree.slice(0, 700))
        for (const name of ['What is FoldKit Native?', 'Does it run on Linux?', 'Can I use it at work?']) bunExpect(tree).toContain(name)
        bunExpect(tree).toContain('"expanded":true')
        bunExpect(tree).toContain('"expanded":false')
        await app.keys('shift-tab')
        app.screenshot('open')
      } finally {
        app.close()
      }
    })
  }
})
