// Shutdown ownership and exception safety through the production app APIs.
// Every renderer here is a fake: no native window or Metal work.
import { afterEach, expect, spyOn, test } from 'bun:test'
import { connectStdio } from '@gpuix/native/automation'
import { createRendererState } from '@gpuix/native/host'

import { attachGpuix, type ErrorReport, type NativeOptions, mountGpuix } from '../src/index.ts'
import { createFakeWindow, frames } from './app-support.ts'

const apps: Array<ReturnType<typeof mountGpuix>> = []
const listeners: Array<(chunk: unknown) => void> = []
const listen = (listener: (chunk: unknown) => void) => {
  listeners.push(listener)
  process.stdin.on('data', listener)
  return listener
}
const open = (options: NativeOptions = {}) => {
  const window = createFakeWindow()
  const app = mountGpuix({ automation: false, exitOnClose: false, createRenderer: window.createRenderer, ...options })
  apps.push(app)
  return { app, window }
}
afterEach(async () => {
  for (const app of apps.splice(0).reverse()) {
    await app.close({ force: true }).catch(() => {})
    // Also clean the fake tree when running these regressions on broken main.
    app.window.cancelAllFrames()
    app.host.detach({ windowGone: true })
  }
  for (const listener of listeners.splice(0)) process.stdin.off('data', listener)
  if (process.stdin.listenerCount('data') === 0) process.stdin.pause()
})

for (const automation of [false, true]) {
  test(`shutdown preserves host stdin listeners before and after mount, automation=${automation}`, async () => {
    const delivered: Array<string> = []
    // Identity distinguishes these empty test-owned chunks from real stdin.
    // Empty chunks invoke the host without sending an automation command.
    const beforeClose = Buffer.from(''), afterClose = Buffer.from('')
    const record = (host: string) => (chunk: unknown) => {
      if (chunk === beforeClose) delivered.push(`${host}:before-close`)
      if (chunk === afterClose) delivered.push(`${host}:after-close`)
    }
    const before = listen(record('before'))
    const original = process.stdin.listeners('data')
    const { app } = open({ automation })
    const owned = process.stdin.listeners('data').filter(listener => !original.includes(listener))
    expect(owned.length).toBe(automation ? 1 : 0)
    const after = listen(record('after'))
    process.stdin.emit('data', beforeClose)
    expect(delivered).toEqual(['before:before-close', 'after:before-close'])
    expect(await app.close()).toBe(true)
    await app.closed
    expect(process.stdin.listeners('data')).toContain(before)
    expect(process.stdin.listeners('data')).toContain(after)
    for (const listener of owned) expect(process.stdin.listeners('data')).not.toContain(listener)
    process.stdin.emit('data', afterClose)
    expect(delivered).toEqual(['before:before-close', 'after:before-close', 'before:after-close', 'after:after-close'])
  })
}

for (const oldestFirst of [true, false]) {
  test(`shutdown preserves the other app's automation listener, oldestFirst=${oldestFirst}`, async () => {
    const original = process.stdin.listeners('data')
    const first = open({ automation: true }).app
    const firstListener = process.stdin.listeners('data').find(listener => !original.includes(listener))!
    const second = open({ automation: true }).app
    const secondListener = process.stdin.listeners('data').find(listener => !original.includes(listener) && listener !== firstListener)!
    expect(firstListener).toBeDefined()
    expect(secondListener).toBeDefined()
    const [closing, remaining, removed, retained] = oldestFirst
      ? [first, second, firstListener, secondListener] as const
      : [second, first, secondListener, firstListener] as const
    await closing.close()
    expect(process.stdin.listeners('data')).not.toContain(removed)
    expect(process.stdin.listeners('data')).toContain(retained)
    await remaining.close()
    expect(process.stdin.listeners('data')).toEqual(original)
  })
}

test('shutdown does not claim a host listener installed by renderer initialization', async () => {
  const listener = () => {}
  const window = createFakeWindow({ init: () => { listen(listener) } })
  const { app } = open({ automation: true, createRenderer: window.createRenderer })
  await app.close()
  expect(process.stdin.listeners('data')).toContain(listener)
})

test('shutdown preserves a host listener registered by newListener during automation setup', async () => {
  let inserted = false, delivered = 0
  const host = () => { delivered++ }
  const observer = (event: string) => {
    if (event === 'data' && !inserted) {
      inserted = true
      listen(host)
    }
  }
  process.stdin.on('newListener', observer)
  try {
    const { app } = open({ automation: true })
    process.stdin.off('newListener', observer)
    expect(inserted).toBe(true)
    expect(process.stdin.listeners('data')).toContain(host)
    await app.close()
    await app.closed
    process.stdin.emit('data', Buffer.from(''))
    expect(process.stdin.listeners('data')).toContain(host)
    expect(delivered).toBe(1)
  } finally { process.stdin.off('newListener', observer) }
})

test('shutdown keeps the gpuix automation protocol working with an explicitly owned listener', async () => {
  const original = process.stdin.listeners('data')
  const window = createFakeWindow()
  const { app } = open({ automation: true, createRenderer: callback => ({
    ...window.createRenderer(callback),
    getPaintedText: () => ['Public label', '596274'],
  }) })
  const secret = app.document.createElement('input')
  secret.setAttribute('autocomplete', 'one-time-code')
  secret.value = '596274'
  app.document.body.appendChild(secret)
  const feed: Array<(chunk: string) => void> = []
  const output = spyOn(process.stdout, 'write').mockImplementation(chunk => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    for (const listener of feed) listener(text)
    return true
  })
  try {
    const client = await connectStdio({ write: chunk => {
      // Split even the SSE prefix and JSON; the decoder must retain fragments.
      process.stdin.emit('data', chunk.slice(0, 3))
      process.stdin.emit('data', chunk.slice(3, 11))
      process.stdin.emit('data', chunk.slice(11))
    }, feed: listener => { feed.push(listener) } })
    try {
      expect(await client.call('getPaintedText', {})).toEqual({ text: ['Public label', '••••••'] })
    } finally { await client.close() }
    let delivered = 0
    const host = listen(() => { delivered++ })
    await app.close()
    expect(process.stdin.listeners('data')).toEqual([...original, host])
    const replies = output.mock.calls.length
    process.stdin.emit('data', 'data: {"id":99,"method":"getPaintedText","params":{}}\n\n')
    await frames(1)
    expect(delivered).toBe(1)
    expect(output.mock.calls.length).toBe(replies)
  } finally { output.mockRestore() }
})

test('shutdown automation helpers leave native loading lazy when the native module is unavailable', async () => {
  // Import-only: Node's synchronous loader hooks reject native modules if
  // an eager import is introduced. This child never attempts to mount.
  const source = new URL('../src/index.ts', import.meta.url).pathname
  const root = new URL('../../../', import.meta.url)
  const child = Bun.spawn(['node', '--input-type=module', '-'], { cwd: root.pathname, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  child.stdin.write(`
    import assert from 'node:assert/strict'
    import { createRequire, registerHooks } from 'node:module'
    import { readFileSync } from 'node:fs'
    import { fileURLToPath } from 'node:url'
    import ts from ${JSON.stringify(import.meta.resolve('typescript'))}
    let loads = 0
    const unavailable = new Error('native module unavailable')
    registerHooks({
      resolve(specifier, context, next) {
        if (specifier === '@gpuix/native' || specifier === '@gpuix/native/runtime') { loads++; throw unavailable }
        // Match the project's tsconfig self-reference alias.
        if (specifier.startsWith('foldkit-native/')) return {
          url: new URL('src/' + specifier.slice('foldkit-native/'.length) + '.ts', ${JSON.stringify(root.href)}).href,
          shortCircuit: true,
        }
        return next(specifier, context)
      },
      load(url, context, next) {
        if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
          source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 },
          }).outputText,
        }
        return next(url, context)
      },
    })
    const adapter = await import(${JSON.stringify(source)})
    assert.equal(typeof adapter.mountGpuix, 'function')
    assert.equal(loads, 0, 'adapter import must not load native')
    const require = createRequire(import.meta.url)
    assert.equal(Object.keys(require.cache).filter(path =>
      path.endsWith('.node') || path.endsWith('/@gpuix/native/index.js') || path.endsWith('/@gpuix/native/dist/runtime.js')
    ).length, 0)
    console.log('lazy native loading verified')
  `)
  child.stdin.end()
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(stderr).toBe('')
  expect(code).toBe(0)
  expect(stdout).toContain('lazy native loading verified')
})

for (const loggingThrows of [false, true]) {
  test(`shutdown completes even when onError throws, loggingThrows=${loggingThrows}`, async () => {
    const original = process.stdin.listeners('data')
    const before = globalThis.document
    const reports: Array<ErrorReport> = []
    const { app, window } = open({ automation: true, onError: report => {
      reports.push(report)
      throw new Error('reporter failed')
    } })
    const owned = process.stdin.listeners('data').filter(listener => !original.includes(listener))
    const problem = new Error('owned failure')
    const released: Array<string> = []
    app.own({ dispose: () => { released.push('older') } })
    app.own({ dispose: () => { released.push('newer'); throw problem } })
    const quiet = spyOn(console, 'error').mockImplementation(() => {
      if (loggingThrows) throw new Error('logger failed')
    })
    try {
      expect(await app.close()).toBe(true)
      await Promise.race([app.closed, frames(3).then(() => { throw new Error('closed did not settle') })])
      expect(released).toEqual(['newer', 'older'])
      expect(window.fake.gpui.retainedCount()).toBe(0)
      expect(createRendererState(app.renderer).current()).toBeUndefined()
      expect(globalThis.document).toBe(before)
      for (const listener of owned) expect(process.stdin.listeners('data')).not.toContain(listener)
      expect(reports).toEqual([{ phase: 'close', error: problem, context: { reason: 'close', stage: 'teardown' } }])
      expect(quiet).toHaveBeenCalledTimes(1)
      expect(await app.close({ force: true })).toBe(true)
      expect(released).toEqual(['newer', 'older'])
      expect(quiet).toHaveBeenCalledTimes(1)
    } finally { quiet.mockRestore() }
  })
}

for (const throws of [false, true]) {
  test(`shutdown attempts every owned disposer once, restores globals and settles, throws=${throws}`, async () => {
    const before = globalThis.document
    const reports: Array<ErrorReport> = []
    const original = process.stdin.listeners('data')
    const { app, window } = open({ automation: true, onError: report => void reports.push(report) })
    const ownedListeners = process.stdin.listeners('data').filter(listener => !original.includes(listener))
    const released: Array<string> = []
    const problem = new Error('owned failure')
    app.own({ dispose: () => { released.push('older') } })
    app.own({ dispose: () => { released.push('middle'); if (throws) throw problem } })
    app.own({ dispose: () => { released.push('newer') } })
    const frame = app.window.requestAnimationFrame(() => released.push('abandoned frame'))
    expect(window.fake.gpui.retainedCount()).toBeGreaterThan(0)
    expect(await app.close()).toBe(true)
    await Promise.race([app.closed, frames(4).then(() => { throw new Error('closed did not settle') })])
    expect(released).toEqual(['newer', 'middle', 'older'])
    expect(window.fake.gpui.retainedCount()).toBe(0)
    expect(createRendererState(app.renderer).current()).toBeUndefined()
    expect(app.document.host).toBeUndefined()
    expect(globalThis.document).toBe(before)
    for (const listener of ownedListeners) expect(process.stdin.listeners('data')).not.toContain(listener)
    const batches = window.fake.gpui.batches.length
    await frames()
    expect(window.fake.gpui.batches.length).toBe(batches)
    app.window.cancelAnimationFrame(frame)
    expect(await app.close()).toBe(true)
    expect(await app.close({ force: true })).toBe(true)
    expect(released).toEqual(['newer', 'middle', 'older'])
    expect(reports).toEqual(throws ? [{ phase: 'close', error: problem, context: { reason: 'close', stage: 'teardown' } }] : [])
  })
}

for (const multiple of [false, true]) test(`shutdown detach exposes failures after later cleanup attempts, multiple=${multiple}`, () => {
  const before = globalThis.document
  const window = createFakeWindow()
  const renderer = window.createRenderer(() => {})
  const app = attachGpuix(renderer)
  const released: Array<string> = []
  const older = new Error('older failed'), newer = new Error('newer failed')
  app.own({ dispose: () => { released.push('older'); if (multiple) throw older } })
  app.own({ dispose: () => { released.push('newer'); throw newer } })
  try {
    let error: unknown
    try { app.detach() } catch (failed) { error = failed }
    if (multiple) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([newer, older])
    } else expect(error).toBe(newer)
    expect(released).toEqual(['newer', 'older'])
    expect(window.fake.gpui.retainedCount()).toBe(0)
    expect(createRendererState(renderer).current()).toBeUndefined()
    expect(globalThis.document).toBe(before)
    app.detach()
    expect(released).toEqual(['newer', 'older'])
  } finally {
    app.window.cancelAllFrames()
    app.host.detach()
  }
})

test('shutdown waits for a vetoed close before forcing, without releasing ownership early', async () => {
  const reports: Array<ErrorReport> = []
  const { app } = open({ automation: true, onError: report => void reports.push(report) })
  const installed = process.stdin.listeners('data')
  const released: Array<string> = []
  const problem = new Error('owned failure')
  app.own({ dispose: () => { released.push('disposed'); throw problem } })
  const saving = Promise.withResolvers<void>()
  let asked = 0
  app.onClose(async request => {
    asked++
    request.preventDefault()
    await saving.promise
  })
  const closing = app.close()
  expect(app.close()).toBe(closing)
  const forced = app.close({ force: true })
  expect(released).toEqual([])
  expect(process.stdin.listeners('data')).toEqual(installed)
  expect(createRendererState(app.renderer).current()).toBeDefined()
  saving.resolve()
  expect(await closing).toBe(false)
  expect(await forced).toBe(true)
  await app.closed
  expect(asked).toBe(2)
  expect(released).toEqual(['disposed'])
  expect(reports.map(report => report.error)).toEqual([problem])
})

test('shutdown still attempts host cleanup when frame cancellation throws', async () => {
  const before = globalThis.document
  const reports: Array<ErrorReport> = []
  const { app, window } = open({ onError: report => void reports.push(report) })
  const problem = new Error('cancel failed')
  const cancel = app.window.cancelAllFrames.bind(app.window)
  app.window.cancelAllFrames = () => { cancel(); throw problem }
  try {
    expect(await app.close()).toBe(true)
    await app.closed
    expect(window.fake.gpui.retainedCount()).toBe(0)
    expect(createRendererState(app.renderer).current()).toBeUndefined()
    expect(globalThis.document).toBe(before)
    expect(reports.map(report => report.error)).toEqual([problem])
  } finally { app.window.cancelAllFrames = cancel }
})

test('shutdown reports an owned failure when the native window is gone and still settles', async () => {
  const before = globalThis.document
  const reports: Array<ErrorReport> = []
  const { app, window } = open({ onError: report => void reports.push(report) })
  const problem = new Error('owned failure after window close')
  const released: Array<string> = []
  app.own({ dispose: () => { released.push('older') } })
  app.own({ dispose: () => { released.push('newer'); throw problem } })
  window.closeWindow()
  await Promise.race([app.closed, frames(10).then(() => { throw new Error('closed did not settle') })])
  expect(released).toEqual(['newer', 'older'])
  expect(window.fake.gpui.retainedCount()).toBe(0)
  expect(createRendererState(app.renderer).current()).toBeUndefined()
  expect(globalThis.document).toBe(before)
  expect(reports).toEqual([{ phase: 'close', error: problem, context: { reason: 'window', stage: 'teardown' } }])
  expect(await app.close({ force: true })).toBe(true)
})
