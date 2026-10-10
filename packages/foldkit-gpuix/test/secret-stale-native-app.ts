// Sole-qualifier fixture: a real native window, production mount and SSE.
// Never imported by headless tests. Parent kills the child on timeout.
import assert from 'node:assert/strict'
import type { GpuixRenderer } from '@gpuix/native'
import { connectStdio } from '@gpuix/native/automation'
import { mountGpuix } from '../src/index.ts'

const run = async () => {
  const app = mountGpuix({ title: 'secret-stale-native', width: 320, height: 180, automation: true, exitOnClose: false })
  const native = app.renderer as GpuixRenderer
  const feed: Array<(chunk: string) => void> = []
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    if (text.startsWith('data:')) { for (const callback of feed) callback(text); return true }
    return write(chunk)
  }) as typeof process.stdout.write
  const client = await connectStdio({ write: chunk => { process.stdin.emit('data', chunk) }, feed: callback => feed.push(callback), close: async () => {} })
  const read = async () => await client.call('getPaintedText', {}) as { text: Array<string> }
  const until = async (ready: () => boolean | Promise<boolean>) => {
    const deadline = performance.now() + 15_000
    while (!(await ready())) {
      assert(performance.now() < deadline, 'native painted snapshot/retirement did not progress')
      await new Promise(resolve => setTimeout(resolve, 8))
    }
  }
  const observations: Array<unknown> = []
  try {
    for (const action of ['clear', 'replace', 'remove'] as const) {
      const field = app.document.createElement('input')
      field.setAttribute('autocomplete', 'one-time-code'); field.value = '596274'
      field.style.width = '280px'; field.style.height = '40px'
      app.document.body.appendChild(field); app.host.flush()
      await until(() => native.getPaintedText().includes('596274'))
      assert(!(await read()).text.includes('596274'), 'initial secret leaked')
      if (action === 'clear') field.value = ''
      else if (action === 'replace') field.value = '831905'
      else field.remove()
      // Read before a scheduled JS frame. Record raw native timing separately
      // from the served invariant; Linux caller-TLS limitations may fail warmup.
      const raw = native.getPaintedText()
      const atMutation = native.getDebugFrameOverlayStats().frames
      const stale = await read()
      assert(!stale.text.includes('596274'), 'stale native snapshot leaked')
      if (action === 'replace') {
        await until(() => native.getPaintedText().includes('831905'))
        assert(!(await read()).text.includes('831905'), 'replacement secret leaked')
      }
      field.remove(); app.host.flush()
      const publicText = app.document.createElement('div'); publicText.textContent = '596274'
      app.document.body.appendChild(publicText); app.host.flush()
      await until(async () => (await read()).text.includes('596274'))
      observations.push({ action, rawAtMutation: raw, frameAtMutation: atMutation, stale, publicReuse: await read() })
      publicText.remove(); app.host.flush()
      await until(() => !native.getPaintedText().includes('596274'))
    }
    console.log(JSON.stringify({ nativePrivacy: observations, platform: process.platform }))
  } finally { await client.close(); process.stdout.write = write; await app.close({ force: true }) }
}
run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
