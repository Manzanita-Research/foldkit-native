// Disabled and read-only controls, as a browser has them: a disabled control
// leaves the tab order, can't be focused, hears no clicks and takes no edits;
// disabling the focused one moves focus off it; re-enabling it, in step with
// the model, gives all of that back. GPUI's editors apply an edit as they
// take it, so a field that mustn't change is read-only in GPUI itself, and an
// edit that raced the model is refused. One FoldKit app: a lock (Escape, from
// inside the form, or the Lock button) disables an input, a textarea and a
// button. Headless on the fake GPUI, then on real GPUI (Metal, offscreen).
import { afterEach, describe, expect, test } from 'bun:test'
import { Option, Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { NativeElement } from '../src/index.ts'
import { METAL, mountHeadless, openMetal } from './support.ts'

const Model = Schema.Struct({ locked: Schema.Boolean, saved: Schema.Number, name: Schema.String, notes: Schema.String })
type Model = typeof Model.Type
const Message = defineMessageUnion({ Toggled: {}, Saved: {}, Named: { value: Schema.String }, Noted: { value: Schema.String } })
type Message = typeof Message.Type
const init: Model = { locked: false, saved: 0, name: '', notes: '' }
const update = (model: Model, message: Message): Model =>
  Message.match<Model>(message, {
    Toggled: () => ({ ...model, locked: !model.locked }),
    Saved: () => ({ ...model, saved: model.saved + 1 }),
    Named: ({ value }) => ({ ...model, name: value }),
    Noted: ({ value }) => ({ ...model, notes: value }),
  })
const BUTTON = { padding: '4px 8px', border: '1px solid #888888' }
const view = (model: Model, h: any) => h.div([
  h.Style({ display: 'flex', 'flex-direction': 'column', gap: '8px', padding: '16px', 'background-color': '#ffffff', color: '#111111' }),
  h.OnKeyDownPreventDefault((key: string) => (key === 'Escape' ? Option.some(Message.Toggled()) : Option.none())),
], [
  h.input([h.Id('name'), h.Value(model.name), h.OnInput((value: string) => Message.Named({ value })), h.Disabled(model.locked),
    h.Style({ height: '28px', border: '1px solid #888888' })]),
  h.textarea([h.Id('notes'), h.Value(model.notes), h.OnInput((value: string) => Message.Noted({ value })), h.Disabled(model.locked),
    h.Style({ height: '56px', border: '1px solid #888888' })], []),
  h.button([h.Id('save'), h.OnClick(Message.Saved()), h.Disabled(model.locked), h.Style(BUTTON)], ['Save']),
  h.button([h.Id('lock'), h.OnClick(Message.Toggled()), h.Style(BUTTON)], [model.locked ? 'Unlock' : 'Lock']),
])

const start = async (container: unknown) => {
  const { Runtime } = await import('foldkit')
  let latest = init
  Runtime.run(Runtime.makeElement({
    Model, init: () => ({ model: init }),
    update: (model: Model, message: Message) => ({ model: update(model, message) }),
    view: (model: Model, h: any) => {
      latest = model
      return view(model, h)
    },
    container,
  } as never))
  return () => latest
}

const CONTROLS = ['name', 'notes', 'save'] as const
const css = `:disabled { opacity: 0.4; }`

describe('headless', () => {
  let app: ReturnType<typeof mountHeadless> | undefined
  afterEach(() => {
    app?.close()
    app = undefined
  })
  const open = async () => {
    app = mountHeadless({ css })
    const model = await start(app.container)
    await app.settle()
    const byId = (id: string) => app!.document.getElementById(id)!
    const props = (id: string) => app!.gpui.node(byId(id).nativeId).props
    const active = () => app!.document.activeElement?.getAttribute('id') ?? null
    /** Typing, as GPUI's editor reports it: the field's whole new value. */
    const type = async (id: string, value: string) => {
      app!.host.dispatch({ eventType: 'change', elementId: byId(id).nativeId, value } as never)
      await app!.settle()
    }
    return { app, model, byId, props, active, type }
  }

  for (const id of ['name', 'notes'] as const) {
    test(`${id}: disabled while focused, it stops taking edits and focus leaves it; re-enabled, it edits again`, async () => {
      const { app, model, byId, props, active, type } = await open()
      byId(id).focus()
      await type(id, 'ab')
      expect(active()).toBe(id)
      await app.press('escape')
      expect(model().locked).toBe(true)
      // Out of the tab order, read-only in GPUI, and focus left it (GPUI's too).
      expect(props(id)).toMatchObject({ readOnly: true, tabIndex: -1 })
      expect(app.gpui.node(byId(id).nativeId).style['opacity']).toBe(0.4)
      expect(active()).toBe(null)
      expect(app.gpuiFocus()).toBe(null)
      // An edit GPUI's editor took as the lock landed: refused, and the
      // editor gets the value back.
      await type(id, 'abc')
      expect(model()[id]).toBe('ab')
      expect((byId(id) as unknown as { value: string }).value).toBe('ab')
      expect(String(props(id)['value']).replace('​', '')).toBe('ab')
      // Re-enabled with the model: editable and a tab stop again.
      await app.click('Unlock')
      expect(props(id)['readOnly']).toBe(null)
      expect(props(id)['tabIndex']).toBe(0)
      byId(id).focus()
      expect(active()).toBe(id)
      await type(id, 'abc')
      expect(model()[id]).toBe('abc')
    })
  }

  test('button: disabled while focused, focus leaves; Enter, Space, clicks and click() do nothing; re-enabled, it saves', async () => {
    const { app, model, byId, active } = await open()
    byId('save').focus()
    await app.press('enter')
    expect(model().saved).toBe(1)
    await app.press('escape')
    expect(model().locked).toBe(true)
    expect(active()).toBe(null)
    await app.press('enter')
    await app.press('space')
    // A press GPUI delivers to the disabled button (it still listens).
    app.host.dispatch({ eventType: 'click', elementId: byId('save').nativeId, x: 1, y: 1, button: 0, clickCount: 1 } as never)
    byId('save').click()
    await app.settle()
    expect(model().saved).toBe(1)
    await app.click('Unlock')
    await app.click('Save')
    expect(model().saved).toBe(2)
  })

  test('a click on a disabled button reaches no ancestor either', async () => {
    const { app, byId } = await open()
    await app.click('Lock')
    const heard: Array<string> = []
    byId('save').parentElement!.addEventListener('click', event => heard.push((event.target as NativeElement).getAttribute('id') ?? '?'))
    // GPUI tells the button, then each listening ancestor, in one task.
    for (const target of [byId('save'), byId('save').parentElement!]) {
      app.host.dispatch({ eventType: 'click', elementId: target.nativeId, x: 1, y: 1, button: 0, clickCount: 1 } as never)
    }
    await app.settle()
    expect(heard).toEqual([])
  })

  test('traversal and programmatic focus skip disabled controls; re-enabled, Tab reaches them in order', async () => {
    const { app, byId, active } = await open()
    await app.click('Lock')
    expect(app.fake.tabOrder()).toEqual([byId('lock').nativeId])
    for (const id of CONTROLS) {
      byId(id).focus()
      expect(active()).not.toBe(id)
    }
    await app.click('Unlock')
    expect(app.fake.tabOrder()).toEqual([...CONTROLS, 'lock'].map(id => byId(id).nativeId))
    const seen: Array<string | null> = []
    for (const _ of [1, 2, 3, 4]) {
      await app.press('tab')
      seen.push(active())
    }
    expect(seen).toEqual(['name', 'notes', 'save', 'lock'])
  })

  test('GPUI focusing a disabled field (its editor takes a press) doesn\'t move the DOM\'s focus', async () => {
    const { app, byId, active } = await open()
    byId('lock').focus()
    await app.press('enter')
    expect(active()).toBe('lock')
    // GPUI's focus event for the field, then a key with GPUI's focus on it.
    app.host.dispatch({ eventType: 'focus', elementId: byId('name').nativeId } as never)
    expect(active()).toBe(null)
    app.fake.renderer.focusElement?.(byId('name').nativeId)
    await app.press('a')
    expect(active()).toBe(null)
    expect(app.gpuiFocus()).toBe(null)
  })
})

describe('what `disabled` applies to, as HTML has it', () => {
  let app: ReturnType<typeof mountHeadless> | undefined
  afterEach(() => {
    app?.close()
    app = undefined
  })

  test('a disabled fieldset disables its controls, except in its first legend; `disabled` on a div means nothing', async () => {
    app = mountHeadless()
    const { document } = app
    const fieldset = document.createElement('fieldset')
    const legend = document.createElement('legend')
    const inLegend = document.createElement('input')
    inLegend.setAttribute('id', 'in-legend')
    legend.append(inLegend)
    const inside = document.createElement('button')
    inside.setAttribute('id', 'inside')
    const item = document.createElement('div')
    item.setAttribute('id', 'item')
    item.setAttribute('tabindex', '0')
    item.setAttribute('disabled', '')
    fieldset.append(legend, inside)
    const container = app.container as unknown as NativeElement
    container.append(fieldset, item)
    await app.settle()
    const stops = () => app!.fake.tabOrder().map(id => app!.elementFor(id)?.getAttribute('id'))
    expect(stops()).toEqual(['in-legend', 'inside', 'item'])
    expect(inside.matches(':enabled')).toBe(true)
    fieldset.setAttribute('disabled', '')
    await app.settle()
    expect(stops()).toEqual(['in-legend', 'item'])
    expect(inside.matches(':disabled')).toBe(true)
    expect(inLegend.matches(':disabled')).toBe(false)
    expect(item.matches(':disabled')).toBe(false)
    expect(item.matches(':enabled')).toBe(false)
  })
})

describe.skipIf(!METAL)('Metal', () => {
  let app: Awaited<ReturnType<typeof openMetal>> | undefined
  afterEach(() => {
    app?.close()
    app = undefined
  })
  const open = async (name: string) => {
    app = await openMetal(`disabled-${name}`, { width: 360, height: 280 }, { css })
    const model = await start(app.container)
    await app.settle()
    const byId = (id: string) => app!.document.getElementById(id)!
    const active = () => app!.document.activeElement?.getAttribute('id') ?? null
    const gpui = () => app!.gpuiFocus()?.getAttribute('id') ?? null
    return { app, model, byId, active, gpui }
  }

  for (const id of ['name', 'notes'] as const) {
    test(`${id}: locked while focused, keys, paste and Backspace don't edit it; clicks and Tab don't reach it; unlocked, it edits`, async () => {
      const { app, model, byId, active, gpui } = await open(id)
      await app.click(byId(id))
      await app.keys('a b')
      await app.keys('cmd-a cmd-c')
      expect(model()[id]).toBe('ab')
      await app.keys('escape')
      expect(model().locked).toBe(true)
      expect(active()).toBe(null)
      console.log(`disabled ${id}: GPUI focus after the lock:`, gpui())
      // Typing, pasting and deleting: GPUI's editor is read-only now.
      await app.keys('c d cmd-v backspace')
      expect(model()[id]).toBe('ab')
      expect((byId(id) as unknown as { value: string }).value).toBe('ab')
      expect(app.painted()).toContain('ab')
      app.screenshot('locked')
      // A click on it: GPUI's editor may take focus; the DOM's stays off it.
      await app.click(byId(id))
      expect(active()).toBe(null)
      await app.keys('e')
      expect(model()[id]).toBe('ab')
      // Tab from the Lock button skips every locked control.
      await app.click(byId('lock'))
      expect(model().locked).toBe(false)
      await app.click(byId('lock'))
      expect(model().locked).toBe(true)
      await app.keys('tab')
      expect(active()).toBe('lock')
      byId(id).focus()
      await app.settle()
      expect(active()).toBe('lock')
      // Unlocked: Tab reaches it, and it takes keys and a paste again.
      await app.click(byId('lock'))
      expect(model().locked).toBe(false)
      for (const _ of CONTROLS) {
        if (active() === id) break
        await app.keys('tab')
      }
      expect(active()).toBe(id)
      expect(gpui()).toBe(id)
      await app.keys('end f cmd-v')
      expect(model()[id]).toBe('abfab')
      app.screenshot('unlocked')
    })
  }

  test('save: locked while focused, focus leaves; Enter, Space and a click do nothing; unlocked, it saves', async () => {
    const { app, model, byId, active } = await open('button')
    byId('save').focus()
    await app.settle()
    await app.press('enter')
    expect(model().saved).toBe(1)
    await app.press('escape')
    expect(model().locked).toBe(true)
    expect(active()).toBe(null)
    await app.press('enter')
    await app.press('space')
    await app.click(byId('save'))
    expect(model().saved).toBe(1)
    expect(active()).not.toBe('save')
    app.screenshot('locked')
    await app.click(byId('lock'))
    await app.click(byId('save'))
    expect(model().saved).toBe(2)
    await app.keys('shift-tab')
    expect(active()).toBe('notes')
    await app.keys('tab')
    expect(active()).toBe('save')
    await app.press('space')
    expect(model().saved).toBe(3)
  })
})
