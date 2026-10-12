// Combined PR74/75/81 behavior through the production mount, owned SSE
// decoder, native-event dispatch and frame loop. Rendering is controlled:
// ticks do not acknowledge draws; only draw() advances the published count.
import { expect, test } from 'bun:test'
import { connectStdio } from '@gpuix/native/automation'
import { createRendererState } from '@gpuix/native/host'
import { mountGpuix, type ErrorReport } from '../src/index.ts'
import { createFocusableFake } from './support.ts'

const turn = () => new Promise<void>(resolve => setTimeout(resolve, 0))
const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 100; i++) { if (condition()) return; await turn() }
  throw new Error('Integration control did not complete')
}
const exercise = async (use: (rig: Awaited<ReturnType<typeof open>>) => Promise<void>, validStats = true) => {
  const rig = await open(validStats)
  try { await use(rig) } finally { await rig.close() }
}
const open = async (validStats: boolean) => {
  const fake = createFocusableFake()
  const beforeDocument = globalThis.document
  const beforeListeners = process.stdin.listeners('data')
  let frames = 0, ticks = 0, hostChunks = 0, replies = 0
  let painted: Array<string> = []
  let failure: Error | undefined
  const reports: Array<ErrorReport> = []
  const hostListener = () => { hostChunks++ }
  process.stdin.on('data', hostListener)
  const renderer = {
    ...fake.renderer, init: () => {}, requiresTick: () => true,
    tick: () => { ticks++; if (failure !== undefined) { const error = failure; failure = undefined; throw error }; return true },
    getAllText: () => painted, getPaintedText: () => painted,
    ...(validStats ? { getDebugFrameOverlayStats: () => ({ frames, samples: 0 }) } : {}),
    getAutomationTree: () => JSON.stringify({ type: 'div', id: 1, children: [
      { type: 'input', id: 2, text: painted[0] ?? '', value: painted[0] ?? '' },
      { type: 'text', id: 3, text: 'Visible' },
    ] }),
  }
  const app = mountGpuix({ automation: true, exitOnClose: false, createRenderer: () => renderer, onError: report => { reports.push(report) } })
  const ownedListeners = process.stdin.listeners('data').filter(listener => !beforeListeners.includes(listener) && listener !== hostListener)
  const feed: Array<(chunk: string) => void> = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    if (text.startsWith('data:')) { replies++; for (const callback of feed) callback(text); return true }
    return write(chunk)
  }) as typeof process.stdout.write
  const client = await connectStdio({ write: chunk => {
    // Exercise the explicitly owned protocol, including fragmented frames.
    for (const piece of [chunk.slice(0, 3), chunk.slice(3, 11), chunk.slice(11)]) process.stdin.emit('data', piece)
  }, feed: callback => { feed.push(callback) }, close: async () => {} })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    try { await client.close(); await app.close({ force: true }); await app.closed }
    finally { process.stdout.write = write; process.stdin.off('data', hostListener); if (process.stdin.listenerCount('data') === 0) process.stdin.pause() }
  }
  return {
    app, fake, renderer, reports, beforeDocument, beforeListeners, hostListener, ownedListeners, close,
    read: async () => await client.call('getAllText', {}),
    tree: async () => await client.call('getTree', {}),
    raw: (text: Array<string>) => { painted = text },
    draw: (text: Array<string>) => { painted = text; frames++ },
    failTick: (error: Error) => { failure = error },
    ticks: () => ticks, replies: () => replies, hostChunks: () => hostChunks,
    field: (tag: 'input' | 'textarea' = 'input', value = 'a') => {
      const field = app.document.createElement(tag)
      field.setAttribute('autocomplete', 'one-time-code'); field.value = value
      app.document.body.appendChild(field); app.host.flush()
      return field
    },
  }
}

for (const tag of ['input', 'textarea'] as const) test(`integration: ${tag} held tab is captured, superseded and retired through owned SSE`, async () => exercise(async rig => {
  const field = rig.field(tag)
  const seen: Array<string> = []
  field.addEventListener('input', () => { seen.push(field.value) })
  rig.app.host.dispatch({ eventType: 'change', elementId: field.nativeId, value: 'a\t' } as never)
  expect(field.value).toBe('a')
  rig.app.host.dispatch({ eventType: 'change', elementId: field.nativeId, value: 'a\tb' } as never)
  rig.raw(['a\t', 'a\tb', 'Visible'])
  expect(await rig.read()).toEqual({ text: ['••', '•••', 'Visible'] })
  await turn()
  expect(field.value).toBe('a\tb'); expect(seen).toEqual(['a\tb'])
  rig.app.host.flush(); rig.draw(['a\t', 'a\tb', 'Visible'])
  expect(await rig.read()).toEqual({ text: ['a\t', '•••', 'Visible'] })
  expect(rig.ownedListeners).toHaveLength(1)
}))

test('integration: a controlled value cancels a captured held edit without losing current secrecy', async () => exercise(async rig => {
  const field = rig.field()
  const seen: Array<string> = []
  field.addEventListener('input', () => { seen.push(field.value) })
  rig.app.host.dispatch({ eventType: 'change', elementId: field.nativeId, value: 'a\t' } as never)
  field.value = 'CONTROLLED'
  rig.raw(['a\t', 'CONTROLLED']); expect(await rig.read()).toEqual({ text: ['••', '••••••••••'] })
  await turn(); expect(field.value).toBe('CONTROLLED'); expect(seen).toEqual([])
  rig.app.host.flush(); rig.draw(['a\t', 'CONTROLLED'])
  expect(await rig.read()).toEqual({ text: ['a\t', '••••••••••'] })
}))

test('integration: native capture precedes an application clear with the owned decoder', async () => exercise(async rig => {
  const field = rig.field('input', 'ORIGINAL')
  field.addEventListener('input', () => { field.value = '' })
  rig.raw(['NATIVE-CAPTURE', 'Visible'])
  rig.app.host.dispatch({ eventType: 'change', elementId: field.nativeId, value: 'NATIVE-CAPTURE' } as never)
  expect(field.value).toBe('')
  expect(await rig.read()).toEqual({ text: ['••••••••••••••', 'Visible'] })
  rig.app.host.flush(); rig.draw(['NATIVE-CAPTURE', 'Visible'])
  expect(await rig.read()).toEqual({ text: ['NATIVE-CAPTURE', 'Visible'] })
}))

test('integration: newer captures survive an older fence and public reuse leaves the latest secret hidden', async () => exercise(async rig => {
  const field = rig.field('input', 'FIRST')
  field.value = 'SECOND'; rig.app.host.flush()
  rig.raw(['FIRST', 'SECOND'])
  expect(await rig.read()).toEqual({ text: ['•••••', '••••••'] })
  rig.draw(['FIRST', 'SECOND', 'NEWEST'])
  field.value = 'NEWEST'
  expect(await rig.read()).toEqual({ text: ['FIRST', '••••••', '••••••'] })
  rig.app.host.flush(); rig.draw(['FIRST', 'SECOND', 'NEWEST'])
  expect(await rig.read()).toEqual({ text: ['FIRST', 'SECOND', '••••••'] })
}))

test('integration: missing draw capability fails closed while owned protocol and shutdown stay available', async () => exercise(async rig => {
  rig.field(); rig.raw(['a'])
  await expect(rig.read()).rejects.toThrow('Automation text unavailable')
  expect(await rig.tree()).toEqual({ tree: { id: 1, type: 'div', children: [{ id: 2, type: 'input' }, { id: 3, type: 'text', text: 'Visible' }] } })
  expect(rig.ownedListeners).toHaveLength(1)
  await rig.app.close(); await rig.app.closed
  expect(process.stdin.listeners('data')).toContain(rig.hostListener)
  expect(process.stdin.listeners('data')).not.toContain(rig.ownedListeners[0])
  expect(rig.fake.gpui.retainedCount()).toBe(0)
  expect(createRendererState(rig.renderer).current()).toBeUndefined()
  expect(globalThis.document).toBe(rig.beforeDocument)
}, false))

test('integration: disposer failure still cancels pending secret edits, frames and the owned listener', async () => exercise(async rig => {
  const field = rig.field()
  let inputEvents = 0, animationFrames = 0
  field.addEventListener('input', () => { inputEvents++ })
  rig.app.host.dispatch({ eventType: 'change', elementId: field.nativeId, value: 'a\t' } as never)
  rig.raw(['a\t']); expect(await rig.read()).toEqual({ text: ['••'] })
  const released: Array<string> = []
  const problem = new Error('owned integration disposer')
  rig.app.own({ dispose: () => { released.push('older') } })
  rig.app.own({ dispose: () => { released.push('newer'); throw problem } })
  rig.app.window.requestAnimationFrame(() => { animationFrames++ })
  expect(await rig.app.close()).toBe(true); await rig.app.closed
  expect(released).toEqual(['newer', 'older'])
  expect(rig.reports).toMatchObject([{ phase: 'close', error: problem, context: { stage: 'teardown' } }])
  expect(rig.fake.gpui.retainedCount()).toBe(0)
  expect(createRendererState(rig.renderer).current()).toBeUndefined()
  expect(globalThis.document).toBe(rig.beforeDocument)
  expect(process.stdin.listeners('data')).toContain(rig.hostListener)
  expect(process.stdin.listeners('data')).not.toContain(rig.ownedListeners[0])
  const ticks = rig.ticks(), batches = rig.fake.gpui.batches.length, replies = rig.replies(), hostChunks = rig.hostChunks()
  process.stdin.emit('data', 'data: {"id":999,"method":"getAllText","params":{}}\n\n')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(inputEvents).toBe(0); expect(animationFrames).toBe(0)
  expect(rig.ticks()).toBe(ticks); expect(rig.fake.gpui.batches.length).toBe(batches)
  expect(rig.replies()).toBe(replies); expect(rig.hostChunks()).toBe(hostChunks + 1)
  expect(await rig.app.close({ force: true })).toBe(true); expect(released).toEqual(['newer', 'older'])
}))

test('integration: frame-loop failure invalidates history before resilient cleanup', async () => exercise(async rig => {
  const field = rig.field('input', 'FIRST'); rig.draw(['FIRST'])
  field.value = ''; rig.app.host.flush()
  const problem = new Error('integration tick failed')
  rig.failTick(problem)
  await waitFor(() => rig.reports.some(report => report.phase === 'frame'))
  expect(rig.reports.find(report => report.phase === 'frame')?.error).toBe(problem)
  await expect(rig.read()).rejects.toThrow('Automation text unavailable')
  const field2 = rig.field('input', 'NEWER'); rig.draw(['FIRST', 'NEWER'])
  expect(await rig.read()).toEqual({ text: ['FIRST', '•••••'] })
  rig.app.host.dispatch({ eventType: 'change', elementId: field2.nativeId, value: 'NEWER\t' } as never)
  await rig.app.close({ force: true }); await rig.app.closed
  const ticks = rig.ticks()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(rig.ticks()).toBe(ticks)
  expect(process.stdin.listeners('data')).not.toContain(rig.ownedListeners[0])
  expect(rig.fake.gpui.retainedCount()).toBe(0)
}))
