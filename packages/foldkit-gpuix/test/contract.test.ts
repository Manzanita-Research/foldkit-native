// The fake GPUI against real GPUI. Every headless adapter test trusts the
// fake (test/support/fake-gpui.ts, plus createFocusableFake's tab order), so
// this runs one app on both, gives both the same input, and compares what
// FoldKit's document sees: the native tree, the focus sequence, and scroll
// offsets. A difference here means the fake drifted and headless results
// stopped meaning anything. macOS only (gpuix's offscreen Metal renderer).
//
// What the real one does, written down (gpuix 0.10, Metal):
// - Tab stops: focusable elements with a tab index of 0 or more, tab index
//   0 first in tree order, then 1, 2… (browsers put positive ones first).
// - Scroll offsets are negative, null for an element GPUI doesn't scroll,
//   [0, 0] for one at rest, and clamped to the content.
// - A scroll area's own reported box moves by its own scroll offset; the
//   adapter undoes that, so getBoundingClientRect stays where it's drawn.
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import type { Update } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import type { Shape } from '../../../test/support/fake-gpui.ts'
import { METAL, mountHeadless, openMetal } from './support.ts'

const Model = Schema.Struct({ open: Schema.Boolean })
const Message = defineMessageUnion({ Opened: {}, Closed: {} })
type Model = typeof Model.Type
type Message = typeof Message.Type

const update = (_: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    Opened: () => ({ model: { open: true } }),
    Closed: () => ({ model: { open: false } }),
  })

const row = (h: HtmlBuilder<Message>, i: number) => h.div([h.Style({ height: '30px' })], [`row ${i}`])

/** Every kind of tab stop, a scroll area and a modal scope. */
const view = (model: Model, h: HtmlBuilder<Message>) =>
  h.div([h.Style({ display: 'flex', 'flex-direction': 'column', gap: '4px', padding: '8px' })], [
    h.button([h.Id('open'), h.OnClick(Message.Opened())], ['Open']),
    h.div([h.Id('second'), h.Tabindex(2)], ['tabindex 2']),
    h.div([h.Id('first'), h.Tabindex(1)], ['tabindex 1']),
    h.input([h.Id('name'), h.Placeholder('Name')]),
    h.input([h.Id('off'), h.Placeholder('Off'), h.Disabled(true)]),
    h.div([h.Id('skipped'), h.Tabindex(-1)], ['tabindex -1']),
    h.textarea([h.Id('notes')]),
    h.div([h.Id('log'), h.Tabindex(0), h.Style({ 'overflow-y': 'auto', height: '90px', 'flex-shrink': '0' })],
      Array.from({ length: 12 }, (_, i) => row(h, i))),
    h.a([h.Id('link'), h.Href('#')], ['A link']),
    ...(model.open
      ? [h.div([h.Id('dialog'), h.Role('dialog'), h.AriaModal(true)], [
        h.button([h.Id('cancel'), h.OnClick(Message.Closed())], ['Cancel']),
        h.button([h.Id('confirm')], ['Confirm']),
      ])]
      : []),
  ])

const start = async (container: HTMLElement) => {
  const { Runtime } = await import('foldkit')
  Runtime.run(Runtime.makeElement({
    Model, init: () => ({ model: { open: false } }), update, view, container,
  } as never))
}

const SIZE = { width: 420, height: 520 }
type Box = { x: number; y: number; width: number; height: number }

/** To the pixel: GPUI's layout has float noise (217.99… for 218). */
const round = ({ x, y, width, height }: Box): Box =>
  ({ x: Math.round(x) + 0, y: Math.round(y) + 0, width: Math.round(width) + 0, height: Math.round(height) + 0 })

type Json = { type: string; text?: string; children?: Array<Json> }
const shape = ({ type, text, children }: Json): Shape =>
  ({ type, ...(text === undefined ? {} : { text }), ...(children?.length ? { children: children.map(shape) } : {}) })

/** One side: the fake or real GPUI, behind the same interface. Each installs
 *  the global `document` FoldKit renders into, so only one is open at once. */
type Side = Awaited<ReturnType<typeof onFake>>
const common = (side: {
  document: ReturnType<typeof mountHeadless>['document']
  settle: () => Promise<void>
}) => ({
  byId: (id: string) => side.document.getElementById(id)!,
  active: () => {
    const element = side.document.activeElement
    return element === null ? null : element.getAttribute('id') ?? element.localName
  },
  focus: async (id: string) => {
    side.document.getElementById(id)!.focus()
    await side.settle()
  },
})
/** The fake, with real GPUI's layout copied in (it has none of its own). */
const onFake = async (layout: ReadonlyMap<number, Box> = new Map()) => {
  const app = mountHeadless({ viewport: SIZE })
  await start(app.container)
  await app.settle()
  for (const [id, box] of layout) if (app.host.nodeFor(id) !== undefined) app.gpui.setBounds(id, box)
  const renderer = app.fake.renderer
  return {
    ...common(app),
    app,
    tab: (shift = false) => app.press('tab', { shift }),
    press: (key: string) => app.press(key),
    gpuiFocus: () => {
      const element = app.gpuiFocus()
      return element === null ? null : element.getAttribute('id') ?? element.localName
    },
    offset: (id: number) => renderer.getScrollOffset?.(id) ?? null,
    rawBounds: (id: number) => renderer.getElementBounds?.(id) ?? null,
    tree: () => app.gpui.tree()!,
    retained: () => app.gpui.reachableCount(),
    layout: () => new Map<number, Box>(),
    close: () => app.close(),
  }
}
const onReal = async () => {
  const app = await openMetal('contract', SIZE)
  await start(app.container)
  await app.settle()
  return {
    ...common(app),
    app,
    tab: (shift = false) => app.keys(shift ? 'shift-tab' : 'tab'),
    press: (key: string) => app.press(key),
    gpuiFocus: () => {
      const element = app.gpuiFocus()
      return element === null ? null : element.getAttribute('id') ?? element.localName
    },
    offset: (id: number) => app.renderer.getScrollOffset(id),
    rawBounds: (id: number) => app.renderer.getElementBounds(id),
    tree: () => shape(app.renderer.toJSON() as unknown as Json),
    retained: () => app.renderer.getRetainedElementCount(),
    /** Every element's border box, as the document reads it. */
    layout: () => new Map(app.document.querySelectorAll('*').filter(element => element.nativeId !== 0)
      .map(element => [element.nativeId, element.getBoundingClientRect()] as const)),
    close: () => app.close(),
  }
}

/** Runs `script` on real GPUI, then on the fake (with real's layout), and
 *  returns both observations. */
const compare = async <T>(script: (side: Side) => Promise<T>) => {
  const real = await onReal()
  const layout = real.layout()
  let seenReal: T
  try {
    seenReal = await script(real as unknown as Side)
  } finally {
    real.close()
  }
  const fake = await onFake(layout)
  try {
    return { real: seenReal, fake: await script(fake) }
  } finally {
    fake.close()
  }
}

describe.skipIf(!METAL)('the fake GPUI agrees with real GPUI (Metal)', () => {
  test('the native tree, before and after a modal opens', async () => {
    const seen = await compare(async side => {
      const before = { tree: side.tree(), retained: side.retained() }
      await side.focus('open')
      await side.press('enter')
      return { before, after: { tree: side.tree(), retained: side.retained() }, dialog: side.byId('dialog') !== null }
    })
    expect(seen.real.dialog).toBe(true)
    expect(seen.fake).toEqual(seen.real)
  })

  test('the focus sequence: Tab, Shift-Tab, tab index order, a modal scope', async () => {
    const seen = await compare(async side => {
      const dom: Array<string | null> = []
      const gpui: Array<string | null> = []
      const record = () => {
        dom.push(side.active())
        gpui.push(side.gpuiFocus())
      }
      for (let i = 0; i < 9; i++) {
        await side.tab()
        record()
      }
      for (let i = 0; i < 4; i++) {
        await side.tab(true)
        record()
      }
      await side.focus('open')
      await side.press('enter')
      for (let i = 0; i < 3; i++) {
        await side.tab()
        record()
      }
      await side.tab(true)
      record()
      return { dom, gpui }
    })
    console.log('contract focus:', JSON.stringify(seen))
    expect(seen.real.dom).toEqual([
      'open', 'name', 'notes', 'log', 'link', 'first', 'second', 'open', 'name',
      'open', 'second', 'first', 'link',
      'cancel', 'confirm', 'cancel', 'confirm',
    ])
    expect(seen.real.gpui).toEqual(seen.real.dom)
    expect(seen.fake).toEqual(seen.real)
  })

  test('scroll offsets: scrollTop both ways, the keys, clamping, the area\'s box', async () => {
    const seen = await compare(async side => {
      const log = side.byId('log')
      const name = side.byId('name')
      const steps: Array<[string, number, unknown]> = []
      const step = async (label: string, act: () => Promise<void> | void) => {
        await act()
        await side.app.settle()
        steps.push([label, Math.round(log.scrollTop) + 0, side.offset(name.nativeId)])
      }
      const atRest = log.getBoundingClientRect()
      await step('at rest', () => {})
      await step('scrollTop = 60', () => {
        log.scrollTop = 60
      })
      await step('scrollTop = 10000 (past the end)', () => {
        log.scrollTop = 10000
      })
      await step('scrollTop = -50 (before the top)', () => {
        log.scrollTop = -50
      })
      await side.focus('log')
      await step('ArrowDown ×2', async () => {
        await side.press('down')
        await side.press('down')
      })
      await step('End', () => side.press('end'))
      await step('Home', () => side.press('home'))
      log.scrollTop = 100
      await side.app.settle()
      // gpuix moves the area's own reported box by its scroll; the
      // document's box stays where it's drawn.
      return { steps, raw: round(side.rawBounds(log.nativeId)!), box: round(log.getBoundingClientRect()), atRest: round(atRest) }
    })
    console.log('contract scroll:', JSON.stringify(seen))
    const end = 12 * 30 - 90
    expect(seen.real.steps.map(([, top]) => top)).toEqual([0, 60, end, 0, 80, end, 0])
    expect(seen.real.box).toEqual(seen.real.atRest)
    expect(seen.real.raw!.y).toBe(seen.real.atRest.y - 100)
    expect(seen.fake).toEqual(seen.real)
  })
})
