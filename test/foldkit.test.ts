// Interaction scripts: unmodified FoldKit apps (and an @foldkit/ui component)
// on the mirror. Drive native input, then assert the FoldKit model changed and
// the native tree still matches the DOM.
import { afterEach, describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { type Mounted, mountFake, runApp } from './support/mount.ts'

let mounted: Mounted
afterEach(() => mounted?.close())

const byText = (text: string) => {
  const found = Array.from(mounted.document.querySelectorAll('*')).filter(node => node.textContent === text).at(-1)
  if (found === undefined) throw new Error(`no element with text ${JSON.stringify(text)}`)
  return found
}
const click = async (node: Node) => {
  mounted.send(node, { eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
  await mounted.settle()
}
const nativeTexts = () => {
  const out: Array<string> = []
  const walk = (id: number) => {
    const node = mounted.gpui.node(id)
    if (node.text !== undefined) out.push(node.text)
    node.children.forEach(walk)
  }
  walk(mounted.idOf(mounted.document.body))
  return out
}

describe('FoldKit apps', () => {
  test('counter: a double click on +1 counts twice, and OnDoubleClick fires once', async () => {
    mounted = mountFake()
    const Message = defineMessageUnion({ ClickedIncrement: {}, DoubleClickedCount: {} })
    type Message = typeof Message.Type
    type Model = { count: number; doubles: number }
    const app = await runApp(mounted, {
      Model: Schema.Struct({ count: Schema.Number, doubles: Schema.Number }),
      init: () => ({ model: { count: 0, doubles: 0 } }),
      update: (model: Model, message: Message) =>
        Message.match(message, {
          ClickedIncrement: () => ({ model: { ...model, count: model.count + 1 } }),
          DoubleClickedCount: () => ({ model: { ...model, doubles: model.doubles + 1 } }),
        }),
      view: (model: Model, h: any) => h.div([], [
        h.p([h.OnDoubleClick(Message.DoubleClickedCount())], [`Count: ${model.count}`]),
        h.button([h.OnClick(Message.ClickedIncrement())], ['+1']),
      ]),
    })
    // What GPUI sends for a double click: two releases, counted 1 then 2.
    for (const clickCount of [1, 2]) {
      mounted.send(byText('+1'), { eventType: 'click', x: 1, y: 1, button: 0, clickCount })
      await mounted.settle()
    }
    expect(app.model().count).toBe(2)
    for (const clickCount of [1, 2]) {
      mounted.send(byText('Count: 2'), { eventType: 'click', x: 1, y: 1, button: 0, clickCount })
      await mounted.settle()
    }
    expect(app.model().doubles).toBe(1)
  })

  test('counter: clicks run update, the model and the native text follow', async () => {
    mounted = mountFake()
    const Message = defineMessageUnion({ ClickedIncrement: {}, ClickedReset: {} })
    type Message = typeof Message.Type
    const app = await runApp(mounted, {
      Model: Schema.Struct({ count: Schema.Number }),
      init: () => ({ model: { count: 0 } }),
      update: (model: { count: number }, message: Message) =>
        Message.match(message, {
          ClickedIncrement: () => ({ model: { count: model.count + 1 } }),
          ClickedReset: () => ({ model: { count: 0 } }),
        }),
      view: (model: { count: number }, h: any) => h.div([], [
        h.p([], [`Count: ${model.count}`]),
        h.button([h.OnClick(Message.ClickedIncrement())], ['+1']),
        h.button([h.OnClick(Message.ClickedReset())], ['Reset']),
      ]),
    })
    expect(nativeTexts()).toContain('Count: 0')
    for (let i = 0; i < 3; i++) await click(byText('+1'))
    expect(app.model().count).toBe(3)
    expect(nativeTexts()).toContain('Count: 3')
    await click(byText('Reset'))
    expect(app.model().count).toBe(0)
    expect(mounted.inSync()).toBe(true)
  })

  test('text input: a native change becomes OnInput', async () => {
    mounted = mountFake()
    const Message = defineMessageUnion({ ChangedQuery: { value: Schema.String } })
    type Message = typeof Message.Type
    const app = await runApp(mounted, {
      Model: Schema.Struct({ query: Schema.String }),
      init: () => ({ model: { query: '' } }),
      update: (_: { query: string }, message: Message) => ({ model: { query: message.value } }),
      view: (model: { query: string }, h: any) => h.div([], [
        h.input([h.Value(model.query), h.OnInput((value: string) => Message.ChangedQuery({ value }))]),
        h.p([], [`Searching for ${model.query || 'nothing'}`]),
      ]),
    })
    mounted.send(mounted.document.querySelector('input')!, { eventType: 'change', value: 'gpui' } as never)
    await mounted.settle()
    expect(app.model().query).toBe('gpui')
    expect(nativeTexts()).toContain('Searching for gpui')
  })

  test('keyboard: arrow keys move a selection', async () => {
    mounted = mountFake()
    const Message = defineMessageUnion({ PressedKey: { key: Schema.String } })
    type Message = typeof Message.Type
    const items = ['a', 'b', 'c']
    const app = await runApp(mounted, {
      Model: Schema.Struct({ selected: Schema.Number }),
      init: () => ({ model: { selected: 0 } }),
      update: (model: { selected: number }, { key }: Message) => ({
        model: { selected: Math.max(0, Math.min(items.length - 1, model.selected + (key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0))) },
      }),
      view: (model: { selected: number }, h: any) =>
        h.ul([h.Tabindex(0), h.OnKeyDown((key: string) => Message.PressedKey({ key }))],
          items.map((item, i) => h.li(i === model.selected ? [h.DataAttribute('selected', '')] : [], [item]))),
    })
    const list = mounted.document.querySelector('ul')!
    for (const key of ['down', 'down', 'down', 'up']) {
      mounted.send(list, { eventType: 'keyDown', key })
      await mounted.settle()
    }
    expect(app.model().selected).toBe(1)
    expect(mounted.document.querySelector('[data-selected]')!.textContent).toBe('b')
  })

  test('keyed list: reversing reuses the native elements', async () => {
    mounted = mountFake()
    const Message = defineMessageUnion({ ClickedReverse: {} })
    type Message = typeof Message.Type
    await runApp(mounted, {
      Model: Schema.Struct({ items: Schema.Array(Schema.String) }),
      init: () => ({ model: { items: ['one', 'two', 'three', 'four'] } }),
      update: (model: { items: ReadonlyArray<string> }, _: Message) => ({ model: { items: [...model.items].reverse() } }),
      view: (model: { items: ReadonlyArray<string> }, h: any) => h.div([], [
        h.button([h.OnClick(Message.ClickedReverse())], ['Reverse']),
        h.ul([], model.items.map(item => h.li([h.Key(item)], [item]))),
      ]),
    })
    const idsByLabel = () => new Map(Array.from(mounted.document.querySelectorAll('li')).map(li => [li.textContent, mounted.idOf(li)]))
    const before = idsByLabel()
    await click(byText('Reverse'))
    const ul = mounted.document.querySelector('ul')!
    expect(mounted.nativeOf(ul).children.map(id => mounted.gpui.node(mounted.gpui.node(id).children[0]!).text))
      .toEqual(['four', 'three', 'two', 'one'])
    expect(idsByLabel()).toEqual(before)
    expect(mounted.inSync()).toBe(true)
    expect(mounted.gpui.retainedCount()).toBe(mounted.gpui.reachableCount())
  })

  test('drag and drop: OnDragStart/OnDrop move a card between columns', async () => {
    mounted = mountFake()
    const Message = defineMessageUnion({ GrabbedCard: { card: Schema.String }, DroppedOn: { column: Schema.String } })
    type Message = typeof Message.Type
    type Model = { columns: Readonly<Record<string, ReadonlyArray<string>>>; dragging: string }
    const app = await runApp(mounted, {
      Model: Schema.Struct({ columns: Schema.Record(Schema.String, Schema.Array(Schema.String)), dragging: Schema.String }),
      init: () => ({ model: { columns: { todo: ['write tests'], done: [] }, dragging: '' } }),
      update: (model: Model, message: Message) =>
        Message.match(message, {
          GrabbedCard: ({ card }) => ({ model: { ...model, dragging: card } }),
          DroppedOn: ({ column }) => ({
            model: {
              dragging: '',
              columns: Object.fromEntries(Object.entries(model.columns).map(([name, cards]) => [name,
                name === column ? [...cards.filter(card => card !== model.dragging), model.dragging] : cards.filter(card => card !== model.dragging)])),
            },
          }),
        }),
      view: (model: Model, h: any) => h.div([], Object.entries(model.columns).map(([name, cards]) =>
        h.section([h.Id(name), h.AllowDrop(), h.OnDrop(Message.DroppedOn({ column: name }))], [
          h.h2([], [name]),
          ...cards.map(card => h.div([h.Draggable(true), h.OnDragStart(Message.GrabbedCard({ card }))], [card])),
        ]))),
    })
    const card = byText('write tests')
    const done = mounted.document.getElementById('done')!
    mounted.gpui.setBounds(mounted.idOf(done), { x: 200, y: 0, width: 200, height: 300 })
    mounted.send(card, { eventType: 'mouseDown', x: 20, y: 40, button: 0 })
    mounted.send(card, { eventType: 'mouseMove', x: 120, y: 40, pressedButton: 0 })
    mounted.send(card, { eventType: 'mouseMove', x: 250, y: 40, pressedButton: 0 })
    mounted.send(card, { eventType: 'mouseUp', x: 250, y: 40, button: 0 })
    await mounted.settle()
    expect(app.model().columns).toEqual({ todo: [], done: ['write tests'] })
    expect(mounted.inSync()).toBe(true)
  })
})

describe('@foldkit/ui', () => {
  test('Disclosure toggles by click and by Enter; aria-expanded reaches GPUI', async () => {
    mounted = mountFake()
    const Disclosure = await import('@foldkit/ui/disclosure')
    const Message = defineMessageUnion({ Toggled: { isOpen: Schema.Boolean } })
    type Message = typeof Message.Type
    const app = await runApp(mounted, {
      Model: Schema.Struct({ isOpen: Schema.Boolean }),
      init: () => ({ model: { isOpen: false } }),
      update: (_: { isOpen: boolean }, message: Message) => ({ model: { isOpen: message.isOpen } }),
      view: (model: { isOpen: boolean }, h: any) => Disclosure.view({
        id: 'details',
        isOpen: model.isOpen,
        onToggle: (isOpen: boolean) => Message.Toggled({ isOpen }),
        toView: ({ button, panel }) => h.div([], [h.button(button, ['Details']), ...(model.isOpen ? [h.div(panel, ['The details'])] : [])]),
      }, h),
    })
    const button = () => mounted.document.getElementById('details-button')!
    expect(mounted.nativeOf(button()).props).toMatchObject({ 'aria-expanded': 'false', tabIndex: 0 })
    await click(button())
    expect(app.model().isOpen).toBe(true)
    expect(nativeTexts()).toContain('The details')
    expect(mounted.nativeOf(button()).props['aria-expanded']).toBe('true')
    mounted.send(button(), { eventType: 'keyDown', key: 'enter' })
    await mounted.settle()
    expect(app.model().isOpen).toBe(false)
    expect(nativeTexts()).not.toContain('The details')
    expect(mounted.inSync()).toBe(true)
  })
})
