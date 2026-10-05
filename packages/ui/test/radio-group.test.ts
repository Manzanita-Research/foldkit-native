// RadioGroup: its update (story), the view (scene), and native tests on
// FoldKit on gpuix (headless, and on Metal in both themes).
import { describe, expect as bunExpect, test } from 'bun:test'
import { Option } from 'effect'
import { Command as SceneCommand, click, expect, given, role, scene } from 'foldkit/scene'
import { Command, given as storyGiven, message, model, story } from 'foldkit/story'

import * as RadioGroup from '../src/radio-group.ts'
import { Plans } from './apps.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

describe('story', () => {
  test('selecting focuses the option and tells the parent; focusing alone only moves focus', () => {
    story(
      RadioGroup.update,
      storyGiven(RadioGroup.init({ id: 'plan' })),
      message(RadioGroup.Message.FocusedOption({ index: 2 })),
      Command.expectHas(RadioGroup.FocusOption({ id: 'plan', index: 2 })),
      Command.resolve(RadioGroup.FocusOption, RadioGroup.Message.CompletedFocusOption()),
      model(next => bunExpect(next.maybeFocusedIndex).toEqual(Option.some(2))),
      message(RadioGroup.Message.SelectedOption({ index: 1, value: 'pro' })),
      Command.expectHas(RadioGroup.FocusOption({ id: 'plan', index: 1 })),
      Command.resolve(RadioGroup.FocusOption, RadioGroup.Message.CompletedFocusOption()),
      model(next => bunExpect(next.maybeFocusedIndex).toEqual(Option.none())),
    )
    const selected = RadioGroup.update(RadioGroup.init({ id: 'plan' }), RadioGroup.Message.SelectedOption({ index: 1, value: 'pro' }))
    bunExpect(selected.outMessage).toEqual(RadioGroup.OutMessage.Selected({ value: 'pro', index: 1 }))
    bunExpect(RadioGroup.update(RadioGroup.init({ id: 'plan' }), RadioGroup.Message.FocusedOption({ index: 0 })).outMessage).toBeUndefined()
  })
})

describe('scene', () => {
  test('a labelled radiogroup; options named by their labels; one checked; a click selects', () => {
    scene(
      { update: Plans.update, view: Plans.view },
      given(Plans.init),
      expect(role('radiogroup', { name: 'Plan' })).toHaveAttr('aria-orientation', 'vertical'),
      expect(role('radio', { name: 'Hobby' })).toHaveAttr('aria-checked', 'true'),
      expect(role('radio', { name: 'Pro' })).toHaveAttr('aria-describedby', 'plan-option-1-description'),
      click(role('radio', { name: 'Pro' })),
      SceneCommand.resolve(RadioGroup.FocusOption, RadioGroup.Message.CompletedFocusOption()),
      expect(role('radio', { name: 'Pro' })).toHaveAttr('aria-checked', 'true'),
      expect(role('radio', { name: 'Hobby' })).toHaveAttr('aria-checked', 'false'),
      expect(role('radio', { name: 'Team' })).toHaveAttr('aria-disabled', 'true'),
      expect(role('radiogroup', { name: 'Billing' })).toHaveAttr('aria-readonly', 'true'),
    )
  })
})

describe('native, headless', () => {
  test('keyboard: one tab stop per group; arrows select and wrap, skipping the disabled; read-only arrows only move', async () => {
    const app = await headless(Plans)
    try {
      const active = () => app.document.activeElement?.getAttribute('id') ?? null
      const checked = (id: string) => app.document.getElementById(id)!.getAttribute('aria-checked')
      await app.press('tab')
      bunExpect(active()).toBe('plan-option-0')
      await app.press('down')
      bunExpect(app.model().chosen).toBe('pro')
      // FocusOption is FoldKit's Dom.focus, on the native document.
      bunExpect(active()).toBe('plan-option-1')
      bunExpect(app.gpuiFocus()?.getAttribute('id')).toBe('plan-option-1')
      // Team is disabled: Down goes past it, round to Hobby.
      await app.press('down')
      bunExpect([app.model().chosen, active()]).toEqual(['hobby', 'plan-option-0'])
      await app.press('up')
      bunExpect([app.model().chosen, active()]).toEqual(['pro', 'plan-option-1'])
      await app.press('home')
      bunExpect(app.model().chosen).toBe('hobby')
      await app.press('end')
      bunExpect(app.model().chosen).toBe('pro')
      // The roving tab stop: only the selected option is in the tab order.
      const tabIndex = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).props['tabIndex']
      bunExpect([tabIndex('plan-option-0'), tabIndex('plan-option-1'), tabIndex('plan-option-2')]).toEqual([-1, 0, -1])
      // Tab leaves the group, to the read-only group's selected option.
      await app.press('tab')
      bunExpect(active()).toBe('billing-option-1')
      await app.press('left')
      bunExpect(active()).toBe('billing-option-0')
      bunExpect([checked('billing-option-0'), checked('billing-option-1')]).toEqual(['false', 'true'])
      await app.press('space')
      bunExpect(checked('billing-option-0')).toBe('false')
      // Up and Down aren't this horizontal group's keys.
      await app.press('down')
      bunExpect(active()).toBe('billing-option-0')
      await app.press('tab', { shift: true })
      bunExpect(active()).toBe('plan-option-1')
      // Space (on its release) and a click on a label select.
      await app.click('Hobby')
      bunExpect(app.model().chosen).toBe('hobby')
      await app.press('down')
      await app.press('space')
      bunExpect(app.model().chosen).toBe('pro')
      bunExpect(app.texts()).toContain('Plan: Pro')
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: the selected radio is the accent with a dot; the rest the surface; a disabled one half-strength`, async () => {
      const app = await headless(Plans, theme)
      try {
        const tokens = THEMES[theme]
        const style = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).style
        bunExpect(style('plan-option-0')).toMatchObject({ backgroundColor: tokens['color.accent'], borderColor: tokens['color.accent'] })
        bunExpect(style('plan-option-1')).toMatchObject({ backgroundColor: tokens['color.surface'], borderColor: tokens['color.border-strong'] })
        bunExpect(style('plan-option-2')['opacity']).toBe(0.5)
        const dot = app.document.querySelector('#plan-option-0 [data-part="indicator"]')!
        bunExpect(app.gpui.node(dot.nativeId).style).toMatchObject({ backgroundColor: tokens['color.accent-text'], width: 8 })
        await app.press('tab')
        bunExpect(style('plan-option-0')['boxShadow']).toMatchObject({ spreadRadius: 2 })
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: clicked through GPUI's hit test, arrowed from the keyboard; AccessKit has the radio group`, async () => {
      const app = await metal('radio-group', Plans, theme)
      try {
        app.screenshot('initial')
        await app.click(app.document.getElementById('plan-option-1-label')!)
        bunExpect(app.model().chosen).toBe('pro')
        await app.click(app.document.getElementById('plan-option-2')!)
        bunExpect(app.model().chosen).toBe('pro')
        await app.click(app.document.getElementById('plan-option-0')!)
        bunExpect(app.model().chosen).toBe('hobby')
        await app.press('down')
        bunExpect(app.model().chosen).toBe('pro')
        bunExpect(app.gpuiFocus()?.getAttribute('id')).toBe('plan-option-1')
        bunExpect(app.painted()).toContain('Plan: Pro')
        const tree = JSON.stringify(app.renderer.getA11yTree())
        console.log(`ui radio-group a11y (${theme}):`, tree.slice(0, 700))
        bunExpect(tree.toLowerCase()).toContain('radiobutton')
        for (const name of ['Hobby', 'Pro', 'Team', 'Monthly', 'Yearly']) bunExpect(tree).toContain(name)
        await app.keys('tab')
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('billing-option-1')
        app.screenshot('selected')
      } finally {
        app.close()
      }
    })
  }
})
