// FoldKit's platform Commands (`foldkit/dom`) on the native document, with no
// happy-dom: focus, scrollIntoView, advanceFocus, and a modal dialog's
// isolation (showDialog: the rest of the page inert while it's open, kept so
// as the page changes, then closeDialog: focus back). Headless on the fake,
// and on real GPUI where focus, layout and scrolling are GPUI's.
import { describe, expect, test } from 'bun:test'
import { Effect, Schema } from 'effect'
import { Command, Runtime } from 'foldkit'
import { Dom } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { METAL, mountHeadless, openMetal } from './support.ts'

const Message = defineMessageUnion({
  Asked: { what: Schema.String },
  Done: { what: Schema.String },
  Added: {},
})
type Message = typeof Message.Type
const Model = Schema.Struct({ done: Schema.Array(Schema.String), extra: Schema.Number })
type Model = typeof Model.Type

const run = (what: string, effect: Effect.Effect<unknown, unknown>) =>
  Command.define(`Dom ${what}`, { messages: [Message.Done], execute: effect.pipe(Effect.ignore, Effect.as(Message.Done({ what }))) })()
const commandFor = (what: string) => {
  switch (what) {
    case 'focus': return run(what, Dom.focus('#name'))
    case 'scroll': return run(what, Dom.scrollIntoView('#row-30'))
    case 'advance': return run(what, Dom.advanceFocus('#name', 'Next'))
    case 'open': return run(what, Dom.showDialog('#dialog', { isModal: true }))
    default: return run(what, Dom.closeDialog('#dialog'))
  }
}
const update = (model: Model, message: Message) =>
  Message.match(message, {
    Asked: ({ what }) => ({ model, commands: [commandFor(what)] }),
    Done: ({ what }) => ({ model: { ...model, done: [...model.done, what] } }),
    Added: () => ({ model: { ...model, extra: model.extra + 1 } }),
  })
const ask = (h: HtmlBuilder<Message>, what: string) => h.button([h.Id(`ask-${what}`), h.OnClick(Message.Asked({ what }))], [what])
const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.div([h.Style({ display: 'flex', 'flex-direction': 'column', gap: '4px', padding: '8px' })], [
    h.div([h.Style({ display: 'flex', 'flex-direction': 'row', gap: '4px' })], ['focus', 'scroll', 'advance', 'open'].map(what => ask(h, what))),
    h.input([h.Id('name'), h.Placeholder('Name')]),
    h.input([h.Id('email'), h.Placeholder('Email')]),
    h.div([h.Id('log'), h.Style({ 'overflow-y': 'auto', height: '90px', 'flex-shrink': '0' })],
      Array.from({ length: 40 }, (_, i) => h.div([h.Id(`row-${i}`), h.Style({ height: '24px' })], [`row ${i}`]))),
    ...Array.from({ length: model.extra }, (_, i) => h.button([h.Id(`extra-${i}`)], [`extra ${i}`])),
    h.dialog([h.Id('dialog')], [
      h.p([], ['A modal dialog']),
      h.button([h.Id('add'), h.OnClick(Message.Added())], ['add outside']),
      h.button([h.Id('close'), h.OnClick(Message.Asked({ what: 'close' }))], ['close']),
    ]),
  ])
const program = (container: HTMLElement) => Runtime.makeElement({
  Model, init: () => ({ model: { done: [], extra: 0 } }), update, view, container,
} as never)

const id = (element: { getAttribute: (name: string) => string | null } | null) => element?.getAttribute('id') ?? null

describe('foldkit/dom Commands on the native document', () => {
  test('headless: focus, advanceFocus, and a modal dialog\'s isolation as the page changes', async () => {
    const app = mountHeadless({ viewport: { width: 480, height: 400 } })
    app.own(Runtime.embed(program(app.container)))
    await app.settle()
    try {
      await app.click('focus')
      expect(id(app.document.activeElement)).toBe('name')
      expect(id(app.gpuiFocus())).toBe('name')
      await app.click('advance')
      expect(id(app.document.activeElement)).toBe('email')

      await app.click('open')
      const dialog = app.document.getElementById('dialog')!
      expect(dialog.hasAttribute('open')).toBe(true)
      // Focus moved in; everything outside is inert, so GPUI drops its tab stops.
      expect(dialog.contains(app.document.activeElement)).toBe(true)
      expect(app.document.getElementById('name')!.closest('[inert]')).not.toBeNull()
      expect(app.gpui.node(app.document.getElementById('name')!.nativeId).props['tabIndex']).toBe(-1)
      // The page changes while it's open: the new element is inert too
      // (FoldKit's MutationObserver).
      app.document.getElementById('add')!.click()
      await app.settle()
      await app.settle()
      expect(app.document.getElementById('extra-0')!.closest('[inert]')).not.toBeNull()
      // Close: inert gone, focus back where it was.
      app.document.getElementById('close')!.click()
      await app.settle()
      await app.settle()
      expect(dialog.hasAttribute('open')).toBe(false)
      expect(app.document.querySelector('[inert]')).toBeNull()
      expect(id(app.document.activeElement)).toBe('ask-open')
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!METAL)('foldkit/dom Commands on real GPUI (Metal)', () => {
  test('focus and advanceFocus move GPUI\'s focus; scrollIntoView scrolls; showDialog fills the window and traps Tab', async () => {
    const app = await openMetal('commands', { width: 480, height: 400 })
    app.own(Runtime.embed(program(app.container)))
    await app.settle()
    try {
      await app.click(app.document.getElementById('ask-focus')!)
      expect(id(app.gpuiFocus())).toBe('name')
      await app.keys('A d a')
      expect((app.document.getElementById('name') as unknown as { value: string }).value).toBe('Ada')
      await app.click(app.document.getElementById('ask-advance')!)
      expect(id(app.gpuiFocus())).toBe('email')

      await app.click(app.document.getElementById('ask-scroll')!)
      const log = app.document.getElementById('log')!
      const row = app.document.getElementById('row-30')!.getBoundingClientRect()
      const view = log.getBoundingClientRect()
      console.log('commands scroll:', JSON.stringify({ scrollTop: log.scrollTop, row, view }))
      expect(log.scrollTop).toBeGreaterThan(0)
      expect(row.y).toBeGreaterThanOrEqual(view.y - 1)
      expect(row.y + row.height).toBeLessThanOrEqual(view.y + view.height + 1)

      await app.click(app.document.getElementById('ask-open')!)
      const dialog = app.document.getElementById('dialog')!
      const box = dialog.getBoundingClientRect()
      console.log('commands dialog:', JSON.stringify({ box, active: id(app.document.activeElement), gpui: id(app.gpuiFocus()) }))
      // `position: fixed; inset: 0` from showDialog: the window.
      expect(box).toMatchObject({ x: 0, y: 0, width: 480, height: 400 })
      expect(dialog.contains(app.gpuiFocus())).toBe(true)
      const stops: Array<string | null> = []
      for (let i = 0; i < 3; i++) {
        await app.keys('tab')
        stops.push(id(app.gpuiFocus()))
      }
      console.log('commands dialog Tab:', stops.join(' → '))
      for (const stop of stops) expect(['add', 'close']).toContain(stop ?? '')
      app.screenshot('dialog')
      await app.click(app.document.getElementById('close')!)
      expect(dialog.hasAttribute('open')).toBe(false)
      expect(id(app.gpuiFocus())).toBe('ask-open')
    } finally {
      app.close()
    }
  })
})
