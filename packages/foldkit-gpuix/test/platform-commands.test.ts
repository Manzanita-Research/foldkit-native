// The platform Commands @foldkit/ui runs through FoldKit's `Dom` (its
// listbox, menu, popover and dialog: @foldkit/ui/dist/listbox/shared.js),
// on the native document with no happy-dom: scroll lock, inert isolation,
// click, scroll-into-view-if-needed, element movement (ResizeObserver) and
// animation settle (GPUI's motion). Headless on the fake GPUI, then on real
// GPUI, where layout, hit testing, scrolling and the motion clock are GPUI's.
// (Focus, scrollIntoView, advanceFocus and showDialog: commands.test.ts.)
import { describe, expect, test } from 'bun:test'
import { Effect, Schema } from 'effect'
import { Command, Dom, Runtime } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { METAL, mountHeadless, openMetal } from './support.ts'

const Message = defineMessageUnion({
  Asked: { what: Schema.String },
  Done: { what: Schema.String },
  ClickedOutside: {},
  ToggledFade: {},
  ToggledWidth: {},
})
type Message = typeof Message.Type
const Model = Schema.Struct({ done: Schema.Array(Schema.String), outside: Schema.Number, fading: Schema.Boolean, wide: Schema.Boolean })
type Model = typeof Model.Type

const run = (what: string, effect: Effect.Effect<unknown, unknown>) =>
  Command.define(`Dom ${what}`, { messages: [Message.Done], execute: effect.pipe(Effect.ignore, Effect.as(Message.Done({ what }))) })()
const COMMANDS: Readonly<Record<string, () => Effect.Effect<unknown, unknown>>> = {
  lock: () => Dom.lockScroll,
  unlock: () => Dom.unlockScroll,
  inert: () => Dom.inertOthers('menu', ['#trigger', '#panel']),
  restore: () => Dom.restoreInert('menu'),
  click: () => Dom.clickElement('#outside'),
  'near-1': () => Dom.scrollIntoViewIfNotVisible('#row-1', { when: 'Commit' }),
  'near-15': () => Dom.scrollIntoViewIfNotVisible('#row-15', { when: 'Commit' }),
  settle: () => Dom.waitForAnimationSettled('#fader'),
  move: () => Dom.detectElementMovement('#row-5'),
}
const update = (model: Model, message: Message) =>
  Message.match(message, {
    Asked: ({ what }) => ({ model, commands: [run(what, COMMANDS[what]!())] }),
    Done: ({ what }) => ({ model: { ...model, done: [...model.done, what] } }),
    ClickedOutside: () => ({ model: { ...model, outside: model.outside + 1 } }),
    ToggledFade: () => ({ model: { ...model, fading: !model.fading } }),
    ToggledWidth: () => ({ model: { ...model, wide: !model.wide } }),
  })
const ask = (h: HtmlBuilder<Message>, what: string) => h.button([h.Id(`ask-${what}`), h.OnClick(Message.Asked({ what }))], [what])
const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.div([h.Class('page')], [
    h.div([h.Class('row')], [
      ...Object.keys(COMMANDS).map(what => ask(h, what)),
      h.button([h.Id('fade'), h.OnClick(Message.ToggledFade())], ['fade']),
      h.button([h.Id('grow'), h.OnClick(Message.ToggledWidth())], ['grow']),
    ]),
    h.div([h.Class('row')], [
      h.button([h.Id('trigger')], ['trigger']),
      h.div([h.Id('panel'), h.Tabindex(0)], ['panel']),
      h.button([h.Id('outside'), h.OnClick(Message.ClickedOutside())], ['outside']),
    ]),
    h.div([h.Id('log'), h.Class('log')], Array.from({ length: 20 }, (_, i) => h.div([h.Id(`row-${i}`), h.Class('line')], [`row ${i}`]))),
    h.div([
      h.Id('fader'), h.Class('fader'),
      ...(model.fading ? [h.DataAttribute('fn-motion', JSON.stringify({ initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.4 } }))] : []),
    ], ['fader']),
    h.div([h.Id('grower'), h.Class(model.wide ? 'grower wide' : 'grower')], ['grower']),
    h.p([h.Id('hidden-by-sheet'), h.Class('gone')], ['gone']),
    h.div([h.Class('tall')], ['the page goes on']),
  ])
const css = `
  .page { display: flex; flex-direction: column; gap: 4px; padding: 8px; }
  .row { display: flex; flex-direction: row; flex-wrap: wrap; gap: 4px; }
  .log { overflow-y: auto; height: 60px; flex-shrink: 0; }
  .line { height: 20px; flex-shrink: 0; }
  .fader { height: 20px; flex-shrink: 0; }
  .grower { width: 100px; height: 20px; padding: 2px 4px; border: 1px solid #888888; flex-shrink: 0; }
  .grower.wide { width: 200px; }
  .tall { height: 600px; flex-shrink: 0; }
  .gone { display: none; }
`
const start = (container: HTMLElement) => {
  let latest: Model = { done: [], outside: 0, fading: false, wide: false }
  const program = Runtime.makeElement({
    Model,
    init: () => ({ model: latest }),
    update,
    view: (model: Model, h: HtmlBuilder<Message>) => {
      latest = model
      return view(model, h)
    },
    container,
  } as never)
  return { program, model: () => latest }
}

const SIZE = { width: 480, height: 400 }

describe('platform Commands, headless', () => {
  const open = async () => {
    const app = mountHeadless({ css, viewport: SIZE })
    const { program, model } = start(app.container)
    app.own(Runtime.embed(program))
    await app.settle()
    const byId = (id: string) => app.document.getElementById(id)!
    /** Clicks a button the way a press does once GPUI has hit it. */
    const press = async (id: string) => {
      app.host.dispatch({ eventType: 'click', elementId: byId(id).nativeId, x: 1, y: 1, button: 0, clickCount: 1 } as never)
      await app.settle()
      await app.settle()
    }
    /** GPUI lays `id` out at `box` (the fake has no layout of its own). */
    const place = (id: string, box: { x: number; y: number; width: number; height: number }) => {
      app.gpui.setBounds(byId(id).nativeId, box)
      app.host.relayout()
    }
    return { ...app, model, byId, press, place }
  }

  test('lockScroll: the root\'s overflow is the page\'s (the body GPUI scrolls); nested locks count; no scrollbar padding', async () => {
    const app = await open()
    try {
      const body = () => app.gpui.node(app.document.body.nativeId).style
      expect(body()['overflowY']).toBe('scroll')
      // What lockScroll reads: a desktop platform, and no scrollbar width.
      expect(window.navigator.platform).toBe(process.platform === 'darwin' ? 'MacIntel' : 'Linux x86_64')
      expect(window.navigator.maxTouchPoints).toBe(0)
      expect(app.document.documentElement.clientWidth).toBe(SIZE.width)
      await app.press('ask-lock')
      expect(app.model().done).toEqual(['lock'])
      expect(app.document.documentElement.style.overflow).toBe('hidden')
      expect(app.document.documentElement.style.paddingRight).toBe('')
      expect(body()['overflowY']).toBe('hidden')
      expect(getComputedStyle(app.document.body as never).overflowY).toBe('hidden')
      await app.press('ask-lock')
      await app.press('ask-unlock')
      expect(body()['overflowY']).toBe('hidden')
      await app.press('ask-unlock')
      expect(body()['overflowY']).toBe('scroll')
      expect(app.document.documentElement.style.overflow).toBe('')
    } finally {
      app.close()
    }
  })

  test('inertOthers: what\'s outside is inert, out of the tab order and GPUI\'s hit test, and hears no clicks; restoreInert gives it back', async () => {
    const app = await open()
    try {
      const outside = app.byId('outside')
      app.place('outside', { x: 100, y: 40, width: 60, height: 24 })
      app.host.drawn()
      expect(app.document.elementsFromPoint(110, 50)).toContain(outside)

      await app.press('ask-inert')
      expect(app.model().done).toEqual(['inert'])
      expect(outside.closest('[inert]')).not.toBeNull()
      expect(app.byId('log').closest('[inert]')).not.toBeNull()
      expect(app.byId('trigger').closest('[inert]')).toBeNull()
      expect(app.byId('panel').closest('[inert]')).toBeNull()
      expect(outside.closest('[aria-hidden="true"]')).not.toBeNull()
      const native = () => app.gpui.node(outside.nativeId)
      expect(native().style['pointerEvents']).toBe('none')
      // Cleared in GPUI (sent as null): no longer a tab stop.
      expect(native().props['tabIndex'] ?? null).toBeNull()
      // A press GPUI was already delivering is dropped, and hit testing
      // (elementsFromPoint) passes through.
      await app.press('outside')
      expect(app.model().outside).toBe(0)
      app.host.relayout()
      app.host.drawn()
      expect(app.document.elementsFromPoint(110, 50)).not.toContain(outside)

      // The ask buttons are outside too: a press on one is dropped as well.
      await app.press('ask-restore')
      expect(app.model().done).toEqual(['inert'])
      // From script (an app's own Message would come this way): inert
      // doesn't stop click().
      app.byId('ask-restore').click()
      await app.settle()
      await app.settle()
      expect(app.model().done).toEqual(['inert', 'restore'])
      expect(app.document.querySelector('[inert]')).toBeNull()
      expect(app.document.querySelector('[aria-hidden]')).toBeNull()
      expect(native().style['pointerEvents']).toBeUndefined()
      expect(native().props['tabIndex']).toBe(0)
      app.host.relayout()
      app.host.drawn()
      expect(app.document.elementsFromPoint(110, 50)).toContain(outside)
      await app.press('outside')
      expect(app.model().outside).toBe(1)
    } finally {
      app.close()
    }
  })

  test('clickElement clicks; getComputedStyle and checkVisibility read the sheet', async () => {
    const app = await open()
    try {
      await app.press('ask-click')
      expect(app.model()).toMatchObject({ done: ['click'], outside: 1 })
      const log = app.byId('log') as never
      // `overflow-y: auto` from a class rule (GPUI's only kind is `scroll`).
      expect(getComputedStyle(log).overflowY).toBe('scroll')
      expect(getComputedStyle(log).getPropertyValue('height')).toBe('60px')
      expect(getComputedStyle(app.byId('panel') as never).position).toBe('static')
      // Hidden by a rule, not inline: FoldKit's focus helpers skip it.
      expect(app.byId('hidden-by-sheet').checkVisibility()).toBe(false)
      expect(app.byId('log').checkVisibility()).toBe(true)
    } finally {
      app.close()
    }
  })

  test('ResizeObserver: the first size, then each change GPUI lays out; detectElementMovement resolves on one', async () => {
    const app = await open()
    try {
      const entries: Array<{ id: string | null; border: number; content: number; x: number }> = []
      const observer = new ResizeObserver(seen => {
        for (const entry of seen) {
          entries.push({ id: entry.target.getAttribute('id'), border: entry.borderBoxSize[0]!.inlineSize, content: entry.contentRect.width, x: entry.contentRect.x })
        }
      })
      app.place('grower', { x: 8, y: 300, width: 110, height: 26 })
      observer.observe(app.byId('grower') as never)
      app.host.drawn()
      // The grower's style: 1px border, 4px side padding.
      expect(entries).toEqual([{ id: 'grower', border: 110, content: 100, x: 5 }])
      app.host.drawn()
      expect(entries.length).toBe(1)
      app.place('grower', { x: 8, y: 300, width: 210, height: 26 })
      app.host.drawn()
      expect(entries.at(-1)).toEqual({ id: 'grower', border: 210, content: 200, x: 5 })
      observer.disconnect()
      app.place('grower', { x: 8, y: 300, width: 110, height: 26 })
      app.host.drawn()
      expect(entries.length).toBe(2)
      expect(app.document.resizeObservers.size).toBe(0)

      app.place('row-5', { x: 8, y: 200, width: 300, height: 20 })
      await app.press('ask-move')
      expect(app.model().done).toEqual([])
      app.place('row-5', { x: 8, y: 180, width: 300, height: 22 })
      await app.settle()
      expect(app.model().done).toEqual(['move'])
      // The wait cleaned up after itself.
      expect(app.document.resizeObservers.size).toBe(0)
    } finally {
      app.close()
    }
  })

  test('waitForAnimationSettled: waits for GPUI\'s motion (data-fn-motion) to report it\'s done', async () => {
    const app = await open()
    try {
      const fader = app.byId('fader')
      expect(fader.getAnimations()).toEqual([])
      await app.press('ask-settle')
      expect(app.model().done).toEqual(['settle'])
      await app.press('fade')
      expect(app.gpui.node(fader.nativeId).props['motion']).toMatchObject({ animate: { opacity: 1 } })
      expect(fader.getAnimations().length).toBe(1)
      await app.press('ask-settle')
      expect(app.model().done).toEqual(['settle'])
      app.host.dispatch({ eventType: 'motionComplete', elementId: fader.nativeId, motionGeneration: 1 } as never)
      await app.settle()
      expect(app.model().done).toEqual(['settle', 'settle'])
      expect(fader.getAnimations()).toEqual([])
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!METAL)('platform Commands on real GPUI (Metal)', () => {
  const open = async (name: string) => {
    const app = await openMetal(`platform-${name}`, SIZE, { css })
    const { program, model } = start(app.container)
    app.own(Runtime.embed(program))
    await app.settle()
    const byId = (id: string) => app.document.getElementById(id)!
    return { ...app, model, byId, press: async (id: string) => app.click(byId(id)) }
  }

  test('lockScroll stops the page scrolling under the wheel; unlockScroll lets it go again', async () => {
    const app = await open('lock')
    try {
      const body = app.document.body
      const offset = () => app.renderer.getScrollOffset(body.nativeId)?.[1] ?? 0
      app.renderer.nativeSimulateScrollWheel(240, 300, 0, -120)
      await app.settle()
      const free = offset()
      app.renderer.scrollTo(body.nativeId, 0, 0)
      await app.settle()
      await app.press('ask-lock')
      app.renderer.nativeSimulateScrollWheel(240, 300, 0, -120)
      await app.settle()
      const locked = offset()
      app.screenshot('locked')
      await app.press('ask-unlock')
      app.renderer.nativeSimulateScrollWheel(240, 300, 0, -120)
      await app.settle()
      const unlocked = offset()
      console.log('platform lockScroll:', JSON.stringify({ free, locked, unlocked }))
      expect(free).toBeLessThan(0)
      expect(locked).toBe(0)
      expect(unlocked).toBeLessThan(0)
      expect(app.model().done).toEqual(['lock', 'unlock'])
    } finally {
      app.close()
    }
  })

  test('inertOthers: a click on what\'s outside reaches nothing; restoreInert lets it through', async () => {
    const app = await open('inert')
    try {
      const outside = app.byId('outside')
      const box = outside.getBoundingClientRect()
      await app.press('ask-inert')
      app.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
      await app.settle()
      expect(app.model().outside).toBe(0)
      expect(app.document.elementsFromPoint(box.x + 2, box.y + 2)).not.toContain(outside)
      app.screenshot('inert')
      app.byId('ask-restore').click()
      await app.settle()
      app.renderer.nativeSimulateClick(box.x + box.width / 2, box.y + box.height / 2)
      await app.settle()
      expect(app.model().outside).toBe(1)
    } finally {
      app.close()
    }
  })

  test('scrollIntoViewIfNotVisible leaves a row that shows, and centres one that doesn\'t', async () => {
    const app = await open('near')
    try {
      const log = app.byId('log')
      await app.press('ask-near-1')
      expect(log.scrollTop).toBe(0)
      await app.press('ask-near-15')
      const view = log.getBoundingClientRect()
      const row = app.byId('row-15').getBoundingClientRect()
      console.log('platform near:', JSON.stringify({ scrollTop: log.scrollTop, view, row }))
      expect(log.scrollTop).toBeGreaterThan(0)
      // `block: 'center'`, the helper's default: the row's middle is the area's.
      expect(Math.abs(row.y + row.height / 2 - (view.y + view.height / 2))).toBeLessThanOrEqual(1)
      expect(app.model().done).toEqual(['near-1', 'near-15'])
    } finally {
      app.close()
    }
  })

  test('ResizeObserver sees GPUI\'s layout; detectElementMovement resolves when a scroll moves the element', async () => {
    const app = await open('resize')
    try {
      const sizes: Array<number> = []
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) sizes.push(entry.borderBoxSize[0]!.inlineSize)
      })
      observer.observe(app.byId('grower') as never)
      await app.settle()
      await app.press('grow')
      await app.settle()
      observer.disconnect()
      console.log('platform ResizeObserver:', JSON.stringify(sizes))
      // GPUI sizes boxes border-box (its width holds padding and border, as
      // with Tailwind's preflight): this is what it painted.
      expect(sizes).toEqual([100, 200])

      await app.press('ask-move')
      expect(app.model().done).toEqual([])
      const log = app.byId('log').getBoundingClientRect()
      app.renderer.nativeSimulateScrollWheel(log.x + 20, log.y + 20, 0, -30)
      await app.settle()
      await app.settle()
      expect(app.model().done).toEqual(['move'])
    } finally {
      app.close()
    }
  })

  test('waitForAnimationSettled waits for GPUI\'s motion to finish on its clock', async () => {
    const app = await open('settle')
    try {
      app.renderer.clockPause()
      await app.press('fade')
      await app.press('ask-settle')
      app.screenshot('fading')
      await app.settle()
      expect(app.model().done).toEqual([])
      app.renderer.clockFastForward(500)
      for (let i = 0; i < 4; i++) await app.settle()
      expect(app.model().done).toEqual(['settle'])
      app.renderer.clockResume()
    } finally {
      app.close()
    }
  })
})
