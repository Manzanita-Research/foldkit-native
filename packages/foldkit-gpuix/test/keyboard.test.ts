// Keys on real GPUI (Metal, offscreen): a key's release reaches the DOM as
// `keyup`, and GPUI's editors' own clipboard and undo (select all, copy, cut,
// paste, undo, redo) land in a FoldKit model as `input`, each one. What this
// proves and doesn't: the keystrokes go through GPUI's key dispatch and its
// editor's actions, but offscreen GPUI's clipboard is its test platform's,
// in memory. The system pasteboard (another app's copy, a paste into another
// app) is the live-window check in the FKN-21 report, and Linux is FKN-26's.
import { afterEach, describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { METAL, openMetal } from './support.ts'

const Model = Schema.Struct({ from: Schema.String, to: Schema.String, edits: Schema.Number })
type Model = typeof Model.Type
const Message = defineMessageUnion({ TypedFrom: { value: Schema.String }, TypedTo: { value: Schema.String } })
type Message = typeof Message.Type
const init: Model = { from: '', to: '', edits: 0 }
const update = (model: Model, message: Message): Model =>
  Message.match<Model>(message, {
    TypedFrom: ({ value }) => ({ ...model, from: value, edits: model.edits + 1 }),
    TypedTo: ({ value }) => ({ ...model, to: value, edits: model.edits + 1 }),
  })
const FIELD = { height: '28px', border: '1px solid #888888' }
const view = (model: Model, h: any) => h.div([h.Style({ display: 'flex', 'flex-direction': 'column', gap: '8px', padding: '16px' })], [
  h.input([h.Id('from'), h.Value(model.from), h.OnInput((value: string) => Message.TypedFrom({ value })), h.Style(FIELD)]),
  h.textarea([h.Id('to'), h.Value(model.to), h.OnInput((value: string) => Message.TypedTo({ value })), h.Style({ ...FIELD, height: '56px' })], []),
  h.button([h.Id('go')], ['Go']),
])

describe.skipIf(!METAL)('keys on Metal', () => {
  let app: Awaited<ReturnType<typeof openMetal>> | undefined
  afterEach(() => {
    app?.close()
    app = undefined
  })
  const open = async (name: string) => {
    app = await openMetal(`keyboard-${name}`, { width: 360, height: 200 })
    const { Runtime } = await import('foldkit')
    let latest = init
    Runtime.run(Runtime.makeElement({
      Model, init: () => ({ model: init }),
      update: (model: Model, message: Message) => ({ model: update(model, message) }),
      view: (model: Model, h: any) => {
        latest = model
        return view(model, h)
      },
      container: app.container,
    } as never))
    await app.settle()
    return { app, model: () => latest, byId: (id: string) => app!.document.getElementById(id)! }
  }

  test('a key\'s release reaches the focused element as keyup, and bubbles', async () => {
    const { app, byId } = await open('keyup')
    const seen: Array<string> = []
    for (const type of ['keydown', 'keyup']) {
      app.document.addEventListener(type, event => seen.push(`${type} ${(event as KeyboardEvent).key} @${(event.target as unknown as Element).getAttribute('id')}`))
    }
    byId('go').focus()
    await app.press('a')
    await app.press('escape')
    expect(seen).toEqual(['keydown a @go', 'keyup a @go', 'keydown Escape @go', 'keyup Escape @go'])
  })

  test('copy, paste, cut, undo and redo in GPUI\'s editors reach the model, each as an input', async () => {
    const { app, model, byId } = await open('clipboard')
    await app.click(byId('from'))
    await app.keys('h e l l o')
    await app.keys('cmd-a cmd-c')
    await app.click(byId('to'))
    await app.keys('cmd-v')
    expect(model().to).toBe('hello')
    await app.keys('cmd-v')
    expect(model().to).toBe('hellohello')
    await app.keys('cmd-z')
    expect(model().to).toBe('hello')
    await app.keys('cmd-shift-z')
    expect(model().to).toBe('hellohello')
    // Cut from the first field, paste into the second.
    await app.click(byId('from'))
    await app.keys('cmd-a cmd-x')
    expect(model().from).toBe('')
    await app.click(byId('to'))
    await app.keys('cmd-a cmd-v')
    expect(model().to).toBe('hello')
    // The DOM and GPUI's painted text agree with the model.
    expect((byId('to') as unknown as { value: string }).value).toBe('hello')
    expect(app.painted()).toContain('hello')
    console.log('keyboard clipboard edits:', model().edits)
    app.screenshot('after')
  })
})
