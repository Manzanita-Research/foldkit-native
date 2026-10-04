// The app handle (FKN-22): `close()` and close handlers, where errors go, and
// what happens when GPUI can't start. Headless on the fake GPUI through
// `mountGpuix`'s real frame loop, plus whole processes, since "the process
// ends" is the claim. On Metal, two gpuix behaviours that limit all this are
// pinned, so a gpuix upgrade that changes them fails here.
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { join } from 'node:path'

import { createRendererState } from '@gpuix/native/host'

import { CloseRequest, type ErrorReport, NativeStartError, explainStartError } from '../src/index.ts'
import { createFakeWindow, frames, log, openApp } from './app-support.ts'
import { METAL } from './support.ts'

type Opened = ReturnType<typeof openApp>
let opened: Opened | undefined
afterEach(async () => {
  await opened?.app.close({ force: true })
  opened = undefined
})
const open = (options: Parameters<typeof openApp>[0] = {}) => (opened = openApp(options))

describe('close()', () => {
  test('asks the handlers, then disposes the runtime, frees the native tree and puts the globals back', async () => {
    const before = (globalThis as { document?: unknown }).document
    const { app, window } = open()
    await frames()
    expect(log).toEqual(['mounted'])
    expect(window.fake.gpui.retainedCount()).toBeGreaterThan(2)
    const seen: Array<string> = []
    app.onClose(request => {
      // Before anything is taken down: the app's document is still current.
      seen.push(`${request.reason} ${request.vetoable} ${(globalThis as { document?: unknown }).document === app.document}`)
    })
    expect(await app.close()).toBe(true)
    expect(seen).toEqual(['close true true'])
    expect(log).toEqual(['mounted', 'released'])
    expect(window.fake.gpui.retainedCount()).toBe(0)
    expect((globalThis as { document?: unknown }).document).toBe(before)
    await app.closed
    // The loop stopped: no more ticks reach GPUI.
    const batches = window.fake.gpui.batches.length
    await frames()
    expect(window.fake.gpui.batches.length).toBe(batches)
    expect(await app.close()).toBe(true)
  })

  test('a handler can keep the window open; force closes anyway', async () => {
    const { app } = open()
    await frames()
    let asked = 0
    const remove = app.onClose(request => {
      asked++
      request.preventDefault()
    })
    expect(await app.close()).toBe(false)
    expect(log).toEqual(['mounted'])
    expect(app.document.getElementById('ok')).not.toBeNull()
    expect(await app.close({ force: true })).toBe(true)
    expect(asked).toBe(2)
    expect(log).toEqual(['mounted', 'released'])
    remove()
  })

  test('closing waits for a handler that saves, and an onClose option is a handler', async () => {
    const saved: Array<string> = []
    const { app } = open({
      onClose: async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        saved.push(`saved, runtime ${log.includes('released') ? 'gone' : 'running'}`)
      },
    })
    await frames()
    await app.close()
    expect(saved).toEqual(['saved, runtime running'])
    expect(log).toEqual(['mounted', 'released'])
  })

  test('when the window goes, handlers run and can\'t keep it', async () => {
    const { app, window } = open()
    await frames()
    const seen: Array<CloseRequest> = []
    app.onClose(request => {
      request.preventDefault()
      seen.push(request)
    })
    window.closeWindow()
    await app.closed
    expect(seen.map(request => [request.reason, request.vetoable, request.defaultPrevented])).toEqual([['window', false, false]])
    expect(log).toEqual(['mounted', 'released'])
    expect(window.fake.gpui.retainedCount()).toBe(0)
  })
})

describe('onError: where it came from, and what was going on', () => {
  const collect = () => {
    const reports: Array<ErrorReport> = []
    return { reports, onError: (report: ErrorReport) => void reports.push(report) }
  }

  test('a listener that throws is reported, and the next listener still runs', async () => {
    const { reports, onError } = collect()
    const { app } = open({ onError })
    await frames()
    const button = app.document.getElementById('ok')!
    const ran: Array<string> = []
    button.addEventListener('click', () => {
      throw new Error('listener broke')
    })
    button.addEventListener('click', () => ran.push('second'))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(ran).toEqual(['second'])
    expect(reports.map(({ phase, context }) => ({ phase, context }))).toEqual([{ phase: 'listener', context: { type: 'click', target: 'button#ok' } }])
    expect((reports[0]!.error as Error).message).toBe('listener broke')
  })

  test('an animation frame that throws is reported, and the others run', async () => {
    const { reports, onError } = collect()
    const { app } = open({ onError })
    await frames()
    const ran: Array<string> = []
    app.window.requestAnimationFrame(() => {
      throw new Error('frame broke')
    })
    app.window.requestAnimationFrame(() => ran.push('next'))
    await frames()
    expect(ran).toEqual(['next'])
    expect(reports.map(report => report.phase)).toEqual(['animationFrame'])
  })

  test('the frame loop, native errors, event dispatch and close handlers', async () => {
    const { reports, onError } = collect()
    const { app, window } = open({ onError })
    await frames()
    window.failNextTick(new Error('tick broke'))
    await frames()
    window.send(new Error('gpui said no'))
    // A native event whose host handler throws (not a DOM listener's error:
    // those are the listener phase), as gpuix's renderer state calls it.
    const elementId = app.document.getElementById('ok')!.nativeId
    createRendererState(app.renderer).current()!.eventHandlers.set(elementId, new Map([['click', () => {
      throw new Error('handler broke')
    }]]))
    window.send(null, { eventType: 'click', elementId })
    const quiet = spyOn(console, 'error').mockImplementation(() => {})
    app.onClose(() => {
      throw new Error('save broke')
    })
    await app.close()
    quiet.mockRestore()
    expect(reports.map(report => report.phase)).toEqual(['frame', 'native', 'event', 'close'])
    expect(reports[0]!.context['frame']).toBeGreaterThan(0)
    expect(reports[2]!.context).toEqual({ eventType: 'click', elementId })
    expect(reports[3]!.context).toEqual({ reason: 'close' })
    // The close went ahead: a handler that throws doesn't veto.
    expect(log).toEqual(['mounted', 'released'])
  })
})

describe('starting GPUI', () => {
  test('no compositor, a missing library, anything else: one sentence each', () => {
    const noCompositor = explainStartError(new Error('The GPUI UI thread panicked during initialization: called `Result::unwrap()` on an `Err` value: NoCompositor'))
    expect(noCompositor).toBeInstanceOf(NativeStartError)
    expect(noCompositor.reason).toBe('NoDisplay')
    expect(noCompositor.message).toBe('There is no display to open a window on: start the app from a Wayland or X11 session (WAYLAND_DISPLAY or DISPLAY must be set).')

    // napi-rs: "Cannot find native binding" with the loader's errors as causes.
    const loader = new Error('Cannot find native binding. npm has a bug related to optional dependencies')
    loader.cause = new Error('libxkbcommon.so.0: cannot open shared object file: No such file or directory')
    const missing = explainStartError(loader)
    expect(missing.reason).toBe('MissingLibrary')
    expect(missing.message).toBe("GPUI needs libxkbcommon.so.0, which isn't installed: install your distribution's package for it and start the app again.")
    expect(explainStartError(new Error('The GPUI UI thread panicked during initialization: NoWaylandLib')).message).toContain('libwayland-client.so.0')

    const other = explainStartError(new Error('Failed to spawn the GPUI UI thread: out of threads\nmore'))
    expect(other.reason).toBe('Other')
    expect(other.message).toBe("GPUI couldn't open a window: Failed to spawn the GPUI UI thread: out of threads")
    for (const error of [noCompositor, missing, other]) expect(error.message.split(/[.:] /).length).toBeLessThanOrEqual(3)
  })

  test('a host process gets the typed error', async () => {
    const window = createFakeWindow({
      init: () => {
        throw new Error('The GPUI UI thread panicked during initialization: called `Result::unwrap()` on an `Err` value: NoCompositor')
      },
    })
    const { mountGpuix } = await import('../src/index.ts')
    expect(() => mountGpuix({ exitOnClose: false, createRenderer: window.createRenderer })).toThrow(NativeStartError)
  })
})

// WHOLE PROCESSES

const SCRIPT = join(import.meta.dir, 'app-process.ts')
const run = async (mode: string, waitMs = 4000) => {
  const child = Bun.spawn([process.execPath, SCRIPT, mode], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const killer = setTimeout(() => child.kill(), waitMs)
  const code = await child.exited
  clearTimeout(killer)
  const lines = (await new Response(child.stdout).text()).trim().split('\n')
  const at = (word: string) => {
    const line = lines.find(line => line.startsWith(`${word} `))
    return line === undefined ? undefined : Number(line.split(' ').at(-1))
  }
  return { code, killed: child.signalCode !== null, lines, stderr: (await new Response(child.stderr).text()).trim(), at }
}

describe('the process', () => {
  test('app-only, exitOnClose: false: after close() the process ends on its own within a second', async () => {
    const { code, killed, lines, at } = await run('close-host')
    expect(killed).toBe(false)
    expect(code).toBe(0)
    expect(lines.some(line => line.startsWith('closed mounted,released'))).toBe(true)
    // It ended because nothing was left, not because anything exited it.
    expect(at('beforeExit')).toBeDefined()
    expect(at('beforeExit')! - at('closing')!).toBeLessThan(1000)
  })

  test('with other work, exitOnClose: false: close() leaves the process running', async () => {
    const { code, at } = await run('close-host-busy')
    expect(code).toBe(0)
    expect(at('other work done')).toBeGreaterThan(at('closed')!)
    expect(at('beforeExit')).toBeGreaterThanOrEqual(at('other work done')!)
  })

  test('exitOnClose (the default): close() ends the process, exit 0', async () => {
    const { code, at } = await run('close-exit')
    expect(code).toBe(0)
    expect(at('exit')).toBeDefined()
    expect(at('beforeExit')).toBeUndefined()
  })

  test('no compositor: one sentence on stderr, exit 1', async () => {
    const { code, stderr, at } = await run('no-compositor')
    expect(code).toBe(1)
    expect(stderr).toBe('There is no display to open a window on: start the app from a Wayland or X11 session (WAYLAND_DISPLAY or DISPLAY must be set).')
    expect(at('opened')).toBeUndefined()
  })
})

// gpuix 0.10's limits, pinned. When one of these fails, gpuix changed: see
// the README's lifecycle section and drop the limit it describes.
describe.skipIf(!METAL)('gpuix 0.10 on a real window (Metal)', () => {
  test('its event callback holds the process open after close(), so exitOnClose: false can\'t end it', async () => {
    const { killed, at } = await run('real-close-host', 3000)
    expect(at('closed')).toBeDefined()
    expect(at('beforeExit')).toBeUndefined()
    expect(killed).toBe(true)
  }, 10_000)

  test('a native close (the red button) ends the process inside GPUI: exit 0, no close handler, no JS exit', async () => {
    const { code, killed, at } = await run('real-native-close', 3000)
    expect(killed).toBe(false)
    expect(code).toBe(0)
    expect(at('asked')).toBeDefined()
    expect(at('onClose')).toBeUndefined()
    expect(at('exit')).toBeUndefined()
  }, 10_000)
})
