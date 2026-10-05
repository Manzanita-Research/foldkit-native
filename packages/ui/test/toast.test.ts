// Toast: its update and clock (story), then on FoldKit on gpuix, headless
// and on Metal in both themes: a live region, timed by the Toast's own
// Subscription, paused while hovered or focused, stacked in the corner.
import { describe, expect as bunExpect, test } from 'bun:test'
import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'

import * as Toast from '../src/toast.ts'
import { Notices, QuickNotices } from './apps-overlays.ts'
import { METAL, THEMES, headless, metal } from './run.ts'

const shown = (...titles: Array<string>) => {
  let next = Toast.init({ id: 't', duration: 1000, limit: 3 })
  for (const title of titles) next = Toast.show(next, { title }).model
  return next
}

describe('story', () => {
  test('show stacks them, newest last; past the limit the oldest goes', () => {
    const four = shown('a', 'b', 'c', 'd')
    bunExpect(four.entries.map(entry => [entry.id, entry.title])).toEqual([['t-1', 'b'], ['t-2', 'c'], ['t-3', 'd']])
    bunExpect(four.entries[0]!.remaining).toBe(1000)
    bunExpect(Toast.show(four, { title: 'long', variant: 'error', duration: 9000, description: 'why' }).model.entries.at(-1))
      .toEqual({ id: 't-4', variant: 'error', title: 'long', description: Option.some('why'), remaining: 9000 })
    bunExpect([Toast.roleOf('info'), Toast.roleOf('success'), Toast.roleOf('warning'), Toast.roleOf('error')]).toEqual(['status', 'status', 'alert', 'alert'])
  })

  test('the clock uses up each toast\'s time and takes it away; hover or focus pauses it, keeping what\'s left', () => {
    story(
      Toast.update,
      given(shown('a')),
      message(Toast.Message.Ticked({ ms: 600 })),
      model(next => bunExpect(next.entries[0]!.remaining).toBe(400)),
      message(Toast.Message.HoveredRegion()),
      model(next => bunExpect(Toast.isRunning(next)).toBe(false)),
      // A tick already on its way while paused changes nothing.
      message(Toast.Message.Ticked({ ms: 600 })),
      model(next => bunExpect(next.entries[0]!.remaining).toBe(400)),
      message(Toast.Message.FocusedRegion()),
      message(Toast.Message.LeftRegion()),
      model(next => bunExpect(Toast.isRunning(next)).toBe(false)),
      message(Toast.Message.BlurredRegion()),
      model(next => bunExpect(Toast.isRunning(next)).toBe(true)),
      message(Toast.Message.Ticked({ ms: 400 })),
      model(next => {
        bunExpect(next.entries).toEqual([])
        bunExpect(Toast.isRunning(next)).toBe(false)
      }),
    )
  })

  test('dismissing moves focus to the toast that takes its place; the last one leaves the region unfocused', () => {
    story(
      Toast.update,
      given({ ...shown('a', 'b', 'c'), isFocused: true }),
      message(Toast.Message.Dismissed({ entryId: 't-1', refocus: true })),
      Command.expectExact(Toast.FocusDismiss({ entryId: 't-2' })),
      Command.resolve(Toast.FocusDismiss, Toast.Message.CompletedFocus()),
      message(Toast.Message.Dismissed({ entryId: 't-2', refocus: true })),
      Command.expectExact(Toast.FocusDismiss({ entryId: 't-0' })),
      Command.resolve(Toast.FocusDismiss, Toast.Message.CompletedFocus()),
      message(Toast.Message.Dismissed({ entryId: 't-0', refocus: true })),
      Command.expectNone(),
      model(next => bunExpect(next).toMatchObject({ entries: [], isFocused: false })),
    )
  })
})

const id = (element: { getAttribute: (name: string) => string | null } | null | undefined) => element?.getAttribute('id') ?? null
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('native, headless', () => {
  test('a live region of status and alert toasts, newest last, named for assistive technology', async () => {
    const app = await headless(Notices)
    try {
      for (const variant of ['success', 'error', 'info', 'warning']) await app.click(`Show ${variant}`)
      const viewport = app.document.getElementById('toasts')!
      bunExpect(app.gpui.node(viewport.nativeId).props).toMatchObject({ role: 'region', 'aria-label': 'Notifications' })
      // The limit is 3: the first (success) went.
      const toasts = viewport.children
      bunExpect(toasts.map(toast => toast.getAttribute('role'))).toEqual(['alert', 'status', 'alert'])
      bunExpect(toasts.map(toast => app.gpui.node(toast.nativeId).props['aria-label'])).toEqual(['Couldn’t publish', 'Syncing', 'Disk nearly full'])
      bunExpect(toasts.every(toast => toast.getAttribute('aria-atomic') === 'true')).toBe(true)
      bunExpect(app.gpui.node(app.document.getElementById(Toast.dismissId('toasts-3'))!.nativeId).props['aria-label']).toBe('Dismiss: Disk nearly full')
      // Fixed in the corner: drawn under the body (its containing block).
      bunExpect(app.gpui.node(viewport.nativeId).parent).toBe(app.document.body.nativeId)
      bunExpect(app.gpui.node(viewport.nativeId).style).toMatchObject({ position: 'fixed', right: 16, bottom: 16 })
    } finally {
      app.close()
    }
  })

  test('the clock (a Subscription) takes a toast away when its time is up; hovering the region pauses it', async () => {
    const app = await headless(QuickNotices)
    try {
      await app.click('Show info')
      bunExpect(app.model().toasts.entries.length).toBe(1)
      await wait(120)
      await app.settle()
      bunExpect(app.model().toasts.entries.length).toBe(1)
      await wait(400)
      await app.settle()
      bunExpect(app.model().toasts.entries).toEqual([])

      // Hovered: it stays, however long; then it goes on from what was left.
      await app.click('Show success')
      const viewport = app.document.getElementById('toasts')!
      app.host.dispatch({ eventType: 'mouseEnter', elementId: viewport.nativeId, x: 400, y: 300 } as never)
      await app.settle()
      bunExpect(app.model().toasts.isHovered).toBe(true)
      await wait(600)
      await app.settle()
      bunExpect(app.model().toasts.entries.length).toBe(1)
      app.host.dispatch({ eventType: 'mouseLeave', elementId: viewport.nativeId, x: 10, y: 10 } as never)
      await wait(500)
      await app.settle()
      bunExpect(app.model().toasts.entries).toEqual([])
    } finally {
      app.close()
    }
  })

  test('keyboard: Tab reaches each dismiss button and pauses the clock; Escape dismisses and moves focus on; Enter dismisses the last', async () => {
    const app = await headless(QuickNotices)
    try {
      await app.click('Show warning')
      await app.click('Show error')
      // Past the buttons and the field, into the region.
      app.document.getElementById('field')!.focus()
      await app.settle()
      await app.press('tab')
      bunExpect(id(app.document.activeElement)).toBe(Toast.dismissId('toasts-0'))
      bunExpect(app.model().toasts.isFocused).toBe(true)
      await wait(500)
      await app.settle()
      bunExpect(app.model().toasts.entries.length).toBe(2)
      await app.press('escape')
      bunExpect(app.model().toasts.entries.map(entry => entry.title)).toEqual(['Couldn’t publish'])
      bunExpect(id(app.document.activeElement)).toBe(Toast.dismissId('toasts-1'))
      bunExpect(id(app.gpuiFocus())).toBe(Toast.dismissId('toasts-1'))
      await app.press('enter')
      bunExpect(app.model().toasts).toMatchObject({ entries: [], isFocused: false })
    } finally {
      app.close()
    }
  })

  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: the raised surface, and each variant's colour on its indicator`, async () => {
      const app = await headless(Notices, theme)
      try {
        const tokens = THEMES[theme]
        for (const variant of ['success', 'warning', 'error']) await app.click(`Show ${variant}`)
        const style = (element: { nativeId: number }) => app.gpui.node(element.nativeId).style
        const toasts = app.document.getElementById('toasts')!.children
        bunExpect(style(toasts[0]!)).toMatchObject({ backgroundColor: tokens['color.surface-raised'], borderTopLeftRadius: tokens['radius.panel'] })
        const indicators = toasts.map(toast => style(toast.querySelector('[data-part="indicator"]')!)['backgroundColor'])
        bunExpect(indicators).toEqual([tokens['color.success'], tokens['color.warning'], tokens['color.danger']])
      } finally {
        app.close()
      }
    })
  }
})

describe.skipIf(!METAL)('native, Metal', () => {
  for (const theme of ['paper', 'dusk'] as const) {
    test(`${theme}: stacked in the bottom-right corner; AccessKit has the region and its status and alert; Escape and hover`, async () => {
      const app = await metal('toast', Notices, theme)
      try {
        for (const variant of ['success', 'warning', 'error']) await app.click(app.document.getElementById(`show-${variant}`)!)
        await app.settle()
        const viewport = app.document.getElementById('toasts')!
        const box = viewport.getBoundingClientRect()
        const toasts = viewport.children.map(toast => toast.getBoundingClientRect())
        console.log(`ui toast ${theme}:`, JSON.stringify({ box, toasts }))
        // 16 px in from the window's right and bottom; newest at the bottom.
        bunExpect(Math.round(box.x + box.width)).toBe(480 - 16)
        bunExpect(Math.round(box.y + box.height)).toBe(360 - 16)
        bunExpect(toasts[0]!.y).toBeLessThan(toasts[1]!.y)
        bunExpect(toasts[1]!.y).toBeLessThan(toasts[2]!.y)
        bunExpect(app.painted()).toContain('Couldn’t publish')
        app.screenshot('stack')

        const tree = JSON.stringify(app.renderer.getA11yTree()).toLowerCase()
        for (const role of ['"status"', '"alert"', 'notifications']) bunExpect(tree).toContain(role)

        // The pointer over the region pauses the clock. (GPUI hit-tests a
        // move against the last frame: the first move places the pointer.)
        const move = async (x: number, y: number) => {
          for (const dx of [0, 1]) {
            app.renderer.nativeSimulateMouseMove(x + dx, y)
            await app.settle()
          }
        }
        await move(box.x + 40, box.y + 20)
        bunExpect(app.model().toasts.isHovered).toBe(true)
        await move(20, 200)
        bunExpect(app.model().toasts.isHovered).toBe(false)

        // Keyboard: from the field, Tab into the region; Escape dismisses.
        app.document.getElementById('field')!.focus()
        await app.settle()
        await app.press('tab')
        bunExpect(id(app.gpuiFocus())).toBe(Toast.dismissId('toasts-0'))
        app.screenshot('focused')
        await app.press('escape')
        bunExpect(app.model().toasts.entries.map(entry => entry.title)).toEqual(['Disk nearly full', 'Couldn’t publish'])
        bunExpect(id(app.gpuiFocus())).toBe(Toast.dismissId('toasts-1'))
      } finally {
        app.close()
      }
    })
  }
})
