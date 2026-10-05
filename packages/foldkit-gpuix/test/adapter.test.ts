// FoldKit on gpuix, headless: unmodified FoldKit apps render straight into a
// gpuix tree (the repo's fake GPUI, with GPUI's focus order added), and
// GPUI's input comes back as DOM events. No happy-dom anywhere in these.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Option, Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { NativeElement, PASSWORD_UNSUPPORTED, sheetFromCss } from '../src/index.ts'
import { type Headless, mountHeadless } from './support.ts'

let app: Headless | undefined
afterEach(() => {
  app?.close()
  app = undefined
})

/** Runs a FoldKit app on the adapter; `model()` is the latest it rendered. */
const run = async <M, Msg>(
  options: Parameters<typeof mountHeadless>[0],
  config: { Model: Schema.Codec<M, any>; init: M; update: (model: M, message: Msg) => M; view: (model: M, h: any) => unknown },
) => {
  app = mountHeadless(options)
  const { Runtime } = await import('foldkit')
  let latest = config.init
  Runtime.run(Runtime.makeElement({
    Model: config.Model,
    init: () => ({ model: config.init }),
    update: (model: M, message: Msg) => ({ model: config.update(model, message) }),
    view: (model: M, h: any) => {
      latest = model
      return config.view(model, h)
    },
    container: app.container,
  } as never))
  await app.settle()
  return { app, model: () => latest }
}

const Counter = {
  Model: Schema.Struct({ count: Schema.Number }),
  Message: defineMessageUnion({ Clicked: {} }),
}

describe('tree', () => {
  test('a FoldKit view becomes gpuix elements, and a click updates the model', async () => {
    const { app, model } = await run({}, {
      Model: Counter.Model,
      init: { count: 0 },
      update: current => ({ count: current.count + 1 }),
      view: (current, h) => h.div([], [h.p([], [`Count: ${current.count}`]), h.button([h.OnClick(Counter.Message.Clicked())], ['+1'])]),
    })
    expect(app.texts()).toEqual(['Count: 0', '+1'])
    expect(app.native('+1').type).toBe('div')
    expect(app.native('+1').props['role']).toBe('button')
    await app.click('+1')
    await app.click('+1')
    expect(model().count).toBe(2)
    expect(app.texts()).toEqual(['Count: 2', '+1'])
    // Nothing alive off the tree.
    expect(app.gpui.retainedCount()).toBe(app.gpui.reachableCount())
  })

  test('a keyed reorder moves the same native elements (no re-create)', async () => {
    const List = Schema.Struct({ items: Schema.Array(Schema.String) })
    const { app } = await run({}, {
      Model: List,
      init: { items: ['a', 'b', 'c', 'd'] },
      update: current => ({ items: [...current.items].reverse() }),
      view: (current, h) => h.div([], [
        h.button([h.OnClick(Counter.Message.Clicked())], ['reverse']),
        h.ul([], current.items.map(item => h.keyed('li')(item, [], [item]))),
      ]),
    })
    const before = new Map(['a', 'b', 'c', 'd'].map(item => [item, app.find(item).nativeId]))
    await app.click('reverse')
    expect(app.texts()).toEqual(['reverse', 'd', 'c', 'b', 'a'])
    for (const [item, id] of before) expect(app.find(item).nativeId).toBe(id)
    expect(app.gpui.retainedCount()).toBe(app.gpui.reachableCount())
  })

  test('an input is GPUI\'s editor: typing reaches the model, the model reaches GPUI', async () => {
    const Field = Schema.Struct({ value: Schema.String })
    const Message = defineMessageUnion({ Typed: { value: Schema.String } })
    const { app, model } = await run({}, {
      Model: Field,
      init: { value: '' },
      update: (_, message: typeof Message.Type) => ({ value: message.value.toUpperCase() }),
      view: (current, h) => h.input([h.Placeholder('Name'), h.Value(current.value), h.OnInput((value: string) => Message.Typed({ value }))]),
    })
    expect(app.native('Name').type).toBe('input')
    await app.type('Name', 'ada')
    expect(model().value).toBe('ADA')
    // The model's value (upper-cased) goes back to GPUI's field.
    expect(app.native('Name').props['value']).toBe('ADA')
  })
})

describe('styles: a sheet with no cascade engine', () => {
  const css = `
    :root { --fn-color-accent: #3d6df2; }
    .app { display: flex; flex-direction: column; gap: 8px; color: #222222; font-size: 15px; }
    .button { padding: 6px 10px; border-radius: 6px; background-color: var(--fn-color-accent); }
    .button:hover { background-color: #2f5ee0; }
    .button[data-on] { border: 2px solid #000000; }
    .card .title { color: red; }
    .card + .title { color: red; }
  `
  const view = (h: any, on = false) => h.div([h.Class('app')], [
    h.button([h.Class('button'), ...(on ? [h.DataAttribute('on', '')] : []), h.OnClick(Counter.Message.Clicked())], ['Go']),
  ])

  test('rules apply; :hover is GPUI\'s own state; text inherits', async () => {
    const { app } = await run({ css }, { Model: Counter.Model, init: { count: 0 }, update: c => c, view: (_, h) => view(h) })
    const button = app.gpui.node(app.find('Go').nativeId)
    expect(button.style).toMatchObject({ paddingTop: 6, paddingLeft: 10, borderTopLeftRadius: 6, backgroundColor: '#3d6df2' })
    expect(button.style['hover']).toEqual({ backgroundColor: '#2f5ee0' })
    // The text node carries the inherited colour and size (GPUI text doesn't inherit).
    const text = app.gpui.node(app.gpui.node(app.find('Go').nativeId).children[0]!)
    expect(text.style).toMatchObject({ color: '#222222', fontSize: 15 })
    // What it can't do, it says, rather than guessing.
    expect(app.unsupported).toEqual(['.card + .title (sibling combinator)'])
  })

  test('a state attribute restyles; new tokens restyle everything live', async () => {
    const { app } = await run({ css }, {
      Model: Counter.Model, init: { count: 0 }, update: c => ({ count: c.count + 1 }), view: (c, h) => view(h, c.count > 0),
    })
    await app.click('Go')
    expect(app.gpui.node(app.find('Go').nativeId).style).toMatchObject({ borderTopWidth: 2, borderColor: '#000000' })
    app.setTokens({ 'color.accent': '#e5484d' })
    await app.settle()
    expect(app.gpui.node(app.find('Go').nativeId).style['backgroundColor']).toBe('#e5484d')
  })

  test('sheetFromCss reports what a restyle can\'t follow', () => {
    const sheet = sheetFromCss(`
      .a { color: red } .a:hover { color: blue } .b > .c { color: red } .d + .e { color: red }
      .f::before { content: "" } @media (min-width: 640px) { .g { color: red } } @media print { .h { color: red } }
      .group:hover .i { color: red } li:last-child { color: red } @media (scripting: none) { .j { color: red } }
    `)
    expect(sheet.rules.map(rule => rule.source)).toEqual(['.a', '.a:hover', '.b > .c', '.g', '.h'])
    expect(sheet.rules.find(rule => rule.source === '.g')?.media).toEqual(['(min-width: 640px)'])
    expect(sheet.unsupported).toEqual([
      '.d + .e (sibling combinator)', '.f::before (pseudo-element)', '.group:hover .i (state on an ancestor)',
      'li:last-child (structural pseudo-class)', '@media (scripting: none) (media query)',
    ])
  })
})

describe('fixes from the first real-GPUI run', () => {
  test('an attribute that goes away is cleared in GPUI, and an unchanged one isn\'t resent', async () => {
    const { app } = await run({}, {
      Model: Counter.Model, init: { count: 0 }, update: c => ({ count: c.count + 1 }),
      view: (c, h) => h.div([], [
        h.button([h.OnClick(Counter.Message.Clicked())], ['next']),
        h.input([h.Id('field'), ...(c.count === 0 ? [h.AriaLabel('Search'), h.Placeholder('Type…'), h.Readonly(true)] : [h.Disabled(true)])]),
        h.div([h.Id('stop'), ...(c.count === 0 ? [h.Tabindex(0)] : [])], ['stop']),
      ]),
    })
    const field = () => app.gpui.node(app.document.getElementById('field')!.nativeId).props
    expect(field()).toMatchObject({ 'aria-label': 'Search', placeholder: 'Type…', readOnly: true, tabIndex: 0 })
    const before = app.gpui.ops().length
    await app.click('next')
    expect(field()['aria-label']).toBe(null)
    expect(field()['placeholder']).toBe(null)
    // Disabled: out of the tab order (GPUI's editors are tab stops unless
    // told -1; on Metal, Tab reached a disabled field), and read-only.
    expect(field()['tabIndex']).toBe(-1)
    expect(field()['readOnly']).toBe(true)
    expect(app.gpui.node(app.document.getElementById('stop')!.nativeId).props['tabIndex']).toBe(null)
    expect(app.gpui.ops().length - before).toBeLessThan(40)
  })

  test('a password field throws as it\'s mounted, naming the gap, before any of it reaches GPUI', async () => {
    app = mountHeadless()
    const { document } = app
    const container = app.container as unknown as NativeElement
    const form = document.createElement('div')
    const secret = document.createElement('input')
    secret.setAttribute('type', 'password')
    secret.value = 'hunter2'
    form.append(secret)
    await app.settle()
    const ops = app.gpui.ops().length
    expect(() => container.append(form)).toThrow(PASSWORD_UNSUPPORTED)
    expect(PASSWORD_UNSUPPORTED).toContain('<input type="password">')
    expect(PASSWORD_UNSUPPORTED).toContain('no masked input')
    // Refused before the document changed: nothing inserted, nothing drawn.
    expect(form.parentNode).toBe(null)
    await app.settle()
    expect(app.gpui.ops().slice(ops).filter(op => op[0] === 'createElement')).toEqual([])
    expect(JSON.stringify(app.gpui.batches)).not.toContain('hunter2')
    // A mounted field turned into one throws too.
    const plain = document.createElement('input')
    container.append(plain)
    await app.settle()
    expect(() => plain.setAttribute('type', 'password')).toThrow(PASSWORD_UNSUPPORTED)
    expect(plain.getAttribute('type')).toBe(null)
    // Off the document, it's only a DOM: nothing to draw, nothing to refuse.
    expect(() => document.createElement('input').setAttribute('type', 'password')).not.toThrow()
  })

  test('a FoldKit view that adds a password field crashes with that message', async () => {
    app = mountHeadless()
    const { Runtime } = await import('foldkit')
    const reported: Array<string> = []
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    try {
      Runtime.run(Runtime.makeElement({
        Model: Counter.Model, init: () => ({ model: { count: 0 } }), update: (c: { count: number }) => ({ model: { count: c.count + 1 } }),
        view: (c: { count: number }, h: any) => h.div([], [
          h.button([h.OnClick(Counter.Message.Clicked())], ['Sign in']),
          ...(c.count > 0 ? [h.input([h.Id('secret'), h.Type('password')])] : []),
        ]),
        container: app.container,
        crash: {
          view: ({ error }: { error: Error }, h: any) => h.p([h.Id('crashed')], [error.message]),
          report: ({ error }: { error: Error }) => reported.push(error.message),
        },
      } as never))
      await app.settle()
      await app.click('Sign in')
    } finally {
      quiet.mockRestore()
    }
    expect(reported).toEqual([PASSWORD_UNSUPPORTED])
    expect(app.texts()).toEqual([PASSWORD_UNSUPPORTED])
  })

  test('in the first render, FoldKit reports the crash (its crash view can\'t draw: FoldKit has detached the container by then)', async () => {
    app = mountHeadless()
    const { Runtime } = await import('foldkit')
    const reported: Array<string> = []
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    try {
      Runtime.run(Runtime.makeElement({
        Model: Counter.Model, init: () => ({ model: { count: 0 } }), update: (c: never) => ({ model: c }),
        view: (_: never, h: any) => h.div([], [h.input([h.Id('secret'), h.Type('password')])]),
        container: app.container,
        crash: { view: (_: never, h: any) => h.p([], ['crashed']), report: ({ error }: { error: Error }) => reported.push(error.message) },
      } as never))
      await app.settle()
    } finally {
      quiet.mockRestore()
    }
    expect(reported).toEqual([PASSWORD_UNSUPPORTED])
    expect(app.document.getElementById('secret')).toBe(null)
  })

  test('disabling the focused element moves focus off it', async () => {
    const { app } = await run({}, {
      Model: Counter.Model, init: { count: 0 }, update: c => ({ count: c.count + 1 }),
      view: (c, h) => h.button([h.Id('go'), h.Disabled(c.count > 0), h.OnClick(Counter.Message.Clicked())], ['Go']),
    })
    app.document.getElementById('go')!.focus()
    await app.press('enter')
    expect(app.document.activeElement).toBe(app.document.body)
  })

  describe('Tab in a field (GPUI\'s editor types it, a browser never does)', () => {
    const Message = defineMessageUnion({ Typed: { value: Schema.String } })
    const field = (init: string) => run({}, {
      Model: Schema.Struct({ value: Schema.String, seen: Schema.Array(Schema.String) }), init: { value: init, seen: [] },
      update: (c, m: typeof Message.Type) => ({ value: m.value, seen: [...c.seen, m.value] }),
      view: (c, h) => h.div([], [
        h.input([h.Id('name'), h.Placeholder('Name'), h.Value(c.value), h.OnInput((value: string) => Message.Typed({ value }))]),
        h.input([h.Id('next'), h.Placeholder('Next')]),
      ]),
    })
    const tabAnd = async (app: Headless, change: string, order: 'change first' | 'key first', shift = false) => {
      const id = app.document.getElementById('name')!.nativeId
      const keyDown = { eventType: 'windowKeyDown', elementId: 1, key: 'tab', modifiers: { shift } } as never
      const changed = { eventType: 'change', elementId: id, value: change } as never
      if (order === 'key first') app.host.dispatch(keyDown)
      app.host.dispatch(changed)
      if (order === 'change first') app.host.dispatch(keyDown)
      app.host.dispatch({ eventType: 'windowKeyUp', elementId: 1, key: 'tab', modifiers: { shift } } as never)
      await app.settle()
    }

    for (const order of ['change first', 'key first'] as const) {
      test(`the tab is dropped and never reaches FoldKit (${order})`, async () => {
        const { app, model } = await field('Ada')
        app.document.getElementById('name')!.focus()
        await tabAnd(app, 'Ada\t', order)
        expect(model().value).toBe('Ada')
        expect(model().seen).toEqual([])
        expect(app.native('Name').props['value']).toBe('Ada')
        expect(app.document.activeElement?.getAttribute('id')).toBe('next')
      })
    }

    test('two tabs (GPUI typed one per key event) are dropped too', async () => {
      const { app, model } = await field('')
      app.document.getElementById('name')!.focus()
      await tabAnd(app, '\t\t', 'key first')
      expect(model().seen).toEqual([])
      expect(app.native('Name').props['value']).toBe('')
    })

    test('Shift-Tab: dropped the same way, focus goes back', async () => {
      const { app, model } = await field('Ada')
      app.document.getElementById('name')!.focus()
      await tabAnd(app, 'A\tda', 'change first', true)
      expect(model().seen).toEqual([])
      expect(app.document.activeElement?.getAttribute('id')).toBe('next')
    })

    test('a pasted tab, with no Tab key, goes through (a task late)', async () => {
      const { app, model } = await field('Ada')
      await app.type('Name', 'Ada\t')
      expect(model().value).toBe('Ada\t')
      await app.type('Name', 'Ada\tL')
      expect(model().value).toBe('Ada\tL')
    })

    test('typing after the dropped tab lands on the value FoldKit has', async () => {
      const { app, model } = await field('')
      app.document.getElementById('name')!.focus()
      await tabAnd(app, '\t', 'change first')
      // The value prop was already "" when the tab came: gpuix needs a
      // different prop first (a zero-width space after it), then "".
      expect(app.native('Name').props['value']).toBe('')
      expect(app.gpui.batches.flat().some(op => op[0] === 'setCustomProp' && op[3] === '\u200b')).toBe(true)
      await app.type('Name', 'x')
      expect(model().value).toBe('x')
    })
  })

  describe('controlled values reach GPUI\'s editor', () => {
    const Message = defineMessageUnion({ Typed: { value: Schema.String } })
    const upper = (limit: number) => run({}, {
      Model: Schema.Struct({ value: Schema.String }), init: { value: '' },
      // Keeps at most `limit` characters: the rest of a keystroke is refused.
      update: (_, m: typeof Message.Type) => ({ value: m.value.slice(0, limit) }),
      view: (c, h) => h.input([h.Placeholder('Code'), h.Value(c.value), h.OnInput((value: string) => Message.Typed({ value }))]),
    })

    test('a keystroke the model refuses comes back out of the editor', async () => {
      const { app, model } = await upper(2)
      await app.type('Code', 'ab')
      await app.type('Code', 'abc')
      expect(model().value).toBe('ab')
      // "ab" was never sent as a prop (the editor reported it), so it's sent.
      expect(app.native('Code').props['value']).toBe('ab')
    })

    test('refused back to the last prop: nudged, then set', async () => {
      const { app, model } = await upper(0)
      await app.type('Code', 'x')
      expect(model().value).toBe('')
      expect(app.native('Code').props['value']).toBe('')
    })

    test('typed while a nudge waits for a frame: the space is taken out', async () => {
      const { app, model } = await upper(0)
      const id = app.document.querySelector('input')!.nativeId
      app.host.dispatch({ eventType: 'change', elementId: id, value: 'x' } as never)
      app.host.flush()
      // GPUI drew "\u200b" and the person typed before the next frame.
      app.host.dispatch({ eventType: 'change', elementId: id, value: '\u200by' } as never)
      await app.settle()
      expect(model().value).toBe('')
      expect(app.native('Code').props['value']).toBe('')
      expect(app.gpui.batches.flat().filter(op => op[0] === 'setCustomProp' && op[2] === 'value').map(op => op[3])).not.toContain('\u200by')
    })
  })

  test('several identical keys GPUI delivers in one task each count', async () => {
    const Message = defineMessageUnion({ Pressed: { key: Schema.String } })
    const { app, model } = await run({}, {
      Model: Schema.Struct({ downs: Schema.Number }), init: { downs: 0 },
      update: (c, _: typeof Message.Type) => ({ downs: c.downs + 1 }),
      view: (_, h) => h.div([h.Id('grid'), h.Tabindex(0),
        h.OnKeyDownPreventDefault((key: string) => key === 'ArrowDown' ? Option.some(Message.Pressed({ key })) : Option.none())], ['grid']),
    })
    app.document.getElementById('grid')!.focus()
    for (const _ of [1, 2, 3]) app.host.dispatch({ eventType: 'windowKeyDown', elementId: 1, key: 'down' } as never)
    await app.settle()
    expect(model().downs).toBe(3)
  })

  test('typing into a field GPUI focused by itself makes it the active element', async () => {
    const { app } = await run({}, {
      Model: Counter.Model, init: { count: 0 }, update: c => c,
      view: (_, h) => h.div([], [h.input([h.Id('a'), h.Placeholder('A')]), h.input([h.Id('b'), h.Placeholder('B')])]),
    })
    // GPUI took focus with no event; the typing is the first the DOM hears.
    app.fake.renderer.focusElement?.(app.document.getElementById('b')!.nativeId)
    await app.type('B', 'x')
    expect(app.document.activeElement?.getAttribute('id')).toBe('b')
  })

  test('a press GPUI handles itself (into a field) still moves the DOM\'s focus', async () => {
    const { app } = await run({}, {
      Model: Counter.Model, init: { count: 0 }, update: c => c,
      view: (_, h) => h.div([], [h.input([h.Id('a')]), h.input([h.Id('b')])]),
    })
    // GPUI focuses the field on press and says nothing, and its editor stops
    // the press. GPUI's capture-phase "mouse down outside" still reaches the
    // adapter's zero-size sentinel.
    app.fake.renderer.focusElement?.(app.document.getElementById('b')!.nativeId)
    const sentinel = app.gpui.node(app.document.body.nativeId).children.find(id => app.gpui.node(id).listeners.has('mouseDownOutside'))!
    app.host.dispatch({ eventType: 'mouseDownOutside', elementId: sentinel, x: 1, y: 1, button: 0 } as never)
    await app.settle()
    expect(app.document.activeElement?.getAttribute('id')).toBe('b')
  })

  test('the cascade: specificity, then source order, then inline, then !important', async () => {
    const css = `
      .a.b { color: #111111; }
      .b { color: #222222; padding: 4px; }
      .b { padding: 8px !important; }
      #x { color: #333333; }
      .c:hover { color: #444444; }
      .c[data-on] { color: #555555; }
    `
    const { app } = await run({ css }, {
      Model: Counter.Model, init: { count: 0 }, update: c => c,
      view: (_, h) => h.div([], [
        h.div([h.Class('a b'), h.Style({ padding: '2px' })], ['ab']),
        h.div([h.Class('b'), h.Id('x')], ['x']),
        h.div([h.Class('c'), h.DataAttribute('on', '')], ['c']),
      ]),
    })
    const text = (label: string) => app.gpui.node(app.gpui.node(app.find(label).nativeId).children[0]!).style['color']
    expect(text('ab')).toBe('#111111') // two classes beat one, wherever they are
    expect(app.native('ab').style['paddingTop']).toBe(8) // !important beats inline
    expect(text('x')).toBe('#333333') // an id beats classes
    // :hover counts as a class, so .c:hover and .c[data-on] weigh the same and
    // the later one wins even while hovered, as in CSS: no hover change.
    expect(app.native('c').style['hover']).toBeUndefined()
  })
})

describe('focus: GPUI owns it, the DOM follows', () => {
  const form = (h: any) => h.div([], [
    h.input([h.Id('first'), h.Placeholder('First')]),
    h.div([h.Id('skip')], ['not focusable']),
    h.input([h.Id('second'), h.Placeholder('Second')]),
    h.button([h.Id('go')], ['Go']),
    h.div([h.Id('custom'), h.Tabindex(0)], ['Custom stop']),
    h.button([h.Id('off'), h.Disabled(true)], ['Disabled']),
  ])
  const active = () => app!.document.activeElement?.getAttribute('id') ?? null

  test('fields, buttons and tabindex are GPUI tab stops, in view order', async () => {
    await run({}, { Model: Counter.Model, init: { count: 0 }, update: c => c, view: (_, h) => form(h) })
    const ids = app!.fake.tabOrder().map(id => app!.elementFor(id)?.getAttribute('id'))
    expect(ids).toEqual(['first', 'second', 'go', 'custom'])
  })

  test('Tab and Shift-Tab move GPUI focus, and document.activeElement follows', async () => {
    await run({}, { Model: Counter.Model, init: { count: 0 }, update: c => c, view: (_, h) => form(h) })
    const seen: Array<string | null> = []
    for (let i = 0; i < 5; i++) {
      await app!.press('tab')
      seen.push(active())
      expect(app!.gpuiFocus()).toBe(app!.document.activeElement)
    }
    expect(seen).toEqual(['first', 'second', 'go', 'custom', 'first'])
    await app!.press('tab', { shift: true })
    expect(active()).toBe('custom')
  })

  test('element.focus() moves GPUI focus; focus and blur events fire as in a browser', async () => {
    await run({}, { Model: Counter.Model, init: { count: 0 }, update: c => c, view: (_, h) => form(h) })
    const events: Array<string> = []
    for (const id of ['first', 'second']) {
      const element = app!.document.getElementById(id)!
      for (const type of ['focus', 'blur', 'focusin', 'focusout']) element.addEventListener(type, () => events.push(`${type}:${id}`))
    }
    app!.document.getElementById('first')!.focus()
    app!.document.getElementById('second')!.focus()
    expect(app!.gpuiFocus()?.getAttribute('id')).toBe('second')
    expect(events).toEqual(['focus:first', 'focusin:first', 'blur:first', 'focusout:first', 'focus:second', 'focusin:second'])
    // Not focusable: focus() does nothing, as in a browser.
    app!.document.getElementById('skip')!.focus()
    expect(active()).toBe('second')
  })

  test('a GPUI focus event (a click into a field) reaches the DOM', async () => {
    await run({}, { Model: Counter.Model, init: { count: 0 }, update: c => c, view: (_, h) => form(h) })
    app!.host.dispatch({ eventType: 'focus', elementId: app!.document.getElementById('second')!.nativeId } as never)
    expect(active()).toBe('second')
  })

  test(':focus-visible styles show for keyboard focus, not for a click', async () => {
    const css = `.stop { background-color: #111111; } .stop:focus-visible { box-shadow: 0 0 0 2px #3d6df2; }`
    await run({ css }, {
      Model: Counter.Model, init: { count: 0 }, update: c => c,
      view: (_, h) => h.div([], [h.button([h.Class('stop'), h.OnClick(Counter.Message.Clicked())], ['A'])]),
    })
    const ring = () => app!.gpui.node(app!.find('A').nativeId).style['boxShadow']
    await app!.click('A')
    expect(active()).toBe(null) // focused, but it has no id
    expect(app!.document.activeElement?.textContent).toBe('A')
    expect(ring()).toBeUndefined()
    await app!.press('tab')
    await app!.press('tab', { shift: true })
    expect(ring()).toMatchObject({ spreadRadius: 2, color: '#3d6df2' })
  })
})

describe('box shadows, which GPUI paints under the whole box', () => {
  test('a box with a shadow and no background gets the solid colour it sits on; a see-through one, nothing', async () => {
    const css = `.card { background-color: #fafafa; } .glass { background-color: rgba(0, 0, 0, 0.5); }
      .ring { box-shadow: 0 0 0 2px #3080ff; }`
    await run({ css }, {
      Model: Counter.Model, init: { count: 0 }, update: c => c,
      view: (_, h) => h.div([], [
        h.div([h.Class('card')], [h.div([], [h.div([h.Id('on-card'), h.Class('ring')], ['a'])])]),
        h.div([h.Class('glass')], [h.div([h.Id('on-glass'), h.Class('ring')], ['b'])]),
      ]),
    })
    const style = (id: string) => app!.gpui.node(app!.document.getElementById(id)!.nativeId).style
    expect(style('on-card')).toMatchObject({ backgroundColor: '#fafafa', boxShadow: { spreadRadius: 2 } })
    expect(style('on-glass')['backgroundColor']).toBeUndefined()
  })
})

describe(':focus-visible by input modality, as browsers judge it', () => {
  const twoButtons = (h: any) => h.div([], [
    h.button([h.Id('a'), h.OnClick(Counter.Message.Clicked())], ['A']),
    h.button([h.Id('b'), h.OnClick(Counter.Message.Clicked())], ['B']),
    h.input([h.Id('field')]),
  ])
  const visible = (id: string) => app!.document.getElementById(id)!.matches(':focus-visible')

  test('focus() before any input shows, as on a page that just loaded', async () => {
    await run({}, { Model: Counter.Model, init: { count: 0 }, update: c => c, view: (_, h) => twoButtons(h) })
    app!.document.getElementById('a')!.focus()
    expect(visible('a')).toBe(true)
  })

  test('a shortcut (cmd, ctrl or alt held) leaves the pointer\'s modality: focus() after it shows nothing', async () => {
    await run({}, { Model: Counter.Model, init: { count: 0 }, update: c => c, view: (_, h) => twoButtons(h) })
    await app!.click('A')
    app!.host.dispatch({ eventType: 'windowKeyDown', key: 'c', modifiers: { cmd: true }, elementId: 1 } as never)
    app!.document.getElementById('b')!.focus()
    expect(app!.document.activeElement?.getAttribute('id')).toBe('b')
    expect(visible('b')).toBe(false)
    expect(app!.document.getElementById('b')!.matches(':focus')).toBe(true)
    // A plain key does switch it.
    await app!.press('a')
    app!.document.getElementById('a')!.focus()
    expect(visible('a')).toBe(true)
  })

  test('a text field shows its focus however it was focused (it takes keys)', async () => {
    await run({}, { Model: Counter.Model, init: { count: 0 }, update: c => c, view: (_, h) => twoButtons(h) })
    await app!.click('A')
    expect(visible('a')).toBe(false)
    // A press into GPUI's editor: GPUI focuses it, then the press is seen.
    app!.fake.renderer.focusElement?.(app!.document.getElementById('field')!.nativeId)
    app!.host.dispatch({ eventType: 'focus', elementId: app!.document.getElementById('field')!.nativeId } as never)
    expect(app!.document.activeElement?.getAttribute('id')).toBe('field')
    expect(visible('field')).toBe(true)
  })
})

describe('keys and the browser\'s default actions', () => {
  test('a window keyup goes to the focused element and bubbles, with its modifiers; no element, the body', async () => {
    await run({}, {
      Model: Counter.Model, init: { count: 0 }, update: c => c,
      view: (_, h) => h.div([], [h.button([h.Id('go')], ['Go'])]),
    })
    const seen: Array<string> = []
    app!.document.addEventListener('keyup', event => {
      const key = event as KeyboardEvent
      seen.push(`${key.type} ${key.key} shift=${key.shiftKey} @${(key.target as Element).getAttribute('id') ?? (key.target as Element).localName}`)
    })
    app!.document.getElementById('go')!.focus()
    app!.host.dispatch({ eventType: 'windowKeyUp', key: 'a', modifiers: { shift: true }, elementId: 1 } as never)
    app!.document.getElementById('go')!.blur()
    app!.host.dispatch({ eventType: 'windowKeyUp', key: 'escape', elementId: 1 } as never)
    expect(seen).toEqual(['keyup a shift=true @go', 'keyup Escape shift=false @body'])
  })

  test('keys go to the focused element and bubble; Enter and Space click a button', async () => {
    const { model } = await run({}, {
      Model: Counter.Model, init: { count: 0 }, update: c => ({ count: c.count + 1 }),
      view: (_, h) => h.div([], [h.button([h.Id('go'), h.OnClick(Counter.Message.Clicked())], ['Go'])]),
    })
    const keys: Array<string> = []
    app!.document.body.addEventListener('keydown', event => keys.push(`${(event as KeyboardEvent).key}@${((event.target as Element).getAttribute('id'))}`))
    app!.document.getElementById('go')!.focus()
    await app!.press('enter')
    await app!.press('space')
    expect(model().count).toBe(2)
    expect(keys).toEqual(['Enter@go', ' @go'])
  })

  test('a keydown the app prevents has no default action (FoldKit\'s own key handling wins)', async () => {
    const Message = defineMessageUnion({ Pressed: { key: Schema.String } })
    await run({}, {
      Model: Schema.Struct({ keys: Schema.Array(Schema.String) }), init: { keys: [] as ReadonlyArray<string> },
      update: (c, m: typeof Message.Type) => ({ keys: [...c.keys, m.key] }),
      view: (_, h) => h.div([], [
        h.div([h.Id('grid'), h.Tabindex(0), h.OnKeyDownPreventDefault((key: string) => key === 'Tab' ? Option.some(Message.Pressed({ key })) : Option.none())], ['grid']),
        h.input([h.Id('after')]),
      ]),
    })
    app!.document.getElementById('grid')!.focus()
    await app!.press('tab')
    expect(app!.document.activeElement?.getAttribute('id')).toBe('grid')
  })

  test('a focused scroll area scrolls with the keys, in GPUI', async () => {
    await run({ css: '.list { height: 100px; overflow-y: auto; }' }, {
      Model: Counter.Model, init: { count: 0 }, update: c => c,
      view: (_, h) => h.div([h.Class('list'), h.Id('list'), h.Tabindex(0)], Array.from({ length: 40 }, (_, i) => h.p([], [`Row ${i}`]))),
    })
    const list = app!.document.getElementById('list')!
    // overflow: auto scrolls, as in a browser (GPUI only scrolls `scroll`).
    expect(app!.gpui.node(list.nativeId).style['overflowY']).toBe('scroll')
    list.focus()
    await app!.press('down')
    await app!.press('down')
    expect(list.scrollTop).toBe(80)
    await app!.press('end')
    expect(list.scrollTop).toBeGreaterThan(1000)
    await app!.press('home')
    expect(list.scrollTop).toBe(0)
  })
})

describe('modal scope: what showModal gives a browser dialog', () => {
  const Model = Schema.Struct({ open: Schema.Boolean })
  const Message = defineMessageUnion({ Opened: {}, Closed: {} })
  const view = (current: { open: boolean }, h: any) => h.div([], [
    h.button([h.Id('open'), h.OnClick(Message.Opened())], ['Open']),
    h.input([h.Id('behind')]),
    ...(current.open
      ? [h.div([h.Role('dialog'), h.AriaModal(true), h.Id('dialog'),
        h.OnKeyDownPreventDefault((key: string) => key === 'Escape' ? Option.some(Message.Closed()) : Option.none())], [
        h.button([h.Id('cancel'), h.Autofocus(true), h.OnClick(Message.Closed())], ['Cancel']),
        h.button([h.Id('ok')], ['OK']),
      ])]
      : []),
  ])
  const active = () => app!.document.activeElement?.getAttribute('id') ?? null

  test('autofocus on open, Tab stays inside, Escape closes, focus goes back', async () => {
    await run({}, { Model, init: { open: false }, update: (_, m: typeof Message.Type) => ({ open: m._tag === 'Opened' }), view })
    app!.document.getElementById('open')!.focus()
    await app!.press('enter')
    expect(active()).toBe('cancel')
    const seen: Array<string | null> = []
    for (let i = 0; i < 3; i++) {
      await app!.press('tab')
      seen.push(active())
    }
    expect(seen).toEqual(['ok', 'cancel', 'ok'])
    await app!.press('escape')
    expect(app!.document.getElementById('dialog')).toBe(null)
    expect(active()).toBe('open')
  })
})

describe('@foldkit/ui, unmodified, on the adapter', () => {
  test('its Switch toggles by click and by Space (keyup), with aria-checked', async () => {
    const Switch = await import('@foldkit/ui/switch')
    const Message = defineMessageUnion({ Toggled: { isChecked: Schema.Boolean } })
    const { model } = await run({}, {
      Model: Schema.Struct({ on: Schema.Boolean }), init: { on: false },
      update: (_, m: typeof Message.Type) => ({ on: m.isChecked }),
      view: (current, h) => Switch.view({
        id: 'wifi', isChecked: current.on, onToggle: isChecked => Message.Toggled({ isChecked }),
        toView: attributes => h.div([], [h.button([...attributes.button], ['switch']), h.span([...attributes.label], ['Wi-Fi'])]),
      }, h),
    })
    await app!.click('switch')
    expect(model().on).toBe(true)
    expect(app!.document.getElementById('wifi-label')).not.toBe(null)
    expect(app!.find('switch').getAttribute('aria-checked')).toBe('true')
    // It handles Space on keyup itself (and prevents it); the button's own
    // activation would toggle twice if both ran.
    app!.find('switch').focus()
    await app!.press('space')
    expect(model().on).toBe(false)
    expect(app!.native('switch').props['aria-valuetext']).toBe('off')
  })
})
