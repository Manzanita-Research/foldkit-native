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
//
// And what it serves when asked (automation.ts): no field values in the
// tree, and a secret field's text (by its autocomplete) never.
import { afterEach, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import { WINDOWS } from '../../../test/support/windows.ts'
import { AUTOMATION_ENV, automationRequested, isSecretField, redactTree, redactingRenderer, secretValues } from '../src/index.ts'
import { openApp } from './app-support.ts'
import { METAL, openMetal } from './support.ts'

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

type Call = (method: string, params?: object) => Promise<unknown>

/** Starts an app (`args` after bun) in a real window with stdin and stdout
 *  piped, and runs `use` on gpuix's automation client if it answers the
 *  handshake within `waitMs`. Says whether it answered, and whether the
 *  app was still running. */
const overPipe = async <T>(args: ReadonlyArray<string>, env: Record<string, string>, waitMs: number, use: (call: Call) => Promise<T>) => {
  const { connectStdio } = await import('@gpuix/native/automation')
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: resolve(import.meta.dir, '../../..'),
    env: { ...process.env, FOLDKIT_NATIVE_AUTOMATION: '', ...env },
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
    }).then(app => use((method, params = {}) => (app as unknown as { call: (method: string, params: object) => Promise<unknown> }).call(method, params)))
    const timedOut = new Promise<'silent'>(done => setTimeout(() => done('silent'), waitMs))
    const result = await Promise.race([connected, timedOut])
    return { answered: result !== 'silent', result: result === 'silent' ? undefined : result, running: child.exitCode === null }
  } finally {
    child.kill()
    await child.exited
  }
}

/** Starts an example on `renderer` and says whether it answers `getTree`. */
const answers = async (renderer: 'gpuix' | 'mirror', env: Record<string, string>, waitMs: number) => {
  const { answered, running } = await overPipe(['examples/open.ts', 'form'], { FOLDKIT_NATIVE_RENDERER: renderer, ...env }, waitMs,
    async call => ((await call('getTree')) as { tree: unknown }).tree !== null)
  return { answered, running }
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

describe('what it serves', () => {
  test('a field is secret by its autocomplete; its text, longest first', () => {
    const field = (value: string, autocomplete?: string, localName = 'input') =>
      ({ localName, value, getAttribute: (name: string) => (name === 'autocomplete' ? autocomplete ?? null : null) })
    expect(isSecretField(field('x', 'one-time-code'))).toBe(true)
    expect(isSecretField(field('x', 'section-login current-password'))).toBe(true)
    expect(isSecretField(field('x', 'cc-csc', 'textarea'))).toBe(true)
    expect(isSecretField(field('x', 'name'))).toBe(false)
    expect(isSecretField(field('x', 'one-time-code', 'div'))).toBe(false)
    expect(secretValues([field('42', 'one-time-code'), field('Ada'), field('', 'new-password'), field('hunter2', 'new-password')])).toEqual(['hunter2', '42'])
  })

  test('the tree loses any value or text on a field; the painted text, all text and the selection lose secrets; the rest is the renderer\'s', () => {
    const tree = { type: 'div', id: 1, children: [{ type: 'input', id: 2, value: 'Ada', testId: 'name' }, { type: 'textarea', id: 3, text: 'diary' }, { type: 'text', id: 4, text: 'Hello' }] }
    expect(JSON.parse(redactTree(JSON.stringify(tree)))).toEqual({
      type: 'div', id: 1, children: [{ type: 'input', id: 2, testId: 'name' }, { type: 'textarea', id: 3 }, { type: 'text', id: 4, text: 'Hello' }],
    })
    expect(redactTree('null')).toBe('null')
    const renderer = {
      clicks: 0,
      getAutomationTree: () => JSON.stringify(tree),
      getPaintedText: () => ['Code', 'hunter2', 'Ada'],
      getAllText: () => ['Code: hunter2'],
      getSelectedText: () => 'unter2 and more',
      simulateClick(this: { clicks: number }) {
        this.clicks++
      },
    }
    const served = redactingRenderer(renderer, () => ['hunter2', 'unter2'])
    expect(served.getPaintedText()).toEqual(['Code', '•••••••', 'Ada'])
    expect(served.getAllText()).toEqual(['Code: •••••••'])
    expect(served.getSelectedText()).toBe('•••••• and more')
    expect(served.getAutomationTree()).not.toContain('Ada')
    served.simulateClick()
    expect(renderer.clicks).toBe(1)
  })
})

describe.skipIf(!METAL)('what it serves, on real GPUI (Metal)', () => {
  test('gpuix\'s tree has no field values; through its automation backend, the painted text has the name and not the code', async () => {
    const app = await openMetal('automation-redact', { width: 320, height: 160 })
    try {
      const field = (id: string, value: string, autocomplete?: string) => {
        const input = app.document.createElement('input')
        input.setAttribute('id', id)
        if (autocomplete !== undefined) input.setAttribute('autocomplete', autocomplete)
        input.value = value
        return input
      }
      app.document.body.append(field('name', 'Ada Lovelace'), field('code', '424242', 'one-time-code'))
      await app.settle()
      // gpuix itself: the painted text has both; its tree has neither. A gpuix
      // upgrade that puts values in the tree fails here.
      expect(app.renderer.getPaintedText()).toEqual(expect.arrayContaining(['Ada Lovelace', '424242']))
      const raw = JSON.stringify(app.renderer.getAutomationTree())
      expect(raw).not.toContain('Ada Lovelace')
      expect(raw).not.toContain('424242')
      const { InProcessBackend, liveRendererAsTest } = await import('@gpuix/native/automation')
      const served = redactingRenderer(app.renderer, () => secretValues(app.document.querySelectorAll('input, textarea') as never))
      const backend = new InProcessBackend(liveRendererAsTest(served as never)) as unknown as { call: (method: string, params: object) => Promise<unknown> }
      const painted = (await backend.call('getPaintedText', {})) as { text: Array<string> }
      console.log('automation painted text, served:', JSON.stringify(painted.text))
      expect(painted.text).toContain('Ada Lovelace')
      expect(painted.text).toContain('••••••')
      expect(JSON.stringify(painted)).not.toContain('424242')
      expect(JSON.stringify(await backend.call('getTree', {}))).not.toContain('424242')
    } finally {
      app.close()
    }
  })
})

describe.skipIf(!WINDOWS)('what a whole app serves over its pipe', () => {
  test('asked for: the painted text has the name and bullets for the one-time code', async () => {
    const { answered, result } = await overPipe(['packages/foldkit-gpuix/test/secret-app.ts'], { FOLDKIT_NATIVE_AUTOMATION: '1' }, 15_000, async call => {
      for (let tries = 0; tries < 50; tries++) {
        const { text } = (await call('getPaintedText')) as { text: Array<string> }
        if (text.includes('Ada Lovelace')) return text
        await new Promise(done => setTimeout(done, 100))
      }
      return []
    })
    console.log('secret-app painted text, over the pipe:', JSON.stringify(result))
    expect(answered).toBe(true)
    expect(result).toEqual(expect.arrayContaining(['Ada Lovelace', '••••••']))
    expect(JSON.stringify(result)).not.toContain('424242')
  }, 30_000)
})
