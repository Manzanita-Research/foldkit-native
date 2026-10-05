// Popover: its update (story), then on FoldKit on gpuix, headless and on
// Metal in both themes, where the panel is GPUI's own anchored element and
// focus, inert isolation and scroll lock run through FoldKit's Dom Commands
// on the native document (no happy-dom).
import { describe, expect as bunExpect, test } from 'bun:test'
import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'

import * as Popover from '../src/popover.ts'
import { Sharing } from './apps-overlays.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

describe('story', () => {
  test('opening focuses the panel (or initialFocus); a modal one isolates; closing restores focus and releases', () => {
    story(
      Popover.update,
      given(Popover.init({ id: 'share', initialFocus: 'share-copy' })),
      message(Popover.Message.Opened()),
      Command.expectExact(Popover.FocusPanel({ elementId: 'share-copy' })),
      Command.resolve(Popover.FocusPanel, Popover.Message.CompletedFocus()),
      model(next => bunExpect(next.isOpen).toBe(true)),
      message(Popover.Message.Closed({ restoreFocus: false })),
      Command.expectNone(),
      model(next => bunExpect(next.isOpen).toBe(false)),
      // Already closed (Escape, then the panel losing focus as it goes): nothing.
      message(Popover.Message.Closed({ restoreFocus: true })),
      Command.expectNone(),
    )
    story(
      Popover.update,
      given(Popover.init({ id: 'filters', isModal: true })),
      message(Popover.Message.Opened()),
      Command.expectExact(Popover.Isolate({ id: 'filters' }), Popover.FocusPanel({ elementId: 'filters-panel' })),
      Command.resolve(Popover.Isolate, Popover.Message.CompletedIsolation()),
      Command.resolve(Popover.FocusPanel, Popover.Message.CompletedFocus()),
      message(Popover.Message.Closed({ restoreFocus: true })),
      Command.expectExact(Popover.Release({ id: 'filters' }), Popover.FocusTrigger({ id: 'filters' })),
      Command.resolve(Popover.Release, Popover.Message.CompletedIsolation()),
      Command.resolve(Popover.FocusTrigger, Popover.Message.CompletedFocus()),
      model(next => bunExpect(next.isOpen).toBe(false)),
    )
    bunExpect(Popover.init({ id: 'x' }).initialFocus).toEqual(Option.none())
  })
})

const id = (element: { getAttribute: (name: string) => string | null } | null | undefined) => element?.getAttribute('id') ?? null

describe('native, headless', () => {
  test('keyboard: Enter opens it on the anchored element with focus inside; Tab out closes it and goes on; Escape and a click outside close it back to the trigger', async () => {
    const app = await headless(Sharing)
    try {
      const trigger = app.document.getElementById('share-trigger')!
      await app.press('tab')
      await app.press('tab')
      bunExpect(id(app.document.activeElement)).toBe('share-trigger')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      bunExpect(trigger.hasAttribute('aria-controls')).toBe(false)
      await app.press('enter')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('true')
      bunExpect(trigger.getAttribute('aria-controls')).toBe('share-panel')
      const anchor = app.document.querySelector('[data-ui="popover"][data-part="anchor"]')!
      bunExpect(app.gpui.node(anchor.nativeId).type).toBe('anchored')
      bunExpect(app.gpui.node(anchor.nativeId).props).toMatchObject({ side: 'bottom', align: 'start', gap: 8 })
      // initialFocus: the Copy button, in GPUI too.
      bunExpect(id(app.document.activeElement)).toBe('share-copy')
      bunExpect(id(app.gpuiFocus())).toBe('share-copy')
      // AccessKit: a dialog named by its title, the trigger expanded.
      const panel = app.gpui.node(app.document.getElementById('share-panel')!.nativeId)
      bunExpect(panel.props).toMatchObject({ role: 'dialog', 'aria-label': 'Share link', tabIndex: 0 })
      bunExpect(app.gpui.node(trigger.nativeId).props['aria-expanded']).toBe(true)
      // Not modal: nothing is inert, the page still scrolls.
      bunExpect(app.document.querySelector('[inert]')).toBeNull()
      bunExpect(app.document.documentElement.style.overflow).toBe('')

      // Tab past the panel's last stop: it closes, and focus goes on.
      await app.press('tab')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      bunExpect(id(app.document.activeElement)).toBe('filters-trigger')

      // Space opens it again; Escape closes it, focus back on the trigger.
      await app.press('tab', { shift: true })
      bunExpect(id(app.document.activeElement)).toBe('share-trigger')
      await app.press('space')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('true')
      await app.press('escape')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      bunExpect(id(app.document.activeElement)).toBe('share-trigger')

      // A click outside (the backdrop) closes it, back to the trigger.
      await app.press('enter')
      bunExpect(app.document.getElementById('share-backdrop')).not.toBeNull()
      app.host.dispatch({ eventType: 'click', elementId: app.document.getElementById('share-backdrop')!.nativeId, x: 400, y: 300, button: 0, clickCount: 1 } as never)
      await app.settle()
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      bunExpect(id(app.document.activeElement)).toBe('share-trigger')

      // An action in the panel closes it through the parent (Popover.close).
      await app.press('enter')
      await app.press('enter')
      bunExpect(app.model().copied).toBe(1)
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      bunExpect(id(app.document.activeElement)).toBe('share-trigger')
    } finally {
      app.close()
    }
  })

  test('modal: Tab stays inside, the rest is inert and out of GPUI\'s tab order, the page\'s scroll is locked; closing gives it all back', async () => {
    const app = await headless(Sharing)
    try {
      const trigger = app.document.getElementById('filters-trigger')!
      trigger.focus()
      await app.settle()
      await app.press('enter')
      bunExpect(id(app.document.activeElement)).toBe('filters-panel')
      bunExpect(app.document.getElementById('filters-panel')!.getAttribute('aria-modal')).toBe('true')
      // Dom.inertOthers and Dom.lockScroll, on the native document.
      for (const outside of ['before', 'share-trigger', 'after']) {
        bunExpect(app.document.getElementById(outside)!.closest('[inert]')).not.toBeNull()
        // Not a tab stop in GPUI (a field is sent -1, a button none).
        bunExpect(Number(app.gpui.node(app.document.getElementById(outside)!.nativeId).props['tabIndex'] ?? -1)).toBeLessThan(0)
      }
      bunExpect(trigger.closest('[inert]')).toBeNull()
      bunExpect(app.document.documentElement.style.overflow).toBe('hidden')
      bunExpect(app.gpui.node(app.document.body.nativeId).style['overflowY']).toBe('hidden')

      const stops: Array<string | null> = []
      for (let i = 0; i < 4; i++) {
        await app.press('tab')
        stops.push(id(app.document.activeElement))
      }
      bunExpect(stops).toEqual(['only-open', 'filters-apply', 'filters-panel', 'only-open'])
      await app.press('space')
      bunExpect(app.model().onlyOpen).toBe(true)
      await app.press('tab')
      await app.press('enter')
      bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
      bunExpect(id(app.document.activeElement)).toBe('filters-trigger')
      bunExpect(app.document.querySelector('[inert]')).toBeNull()
      bunExpect(app.document.documentElement.style.overflow).toBe('')
      bunExpect(app.gpui.node(app.document.body.nativeId).style['overflowY']).toBe('scroll')
      bunExpect(app.texts()).toContain('Copied 0 times, open issues only')
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: the panel is the raised surface with the overlay shadow; the open trigger shows the focus colour`, async () => {
      const app = await headless(Sharing, theme)
      try {
        const tokens = THEMES[theme]
        await app.click('Share')
        const panel = app.gpui.node(app.document.getElementById('share-panel')!.nativeId).style
        bunExpect(panel).toMatchObject({ backgroundColor: tokens['color.surface-raised'], borderTopLeftRadius: tokens['radius.panel'], width: 280 })
        bunExpect(panel['boxShadow']).toBeDefined()
        bunExpect(app.gpui.node(app.document.getElementById('share-trigger')!.nativeId).style).toMatchObject({ borderColor: tokens['color.focus'] })
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: anchored under its trigger over the page; keyboard in and out; AccessKit; modal isolation`, async () => {
      const app = await metal('popover', Sharing, theme)
      try {
        const trigger = app.document.getElementById('share-trigger')!
        app.screenshot('closed')
        await app.click(trigger)
        const panel = app.document.getElementById('share-panel')!
        const triggerBox = trigger.getBoundingClientRect()
        const panelBox = panel.getBoundingClientRect()
        // The panel's rounded corner shows the page behind it, not GPUI's
        // anchored box (it painted black there before the host rounded it).
        const corner = app.pixels('open').at(panelBox.x + 1, panelBox.y + 1)
        console.log(`ui popover ${theme}:`, JSON.stringify({ triggerBox, panelBox, corner, active: id(app.document.activeElement) }))
        if (theme === 'paper') bunExpect(corner[0] + corner[1] + corner[2]).toBeGreaterThan(500)
        // Under the trigger, its left edge with it, 8 px below; over the field.
        bunExpect(panelBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height + 6)
        bunExpect(Math.abs(panelBox.x - triggerBox.x)).toBeLessThanOrEqual(2)
        bunExpect(id(app.gpuiFocus())).toBe('share-copy')
        bunExpect(app.painted()).toContain('Share link')

        const tree = JSON.stringify(app.renderer.getA11yTree()).toLowerCase()
        bunExpect(tree).toContain('"dialog"')
        bunExpect(tree).toContain('share link')

        // Escape: closed, GPUI's focus back on the trigger.
        await app.press('escape')
        bunExpect(trigger.getAttribute('aria-expanded')).toBe('false')
        bunExpect(app.gpuiFocus()).toBe(trigger)

        // Modal, by keyboard: Tab to Filters, Enter; a click on what's
        // outside lands on the backdrop and closes it.
        await app.keys('tab')
        bunExpect(id(app.gpuiFocus())).toBe('filters-trigger')
        await app.press('enter')
        bunExpect(id(app.gpuiFocus())).toBe('filters-panel')
        bunExpect(app.document.getElementById('after')!.closest('[inert]')).not.toBeNull()
        await app.keys('tab tab tab')
        bunExpect(id(app.gpuiFocus())).toBe('filters-panel')
        await app.keys('tab')
        await app.press('space')
        app.screenshot('modal')
        // Before is inert under the backdrop: the click lands on the backdrop.
        await app.click(app.document.getElementById('before')!)
        bunExpect(app.document.getElementById('filters-trigger')!.getAttribute('aria-expanded')).toBe('false')
        bunExpect(app.document.querySelector('[inert]')).toBeNull()
        bunExpect(app.model().onlyOpen).toBe(true)
        bunExpect(id(app.gpuiFocus())).toBe('filters-trigger')
      } finally {
        app.close()
      }
    })
  }
})
