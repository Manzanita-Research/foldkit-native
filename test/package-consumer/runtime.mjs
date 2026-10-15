import assert from 'node:assert/strict'
import { createRendererState } from '@gpuix/native/host'
import { Schema } from 'effect'
import { Runtime } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { createFakeGpui } from './fake-gpui.js'

const before = {
  exit: process.exit,
  stdout: process.stdout.write,
  stderr: process.stderr.write,
  stdin: process.stdin.listeners('data'),
  signals: ['SIGTERM', 'SIGINT'].map(name => process.listeners(name)),
}
// Import installed exports, including every existing root subpath. No aliases.
const binding = await import('@gpuix/native')
assert.equal(typeof binding.GpuixRenderer, 'function')
const native = await import('foldkit-native')
const primitives = await import('foldkit-native/primitives')
const theme = await import('foldkit-native/theme')
const style = await import('foldkit-native/style')
const adapter = await import('foldkit-gpuix')
const ui = await import('@foldkit-native/ui')
assert.equal(native.token, theme.token)
assert.equal(native.Primitives.stack, primitives.stack)
assert.equal(theme.token('space.3'), 'var(--fn-space-3)')
assert.match(theme.tokensToCss({ 'space.3': 12 }), /--fn-space-3: 12px/)
assert.ok(primitives.primitivesCss.includes('data-fn'))
assert.ok(style.nativeDefaultsCss.length > 0)
assert.equal(style.px('12px'), 12)
assert.ok(ui.uiCss.includes('data-ui'))
assert.equal(ui.Checkbox.labelId('agree'), 'agree-label')
assert.equal(ui.token('color.canvas'), 'var(--fn-color-canvas)')
assert.equal(adapter.sheetFromCss('.app { padding: 12px; }').unsupported.length, 0)
assert.deepEqual(adapter.secretValues([{ localName: 'input', getAttribute: name => name === 'autocomplete' ? 'current-password' : null, value: 'hidden' }]), ['hidden'])

// A real FoldKit runtime and public mount API; only the native window is replaced.
// The canonical retained-tree fixture is copied as standalone JS into the consumer.
const documentBefore = globalThis.document
const fake = createFakeGpui()
let callback
let running = true
const app = adapter.mountGpuix({
  title: 'Installed package counter', width: 320, height: 240,
  css: ui.uiCss, tokens: ui.paper, exitOnClose: false, automation: false,
  createRenderer: events => {
    callback = events
    return {
      ...fake.renderer,
      init() {},
      requiresTick: () => true,
      tick: () => running,
      getWindowSize: () => ({ width: 320, height: 240 }),
    }
  },
})
const Message = defineMessageUnion({ Incremented: {} })
const Model = Schema.Struct({ count: Schema.Number })
let disposed = false
const runtime = Runtime.embed(Runtime.makeElement({
  Model,
  init: () => ({ model: { count: 0 } }),
  update: model => ({ model: { count: model.count + 1 } }),
  view: (model, h) => h.div([], [
    h.p([h.Id('count')], [`Count: ${model.count}`]),
    ui.Button.view({ id: 'increment', label: '+1', onClick: Message.Incremented() }, h),
  ]),
  container: app.container,
}))
app.own({ dispose() { runtime.dispose(); disposed = true } })
const settle = () => new Promise(resolve => setTimeout(resolve, 80))
await settle()
assert.equal(app.document.getElementById('count').textContent, 'Count: 0')
const button = app.document.getElementById('increment')
assert.ok(button.nativeId > 0)
callback(null, { eventType: 'click', elementId: button.nativeId, x: 1, y: 1, button: 0, clickCount: 1 })
await settle()
assert.equal(app.document.getElementById('count').textContent, 'Count: 1')
assert.ok(fake.retainedCount() > 0)
assert.ok(createRendererState(app.renderer).current())
const documentStandIn = globalThis.document
assert.equal(await app.close(), true)
await app.closed
running = false
assert.equal(disposed, true)
assert.equal(fake.retainedCount(), 0)
assert.equal(createRendererState(app.renderer).current(), undefined)
assert.notEqual(globalThis.document, documentStandIn)
assert.equal(globalThis.document, documentBefore)
assert.equal(process.exit, before.exit)
assert.equal(process.stdout.write, before.stdout)
assert.equal(process.stderr.write, before.stderr)
assert.deepEqual(process.stdin.listeners('data'), before.stdin)
assert.deepEqual(['SIGTERM', 'SIGINT'].map(name => process.listeners(name)), before.signals)
assert.equal(await app.close(), true)
console.log('Installed ESM exports, native binding load, counter input, shared renderer state and owned disposal passed.')
