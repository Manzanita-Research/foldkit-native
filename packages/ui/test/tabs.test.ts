// Tabs: its update (story), the view (scene), and native tests on FoldKit on
// gpuix (headless, and on Metal in both themes).
import { describe, expect as bunExpect, test } from 'bun:test'
import { Option } from 'effect'
import { Command as SceneCommand, click, expect, given, role, scene, text } from 'foldkit/scene'
import { Command, given as storyGiven, message, model, story } from 'foldkit/story'

import * as Tabs from '../src/tabs.ts'
import { Settings, Sidebar } from './apps.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

describe('story', () => {
  test('selecting focuses the tab and tells the parent; in Manual, focusing alone only moves focus', () => {
    story(
      Tabs.update,
      storyGiven(Tabs.init({ id: 'settings', activationMode: 'Manual' })),
      message(Tabs.Message.FocusedTab({ index: 3 })),
      Command.expectHas(Tabs.FocusTab({ id: 'settings', index: 3 })),
      Command.resolve(Tabs.FocusTab, Tabs.Message.CompletedFocusTab()),
      model(next => bunExpect(next.maybeFocusedIndex).toEqual(Option.some(3))),
      message(Tabs.Message.SelectedTab({ index: 3, value: 'about' })),
      Command.expectHas(Tabs.FocusTab({ id: 'settings', index: 3 })),
      Command.resolve(Tabs.FocusTab, Tabs.Message.CompletedFocusTab()),
      model(next => bunExpect(next.maybeFocusedIndex).toEqual(Option.none())),
    )
    const selected = Tabs.update(Tabs.init({ id: 'settings' }), Tabs.Message.SelectedTab({ index: 1, value: 'privacy' }))
    bunExpect(selected.outMessage).toEqual(Tabs.OutMessage.Selected({ value: 'privacy', index: 1 }))
    bunExpect(Tabs.init({ id: 'settings' }).activationMode).toBe('Automatic')
  })
})

describe('scene', () => {
  test('a labelled tablist; the selected tab controls the panel it labels; a click selects', () => {
    scene(
      { update: Settings.update, view: Settings.view },
      given(Settings.init),
      expect(role('tablist', { name: 'Settings' })).toHaveAttr('aria-orientation', 'horizontal'),
      expect(role('tab', { name: 'General' })).toHaveAttr('aria-selected', 'true'),
      expect(role('tab', { name: 'General' })).toHaveAttr('aria-controls', 'settings-panel-0'),
      expect(role('tabpanel')).toHaveAttr('aria-labelledby', 'settings-tab-0'),
      click(role('tab', { name: 'Privacy' })),
      SceneCommand.resolve(Tabs.FocusTab, Tabs.Message.CompletedFocusTab()),
      expect(role('tab', { name: 'Privacy' })).toHaveAttr('aria-selected', 'true'),
      expect(text('Nobody sees your activity.')).toExist(),
      expect(role('tab', { name: 'Advanced' })).toHaveAttr('aria-disabled', 'true'),
    )
  })
})

describe('native, headless', () => {
  test('Automatic: one tab stop; the arrows select, wrap and skip the disabled tab; Tab goes on to the panel', async () => {
    const app = await headless(Settings)
    try {
      const active = () => app.document.activeElement?.getAttribute('id') ?? null
      await app.press('tab')
      bunExpect(active()).toBe('settings-tab-0')
      await app.press('right')
      bunExpect([app.model().section, active()]).toEqual(['privacy', 'settings-tab-1'])
      bunExpect(app.gpuiFocus()?.getAttribute('id')).toBe('settings-tab-1')
      bunExpect(app.texts()).toContain('Nobody sees your activity.')
      // Advanced is disabled: Right goes past it.
      await app.press('right')
      bunExpect([app.model().section, active()]).toEqual(['about', 'settings-tab-3'])
      await app.press('right')
      bunExpect(app.model().section).toBe('general')
      await app.press('left')
      bunExpect(app.model().section).toBe('about')
      await app.press('home')
      bunExpect(app.model().section).toBe('general')
      await app.press('end')
      bunExpect(app.model().section).toBe('about')
      // Up and Down aren't a horizontal list's keys.
      await app.press('down')
      bunExpect(app.model().section).toBe('about')
      await app.press('tab')
      bunExpect(active()).toBe('settings-panel-3')
      await app.press('tab', { shift: true })
      bunExpect(active()).toBe('settings-tab-3')
      // A click selects; the disabled tab ignores one.
      await app.click('Advanced')
      bunExpect(app.model().section).toBe('about')
      await app.click('General')
      bunExpect(app.model().section).toBe('general')
      // Through the General panel, Tab reaches its field.
      await app.press('tab')
      await app.press('tab')
      bunExpect(active()).toBe('name')
    } finally {
      app.close()
    }
  })

  test('Manual, vertical: the arrows (Down and Up) move focus only; Enter and Space select', async () => {
    const app = await headless(Sidebar)
    try {
      const active = () => app.document.activeElement?.getAttribute('id') ?? null
      await app.press('tab')
      await app.press('down')
      bunExpect([app.model().section, active()]).toEqual(['general', 'settings-tab-1'])
      bunExpect(app.document.getElementById('settings-tab-0')!.getAttribute('aria-selected')).toBe('true')
      await app.press('enter')
      bunExpect([app.model().section, active()]).toEqual(['privacy', 'settings-tab-1'])
      await app.press('down')
      bunExpect(active()).toBe('settings-tab-3')
      await app.press('space')
      bunExpect(app.model().section).toBe('about')
      await app.press('right')
      bunExpect(active()).toBe('settings-tab-3')
      await app.press('up')
      bunExpect([app.model().section, active()]).toEqual(['about', 'settings-tab-1'])
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: the selected tab is the text colour with the accent underline; the rest muted`, async () => {
      const app = await headless(Settings, theme)
      try {
        const tokens = THEMES[theme]
        const style = (id: string) => app.gpui.node(app.document.getElementById(id)!.nativeId).style
        bunExpect(style('settings-tab-0')).toMatchObject({ borderColor: tokens['color.accent'] })
        bunExpect(style('settings-tab-1')).toMatchObject({ borderColor: tokens['color.canvas'] })
        bunExpect(style('settings-tab-2')['opacity']).toBe(0.5)
        const label = (id: string) => app.gpui.node(app.document.getElementById(id)!.firstChild!.nativeId).style
        bunExpect(label('settings-tab-0')).toMatchObject({ color: tokens['color.text'] })
        bunExpect(label('settings-tab-1')).toMatchObject({ color: tokens['color.text-muted'] })
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: clicked through GPUI's hit test, arrowed from the keyboard; AccessKit has the tabs`, async () => {
      const app = await metal('tabs', Settings, theme)
      try {
        app.screenshot('initial')
        await app.click(app.document.getElementById('settings-tab-1')!)
        bunExpect(app.model().section).toBe('privacy')
        bunExpect(app.painted()).toContain('Nobody sees your activity.')
        await app.click(app.document.getElementById('settings-tab-2')!)
        bunExpect(app.model().section).toBe('privacy')
        await app.press('right')
        bunExpect(app.model().section).toBe('about')
        bunExpect(app.gpuiFocus()?.getAttribute('id')).toBe('settings-tab-3')
        const tree = JSON.stringify(app.renderer.getA11yTree())
        console.log(`ui tabs a11y (${theme}):`, tree.slice(0, 900))
        bunExpect(tree.toLowerCase()).toContain('"tab"')
        bunExpect(tree.toLowerCase()).toContain('tablist')
        for (const name of ['General', 'Privacy', 'Advanced', 'About']) bunExpect(tree).toContain(name)
        await app.press('home')
        await app.keys('tab')
        await app.keys('tab')
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('name')
        await app.keys('shift-tab shift-tab')
        bunExpect(app.document.activeElement?.getAttribute('id')).toBe('settings-tab-0')
        app.screenshot('focused')
      } finally {
        app.close()
      }
    })
  }

  test('vertical, Manual (dusk): drawn as a column with the indicator on the right', async () => {
    const app = await metal('tabs-vertical', Sidebar)
    try {
      await app.click(app.document.getElementById('settings-tab-1')!)
      bunExpect(app.model().section).toBe('privacy')
      const first = app.document.getElementById('settings-tab-0')!.getBoundingClientRect()
      const second = app.document.getElementById('settings-tab-1')!.getBoundingClientRect()
      bunExpect(second.y).toBeGreaterThan(first.y)
      bunExpect(second.x).toBe(first.x)
      await app.keys('down')
      app.screenshot('focused')
    } finally {
      app.close()
    }
  })
})
