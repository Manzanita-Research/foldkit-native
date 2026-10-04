// Select: its update (story), then on FoldKit on gpuix, headless and on
// Metal, where the popup is GPUI's own anchored element.
import { describe, expect as bunExpect, test } from 'bun:test'
import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'

import * as Select from '../src/select.ts'
import { Chooser } from './apps.ts'
import { METAL, headless, metal } from './run.ts'

describe('story', () => {
  test('opening highlights the selected option; choosing closes and names the value', () => {
    story(
      Select.update,
      given(Select.init({ id: 'fruit' })),
      message(Select.Message.Opened({ selectedIndex: 2 })),
      Command.expectHas(Select.FocusAfterCommit({ elementId: 'fruit-list' })),
      Command.resolve(Select.FocusAfterCommit, Select.Message.CompletedFocus()),
      model(next => {
        bunExpect(next.isOpen).toBe(true)
        bunExpect(next.list.highlighted).toBe(2)
      }),
    )
    bunExpect(Select.chosen(Select.Message.Chose({ value: 'fig' }))).toEqual(Option.some('fig'))
    bunExpect(Select.chosen(Select.Message.Closed({ restoreFocus: true }))).toEqual(Option.none())
  })
})

describe('native, headless', () => {
  test('the popup is an anchored element; keys pick; focus comes back to the trigger', async () => {
    const app = await headless(Chooser)
    try {
      const trigger = app.document.getElementById('fruit-trigger')!
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      trigger.focus()
      await app.press('down')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('true')
      const anchor = app.document.querySelector('[data-fn-anchored]')!
      bunExpect(app.gpui.node(anchor.nativeId).type).toBe('anchored')
      bunExpect(app.gpui.node(anchor.nativeId).props).toMatchObject({ side: 'bottom', align: 'start', gap: 4, deferred: true })
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('fruit-list')
      bunExpect(app.document.getElementById('fruit-list')!.getAttribute('aria-activedescendant')).toBe('fruit-list-option-2')
      await app.press('down')
      await app.press('enter')
      bunExpect(app.model().fruit).toBe('blueberry')
      bunExpect(app.document.querySelector('[data-fn-anchored]')).toBeNull()
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('fruit-trigger')
      // Escape closes without picking.
      await app.press('enter')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('true')
      await app.press('down')
      await app.press('escape')
      bunExpect(app.model().fruit).toBe('blueberry')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      bunExpect(app.document.activeElement?.getAttribute('id')).toBe('fruit-trigger')
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!METAL)('native, Metal', () => {
  test('anchored under the trigger, over the page; keyboard, focus restore, a click outside, roles', async () => {
    const app = await metal('select', Chooser)
    try {
      const trigger = app.document.getElementById('fruit-trigger')!
      await app.click(trigger)
      const list = app.document.getElementById('fruit-list')!
      const triggerBox = trigger.getBoundingClientRect()
      const listBox = list.getBoundingClientRect()
      console.log('ui select:', JSON.stringify({ triggerBox, listBox, active: app.document.activeElement?.getAttribute('id') }))
      // Under the trigger, its left edge with it; over the field below.
      bunExpect(listBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height)
      bunExpect(Math.abs(listBox.x - triggerBox.x)).toBeLessThanOrEqual(2)
      bunExpect(app.document.activeElement).toBe(list)
      bunExpect(app.gpuiFocus()).toBe(list)
      app.screenshot('open')

      // GPUI's accessibility tree has the roles.
      const roles = JSON.stringify(app.renderer.getA11yTree())
      for (const role of ['"ComboBox"', '"ListBox"', '"ListBoxOption"']) bunExpect(roles.toLowerCase()).toContain(role.toLowerCase())

      await app.keys('down down')
      await app.press('enter')
      bunExpect(app.model().fruit).toBe('cherry')
      bunExpect(app.painted()).toContain('Picked: cherry')
      bunExpect(app.document.activeElement).toBe(trigger)
      bunExpect(app.gpuiFocus()).toBe(trigger)

      // Open again, then a click outside (on the backdrop) closes it.
      await app.press('space')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('true')
      await app.click(app.document.getElementById('picked')!)
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      bunExpect(app.model().fruit).toBe('cherry')
      app.screenshot('closed')
    } finally {
      app.close()
    }
  })
})
