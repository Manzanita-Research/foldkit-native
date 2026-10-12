// Production mount/automation/SSE with separately controlled retained and painted
// state. A tick is liveness; only draw() publishes a fresh snapshot and count.
import { expect, test } from 'bun:test'
import { connectStdio } from '@gpuix/native/automation'
import { mountGpuix, type NativeOptions } from '../src/index.ts'
import { createAutomationSecrets } from '../src/automation-secrets.ts'
import { createFocusableFake } from './support.ts'

const exercise = async (use: (rig: Awaited<ReturnType<typeof open>>) => Promise<void>, options: Pick<NativeOptions, 'automation'> = {}) => {
  const rig = await open(options)
  try { await use(rig) } finally { await rig.close() }
}
const open = async (options: Pick<NativeOptions, 'automation'>) => {
  const fake = createFocusableFake()
  let frames = 0
  let painted: Array<string> = []
  let stats: 'valid' | 'throw' | 'nan' | 'missing' = 'valid'
  let failure: 'none' | 'batch' | 'invalidate' = 'none'
  let drawAtStats: Array<string> | undefined
  let paintInBatch = false
  let invalidations = 0
  const renderer = {
    ...fake.renderer, init: () => {}, requiresTick: () => false, tick: () => true,
    getPaintedText: () => painted,
    getAllText: () => painted,
    getSelectedText: () => painted[0] ?? null,
    getAutomationTree: () => JSON.stringify({ type: 'div', id: 1, children: [{ type: 'input', id: 2, value: '596274', text: '596274' }] }),
    getDebugFrameOverlayStats: () => {
      if (stats === 'throw') throw new Error('stats failed')
      if (drawAtStats !== undefined) { painted = drawAtStats; drawAtStats = undefined; frames++ }
      return { frames: stats === 'nan' ? NaN : frames, samples: 0 }
    },
    applyBatch: (json: string) => {
      if ((failure === 'batch' && json !== '[]') || (failure === 'invalidate' && json === '[]')) throw new Error('batch failed')
      const result = fake.renderer.applyBatch(json)
      if (json === '[]') invalidations++
      if (paintInBatch && json !== '[]') { painted = []; frames++ }
      return result
    },
  }
  const app = mountGpuix({ automation: true, exitOnClose: false, createRenderer: () => renderer, ...options })
  const feed: Array<(chunk: string) => void> = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    if (text.startsWith('data:')) { for (const callback of feed) callback(text); return true }
    return write(chunk)
  }) as typeof process.stdout.write
  const client = options.automation === false ? undefined : await connectStdio({
    write: chunk => { process.stdin.emit('data', chunk) }, feed: callback => feed.push(callback), close: async () => {},
  })
  return {
    app, renderer,
    read: async (method: 'getPaintedText' | 'getAllText' | 'getSelectedText' | 'getTree' = 'getPaintedText') => await client!.call(method, {}) as { text: Array<string> | string | null },
    field: (value = '596274') => {
      const field = app.document.createElement('input')
      field.setAttribute('autocomplete', 'one-time-code'); field.value = value
      app.document.body.appendChild(field); app.host.flush()
      return field
    },
    draw: (text: Array<string>) => { painted = text; frames++ },
    raw: (text: Array<string>) => { painted = text },
    stats: (value: typeof stats) => {
      stats = value
      if (value === 'missing') Object.defineProperty(renderer, 'getDebugFrameOverlayStats', { value: undefined, configurable: true })
    },
    count: (value: number) => { frames = value },
    fail: (value: typeof failure) => { failure = value },
    drawAtStats: (text: Array<string>) => { drawAtStats = text },
    paintInBatch: () => { paintInBatch = true },
    invalidations: () => invalidations,
    close: async () => { try { await client?.close() } finally { process.stdout.write = write; await app.close({ force: true }) } },
  }
}

for (const action of ['clear', 'replace', 'remove', 'classification', 'ancestor removal'] as const) {
  test(`stale automation: ${action} without a prior read, then retire for public reuse`, async () => exercise(async rig => {
    const field = rig.field(); rig.draw(['Ada', '596274'])
    if (action === 'clear') field.value = ''
    else if (action === 'replace') field.value = '831905'
    else if (action === 'remove') field.remove()
    else if (action === 'classification') field.removeAttribute('autocomplete')
    else rig.app.document.body.textContent = ''
    expect(await rig.read()).toEqual({ text: ['Ada', '••••••'] })
    rig.app.host.flush()
    // Neither a live tick nor host.drawn is a native draw acknowledgement.
    rig.renderer.tick(); rig.app.host.drawn()
    expect(await rig.read()).toEqual({ text: ['Ada', '••••••'] })
    if (action === 'replace') {
      rig.draw(['831905']); expect(await rig.read()).toEqual({ text: ['••••••'] })
      field.remove(); rig.app.host.flush()
    } else if (action === 'clear') { field.remove(); rig.app.host.flush() }
    // Same string is now public, continuously present even for classification.
    rig.draw(['Ada', '596274'])
    expect(await rig.read()).toEqual({ text: ['Ada', '596274'] })
    const requests = rig.invalidations()
    for (let i = 0; i < 5; i++) expect(await rig.read()).toEqual({ text: ['Ada', '596274'] })
    expect(rig.invalidations()).toBe(requests)
  }))
}

test('initial/fresh secret, tree stripping and all existing text surfaces', async () => exercise(async rig => {
  rig.field(); rig.draw(['596274', 'Ada'])
  expect(await rig.read()).toEqual({ text: ['••••••', 'Ada'] })
  expect(await rig.read('getAllText')).toEqual({ text: ['••••••', 'Ada'] })
  expect(await rig.read('getSelectedText')).toEqual({ text: '••••••' })
  expect(JSON.stringify(await rig.read('getTree'))).not.toContain('596274')
}))

test('capture native input before its application input handler clears it', async () => exercise(async rig => {
  const field = rig.field('before')
  field.addEventListener('input', () => { field.value = '' })
  rig.raw(['NATIVE'])
  rig.app.host.dispatch({ elementId: field.nativeId, eventType: 'change', value: 'NATIVE' } as never)
  expect(field.value).toBe('')
  expect(await rig.read()).toEqual({ text: ['••••••'] })
  rig.app.host.flush(); rig.draw(['NATIVE'])
  expect(await rig.read()).toEqual({ text: ['NATIVE'] })
}))

test('rapid submitted generations keep every possibly painted value then release obsolete history', async () => exercise(async rig => {
  const field = rig.field('first'); rig.draw(['first'])
  for (const value of ['second', 'third', 'fourth']) { field.value = value; rig.app.host.flush() }
  rig.raw(['first', 'second', 'third', 'fourth'])
  expect(await rig.read()).toEqual({ text: ['•••••', '••••••', '•••••', '••••••'] })
  rig.draw(['first', 'second', 'third', 'fourth'])
  expect(await rig.read()).toEqual({ text: ['first', 'second', 'third', '••••••'] })
}))

test('coalesced writes retain captured generations and the latest secret', async () => exercise(async rig => {
  const field = rig.field('first'); rig.draw(['first'])
  for (const value of ['second', 'third', 'fourth']) field.value = value
  expect(await rig.read()).toEqual({ text: ['•••••'] })
  rig.app.host.flush()
  rig.raw(['first', 'second', 'third', 'fourth'])
  expect(await rig.read()).toEqual({ text: ['•••••', '••••••', '•••••', '••••••'] })
  rig.draw(['first', 'second', 'third', 'fourth'])
  expect(await rig.read()).toEqual({ text: ['first', 'second', 'third', '••••••'] })
}))

test('acknowledge before fetching raw text if stats sampling itself completes a draw', async () => exercise(async rig => {
  const field = rig.field(); rig.draw(['596274'])
  field.value = ''; rig.app.host.flush()
  rig.drawAtStats([])
  expect(await rig.read()).toEqual({ text: [] })
}))

test('a draw before the baseline requires a forced later native draw', async () => exercise(async rig => {
  const field = rig.field(); rig.draw(['596274'])
  rig.paintInBatch(); field.value = ''; rig.app.host.flush()
  rig.raw(['596274'])
  expect(await rig.read()).toEqual({ text: ['••••••'] })
  rig.draw(['596274'])
  expect(await rig.read()).toEqual({ text: ['596274'] })
}))

for (const stats of ['throw', 'nan', 'missing'] as const) {
  test(`text fails closed on ${stats} draw stats; tree remains available`, async () => exercise(async rig => {
    const field = rig.field(); rig.draw(['596274']); field.value = ''; rig.app.host.flush()
    rig.stats(stats)
    await expect(rig.read()).rejects.toThrow('Automation text unavailable')
    expect(JSON.stringify(await rig.read('getTree'))).not.toContain('596274')
    if (stats === 'missing') return
    rig.stats('valid'); rig.app.host.flush()
    // A valid count alone cannot acknowledge an unsuccessful earlier fence.
    await expect(rig.read()).rejects.toThrow('Automation text unavailable')
    rig.draw([]); expect(await rig.read()).toEqual({ text: [] })
  }))
}

test('regressing completed counts fail closed', async () => exercise(async rig => {
  const field = rig.field(); rig.count(10); field.value = ''; rig.app.host.flush()
  rig.count(9); await expect(rig.read()).rejects.toThrow('Automation text unavailable')
}))

test('failed native batch/invalidation cannot retire secrets; recovery needs a fresh fence', async () => exercise(async rig => {
  const field = rig.field(); rig.draw(['596274'])
  rig.fail('batch'); field.value = ''
  expect(() => rig.app.host.flush()).toThrow('batch failed')
  rig.fail('invalidate')
  await expect(rig.read()).rejects.toThrow('Automation text unavailable')
  rig.fail('invalidate'); rig.app.host.flush()
  await expect(rig.read()).rejects.toThrow('Automation text unavailable')
  rig.fail('none'); rig.app.host.flush(); rig.draw(['596274'])
  expect(await rig.read()).toEqual({ text: ['596274'] })
}))

test('a stalled renderer does not accumulate unlimited secret history; a fresh draw restores public reads', async () => exercise(async rig => {
  const field = rig.field('secret-0')
  for (let i = 1; i < 400; i++) { field.value = `secret-${i}`; rig.app.host.flush() }
  await expect(rig.read()).rejects.toThrow('Automation text unavailable')
  field.remove(); rig.app.host.flush(); rig.draw(['secret-0'])
  expect(await rig.read()).toEqual({ text: ['secret-0'] })
}))

test('later captures survive an older fence; recovery preserves native-live values until superseded', () => {
  let frames = 0
  const fake = createFocusableFake()
  const tracker = createAutomationSecrets({ ...fake.renderer, getDebugFrameOverlayStats: () => ({ frames, samples: 0 }) })
  tracker.capture('old'); tracker.submitted(['old']); frames++
  tracker.capture('newer')
  expect(tracker.values([])).toEqual(['newer', 'old'])
  tracker.submitted(['newer']); frames++
  expect(tracker.values([])).toEqual(['newer'])
  tracker.invalidate(); tracker.submitted(['newer']); frames++
  expect(tracker.values([])).toEqual(['newer'])
  tracker.submitted([]); frames++
  expect(tracker.values([])).toEqual([])
  tracker.dispose()
  expect(() => tracker.values([])).toThrow('Automation text unavailable')
})

test('explicit opt-out avoids secret stats work', async () => exercise(async rig => {
  rig.stats('throw'); rig.field(); rig.app.host.flush()
  expect(rig.invalidations()).toBe(0)
}, { automation: false }))
