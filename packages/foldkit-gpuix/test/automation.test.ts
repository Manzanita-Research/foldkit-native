// gpuix's automation (clicks, keys, the tree, painted text, screenshots, all
// over stdin and stdout) is served only when asked for. gpuix's own default
// serves it whenever stdin isn't a terminal, so a shipped app started with a
// pipe (a launcher, a service manager, a parent process) would answer
// whoever writes to it.
//
// Headless: the option and the environment variable, and whether the adapter
// listens on stdin. Real windows (macOS, or inside the Linux session): a
// whole app, started with a pipe, answers gpuix's automation handshake only
// with FOLDKIT_NATIVE_AUTOMATION=1, on both the adapter and the mirror.
import { afterEach, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { WINDOWS } from '../../../test/support/windows.ts'
import { AUTOMATION_ENV, automationRequested } from '../src/index.ts'
import { openApp } from './app-support.ts'

type Opened = ReturnType<typeof openApp>
let opened: Opened | undefined
afterEach(async () => {
  await opened?.app.close({ force: true })
  opened = undefined
})

describe('asking for it', () => {
  test('never by default, however stdin is connected; the option, or the environment variable set to 1', () => {
    expect(AUTOMATION_ENV).toBe('FOLDKIT_NATIVE_AUTOMATION')
    expect(automationRequested(undefined, {})).toBe(false)
    expect(automationRequested(undefined, { FOLDKIT_NATIVE_AUTOMATION: '0' })).toBe(false)
    expect(automationRequested(undefined, { FOLDKIT_NATIVE_AUTOMATION: 'yes' })).toBe(false)
    expect(automationRequested(undefined, { FOLDKIT_NATIVE_AUTOMATION: '1' })).toBe(true)
    expect(automationRequested(true, {})).toBe(true)
    // The app's own `false` wins over the environment.
    expect(automationRequested(false, { FOLDKIT_NATIVE_AUTOMATION: '1' })).toBe(false)
  })

  test('by default the app doesn\'t listen on stdin; asked, it does, and close() lets go', async () => {
    const before = process.stdin.listenerCount('data')
    opened = openApp()
    expect(process.stdin.listenerCount('data')).toBe(before)
    await opened.app.close({ force: true })

    opened = openApp({ automation: true })
    expect(process.stdin.listenerCount('data')).toBe(before + 1)
    await opened.app.close({ force: true })
    opened = undefined
    expect(process.stdin.listenerCount('data')).toBe(before)
  })
})

/** Starts an example in a real window with stdin and stdout piped, and says
 *  whether it answers gpuix's automation handshake within `waitMs`. */
const answers = async (renderer: 'gpuix' | 'mirror', env: Record<string, string>, waitMs: number) => {
  const { connectStdio } = await import('@gpuix/native/automation')
  const child = Bun.spawn([process.execPath, 'examples/open.ts', 'form'], {
    cwd: resolve(import.meta.dir, '../../..'),
    env: { ...process.env, FOLDKIT_NATIVE_AUTOMATION: '', FOLDKIT_NATIVE_RENDERER: renderer, ...env },
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  })
  const listeners: Array<(chunk: string) => void> = []
  void (async () => {
    const decoder = new TextDecoder()
    const reader = child.stdout.getReader()
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      for (const listener of listeners) listener(decoder.decode(read.value))
    }
  })()
  try {
    const connected = connectStdio({
      write: chunk => {
        child.stdin.write(chunk)
        child.stdin.flush()
      },
      feed: listener => listeners.push(listener),
      close: async () => {},
    }).then(async app => {
      const { tree } = await (app as unknown as { call: (method: string, params: object) => Promise<{ tree: unknown }> }).call('getTree', {})
      return tree !== null
    })
    const timedOut = new Promise<'silent'>(done => setTimeout(() => done('silent'), waitMs))
    const result = await Promise.race([connected, timedOut])
    return { answered: result === true, running: child.exitCode === null }
  } finally {
    child.kill()
    await child.exited
  }
}

describe.skipIf(!WINDOWS)('a whole app, started with a pipe', () => {
  for (const renderer of ['gpuix', 'mirror'] as const) {
    test(`${renderer}: serves no automation by default; with ${AUTOMATION_ENV}=1 it does`, async () => {
      const asked = await answers(renderer, { FOLDKIT_NATIVE_AUTOMATION: '1' }, 15_000)
      expect(asked).toEqual({ answered: true, running: true })
      // The same app, as shipped: running, and silent on the same pipe.
      const shipped = await answers(renderer, {}, 6_000)
      expect(shipped).toEqual({ answered: false, running: true })
    }, 40_000)
  }
})
