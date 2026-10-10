// FOLDKIT ON GPUIX
//
// A FoldKit adapter for gpuix, a peer of @gpuix/react and @gpuix/solid:
// FoldKit's view patches gpuix's retained tree directly. No happy-dom, no
// mirror, no CSS engine.
//
//   import { mountGpuix } from 'foldkit-gpuix'
//   const app = mountGpuix({ title: 'My app', appId: 'dev.example.app', css })
//   app.own(Runtime.embed(Runtime.makeElement({ Model, init, update, view, container: app.container })))
//
// FoldKit is unchanged. It renders with snabbdom, which writes to the global
// `document`; here that document's nodes are gpuix host nodes (dom.ts,
// host.ts). Styles are inline styles plus a flat sheet (sheet.ts): CSS whose
// selectors look at one element at a time. Focus, Tab order, scrolling and
// text input are GPUI's own.

import type { EventPayload, WindowOptions } from '@gpuix/native'
import { InProcessBackend, createSseDecoder, handleAutomationRequest, liveRendererAsTest } from '@gpuix/native/automation'
import { type NativeRenderer, createRendererState } from '@gpuix/native/host'

import { redactingRenderer, secretValues } from './automation.ts'
import {
  type ErrorPhase,
  type ErrorReport,
  NativeComment,
  NativeCustomEvent,
  NativeDocument,
  NativeDocumentFragment,
  NativeElement,
  NativeEvent,
  NativeEventTarget,
  NativeFocusEvent,
  NativeInputEvent,
  NativeKeyboardEvent,
  NativeMouseEvent,
  NativeMutationObserver,
  NativeNode,
  NativePointerEvent,
  NativeResizeObserver,
  NativeText,
  NativeUIEvent,
  NativeWheelEvent,
  NativeWindow,
} from './dom.ts'
import { type HostTimings, createHost } from './host.ts'
import { type Sheet, sheetFromCss, sheetFromObject } from './sheet.ts'
import { NativeStartError, explainStartError, loadGpuix, preflightDisplay } from './start.ts'
import { type NativeStorage, dataDirFor, fileStorage } from './storage.ts'

export { type ErrorPhase, type ErrorReport, type HostTimings, type NativeStorage, type Sheet, sheetFromCss, sheetFromObject }
export { NativeStartError, type StartFailure, explainStartError } from './start.ts'
export { dataDirFor } from './storage.ts'
export { NativeDocument, NativeElement } from './dom.ts'
export { PASSWORD_UNSUPPORTED } from './host.ts'
export { SECRET_AUTOCOMPLETE, isSecretField, redactTree, redactingRenderer, secretValues } from './automation.ts'
export { type BarOptions, type Edge, bar, isLayerShell } from './layer-shell.ts'

/** Token name → CSS value (numbers are pixels), as `foldkit-native`'s theme. */
export type Tokens = Readonly<Record<string, string | number>>
const property = (name: string) => `--fn-${name.replace(/[^a-zA-Z0-9-]/g, '-')}`

/** `instanceof HTMLInputElement` and friends, for code that checks. */
const tagClass = (tag: string) =>
  class {
    static [Symbol.hasInstance](value: unknown) {
      return value instanceof NativeElement && value.localName === tag
    }
  }

/** There's no shadow DOM, so no node is ever one of these. */
class NativeShadowRoot {}

/** Makes `document`, `window` and the DOM classes global, as a browser has
 *  them, and the document the newest attached one; returns a function that
 *  takes this window's back off. */
const installGlobals = (window: NativeWindow) => {
  const globals: Record<string, unknown> = {
    window, document: window.document, self: window,
    Node: NativeNode, Element: NativeElement, HTMLElement: NativeElement, SVGElement: NativeElement,
    Text: NativeText, Comment: NativeComment, DocumentFragment: NativeDocumentFragment, Document: NativeDocument,
    EventTarget: NativeEventTarget, Event: NativeEvent, UIEvent: NativeUIEvent, CustomEvent: NativeCustomEvent,
    MouseEvent: NativeMouseEvent, PointerEvent: NativePointerEvent, KeyboardEvent: NativeKeyboardEvent,
    FocusEvent: NativeFocusEvent, InputEvent: NativeInputEvent, DragEvent: NativeMouseEvent, WheelEvent: NativeWheelEvent,
    HTMLInputElement: tagClass('input'), HTMLTextAreaElement: tagClass('textarea'), HTMLButtonElement: tagClass('button'),
    HTMLFormElement: tagClass('form'), HTMLSelectElement: tagClass('select'), HTMLDialogElement: tagClass('dialog'),
    HTMLAnchorElement: tagClass('a'), HTMLImageElement: tagClass('img'), HTMLCanvasElement: tagClass('canvas'),
    // Behave (dom.ts): ResizeObserver from where GPUI last painted things
    // (FKN-29's per-frame layout). IntersectionObserver isn't built yet:
    // absent, so feature detection says so.
    MutationObserver: NativeMutationObserver, ResizeObserver: NativeResizeObserver, IntersectionObserver: undefined,
    // No shadow DOM, but the class, as every browser has it: @foldkit/ui's
    // anchor asks `root instanceof ShadowRoot` (it threw without one, so no
    // Listbox, Menu or Popover panel was ever placed), and nothing here is one.
    ShadowRoot: NativeShadowRoot,
    navigator: window.navigator,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window), matchMedia: window.matchMedia.bind(window),
    getSelection: window.getSelection.bind(window),
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
  }
  // A browser's window carries the DOM's classes too (`window.HTMLElement`):
  // Floating UI checks `instanceof` against the node's own window.
  for (const [name, value] of Object.entries(globals)) {
    if (/^[A-Z]/.test(name) && !(name in window)) Object.defineProperty(window, name, { value, configurable: true, writable: true })
  }
  const target = globalThis as Record<string, unknown>
  if (attachedWindows.length === 0) {
    globalsBefore = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(target, name)]))
  }
  const entry = { globals, document: window.document }
  attachedWindows.push(entry)
  define(globals)
  slot[CURRENT_DOCUMENT] = window.document
  // The newest window still attached keeps the globals, whichever detaches
  // first; the ones from before come back when the last one goes.
  return () => {
    const at = attachedWindows.indexOf(entry)
    if (at === -1) return
    const wasNewest = at === attachedWindows.length - 1
    attachedWindows.splice(at, 1)
    if (!wasNewest) return
    const newest = attachedWindows.at(-1)
    if (newest !== undefined) {
      define(newest.globals)
      slot[CURRENT_DOCUMENT] = newest.document
      return
    }
    for (const [name, descriptor] of globalsBefore ?? []) {
      if (descriptor === undefined) delete target[name]
      else Object.defineProperty(target, name, descriptor)
    }
    if (slot[CURRENT_DOCUMENT] === window.document) slot[CURRENT_DOCUMENT] = undefined
  }
}
/** The windows attached now, oldest first, and the globals from before the
 *  first of them. */
const attachedWindows: Array<{ globals: Record<string, unknown>; document: NativeDocument }> = []
let globalsBefore: Map<string, PropertyDescriptor | undefined> | undefined
const define = (globals: Record<string, unknown>) => {
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true })
  }
}

// DOCUMENT BEFORE MOUNT
// In a browser `document` exists before any module runs, and FoldKit apps
// name it at module scope (Snake's and Pixel Art's keyboard Subscriptions are
// `target: document`). Each attach makes its document the global, but a
// module that ran before has the one it saw. So the newest attached document
// is kept in one slot (shared with FoldKit Native's mirror, src/dom.ts, so
// either one's stand-in follows whichever attached last), and importing
// foldkit-gpuix gives `document` a stand-in that forwards to it: a listener
// the app adds once it runs lands on the real document.

/** The newest attached document (src/dom.ts reads the same slot). */
const CURRENT_DOCUMENT = Symbol.for('foldkit-native.document')
const slot = globalThis as unknown as Record<typeof CURRENT_DOCUMENT, NativeDocument | undefined>

/** `document` before (and between) attaches: forwards to the newest attached
 *  one. Methods run on the real document. Not the same object as it, so
 *  `node.ownerDocument === document` is false through this one (FoldKit
 *  never compares against `document` itself). */
const documentStandIn = new Proxy({} as NativeDocument, {
  get: (_, key) => {
    const document = slot[CURRENT_DOCUMENT]
    if (document === undefined) throw new Error(`foldkit-gpuix: no window attached yet (document.${String(key)})`)
    const value = Reflect.get(document, key, document)
    return typeof value === 'function' && key !== 'constructor' ? value.bind(document) : value
  },
  set: (_, key, value) => slot[CURRENT_DOCUMENT] !== undefined && Reflect.set(slot[CURRENT_DOCUMENT], key, value),
  has: (_, key) => slot[CURRENT_DOCUMENT] !== undefined && key in slot[CURRENT_DOCUMENT],
  getPrototypeOf: () => slot[CURRENT_DOCUMENT] === undefined ? Object.prototype : Object.getPrototypeOf(slot[CURRENT_DOCUMENT]),
})
;(globalThis as Record<string, unknown>)['document'] ??= documentStandIn

export type AttachOptions = {
  /** The app's CSS. Rules it can't use are listed in `unsupported`. */
  css?: string
  /** Sheets built ahead of time (a UI library's, a compiled Tailwind's). */
  sheets?: ReadonlyArray<Sheet>
  tokens?: Tokens
  /** Window size in logical pixels, for width media queries and `innerWidth`. */
  viewport?: { width: number; height: number }
  onSynced?: (timings: HostTimings) => void
  /** Names the app's data folder (`dataDirFor`): `localStorage` is a file
   *  there, written through on every change (src/storage.ts). Without an
   *  `appId` or a `dataDir` it's in memory and says so. */
  appId?: string
  /** The data folder itself, instead of the platform's one for `appId`. */
  dataDir?: string
  /** Errors a browser would report rather than throw, with where they came
   *  from: a DOM listener's or an animation frame's (the next ones still
   *  run), the frame loop's, a native event's, a close handler's or teardown's, the
   *  store's. Without it they go to `console.error`. */
  onError?: (report: ErrorReport) => void
  /** The clock GPUI's geometry queries are timed by (tests). */
  now?: () => number
}

/** FoldKit on an already-initialised gpuix renderer: the live window
 *  (`mountGpuix`) or gpuix's offscreen TestRenderer and the fake in tests.
 *  Returns the container to hand to FoldKit's `Runtime.makeElement`. */
export const attachGpuix = (renderer: NativeRenderer, options: AttachOptions = {}) => {
  const document = new NativeDocument()
  const window = new NativeWindow(document)
  const viewport = options.viewport ?? renderer.getWindowSize?.() ?? { width: 1024, height: 768 }
  window.innerWidth = viewport.width
  window.innerHeight = viewport.height
  if (options.onError !== undefined) window.onError = options.onError
  const dataDir = options.dataDir ?? (options.appId === undefined ? undefined : dataDirFor(options.appId))
  if (dataDir !== undefined) window.localStorage = fileStorage(dataDir, (error, context) => window.report('storage', error, context))
  const restore = installGlobals(window)
  const appSheet = options.css === undefined ? undefined : sheetFromCss(options.css)
  const sheets = [...(options.sheets ?? []), ...(appSheet === undefined ? [] : [appSheet])]
  const host = createHost(document, {
    renderer, sheets,
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    // As a browser: the window's size changes, then `resize` fires.
    onResize: size => {
      window.innerWidth = size.width
      window.innerHeight = size.height
      window.dispatchEvent(new NativeEvent('resize'))
    },
    ...(options.onSynced === undefined ? {} : { onSynced: options.onSynced }),
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  const setTokens = (tokens: Tokens) => {
    for (const [name, value] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(property(name), typeof value === 'number' ? `${value}px` : value)
    }
  }
  if (options.tokens !== undefined) setTokens(options.tokens)

  // FoldKit replaces its container with the view's root element, inside <body>.
  const container = document.createElement('div')
  container.setAttribute('id', 'app')
  document.body.appendChild(container)
  host.flush()

  const owned: Array<{ dispose: () => void }> = []
  let detached = false
  return {
    container: container as unknown as HTMLElement,
    document,
    window,
    host,
    /** Every CSS rule the app's stylesheet had that this adapter can't use. */
    unsupported: appSheet?.unsupported ?? [],
    /** Switch theme at runtime: the tree restyles on the next sync. */
    setTokens,
    /** Ties a runtime to this window: `detach` disposes it first.
     *  `native.own(Runtime.embed(Runtime.makeElement({ …, container })))` */
    own: <T extends { dispose: () => void }>(handle: T): T => {
      owned.push(handle)
      return handle
    },
    /** Takes it all down, in order: owned runtimes (their Subscriptions,
     *  Mounts, Commands and listeners stop, and FoldKit empties the
     *  container), pending animation frames, the native tree and GPUI
     *  handlers (gpuix's retained count goes to zero), then the globals.
     *  Attempts every step even after a failure, then throws that error
     *  (an AggregateError when several steps failed). */
    detach: (options: { windowGone?: boolean } = {}) => {
      if (detached) return
      detached = true
      const errors: Array<unknown> = []
      const attempt = (release: () => void) => {
        try {
          release()
        } catch (error) {
          errors.push(error)
        }
      }
      for (const handle of owned.splice(0).reverse()) attempt(() => handle.dispose())
      attempt(() => window.cancelAllFrames())
      attempt(() => host.detach(options))
      attempt(restore)
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'foldkit-gpuix: teardown failed')
    },
  }
}

/** Why the window is closing: the app called `close()`, or the window went
 *  (GPUI's loop ended: the person closed it, on Linux and Windows). */
export type CloseReason = 'close' | 'window'

/** What close handlers get. `preventDefault()` keeps the window open, when
 *  the app asked (`close()`); a window that already went can't be kept. */
export class CloseRequest {
  defaultPrevented = false
  constructor(readonly reason: CloseReason, readonly vetoable: boolean) {}
  preventDefault() {
    if (this.vetoable) this.defaultPrevented = true
  }
}
/** Runs before anything is taken down, so it can still read the model and
 *  save. It may return a promise: closing waits for it. */
export type CloseHandler = (request: CloseRequest) => void | Promise<void>

/** gpuix's renderer, as `mountGpuix` drives it. */
export type WindowRenderer = NativeRenderer & {
  init(options?: WindowOptions | null): void
  tick(): boolean
  requiresTick(): boolean
}

export type NativeOptions = WindowOptions & AttachOptions & {
  /** The window is this process (the default): closing it ends the process
   *  (exit 0), and a window that can't open prints why in one sentence and
   *  ends it (exit 1). With `false` the process is the host's: `close()`
   *  resolves instead, and a failed start throws a `NativeStartError`.
   *
   *  `false` has a limit on gpuix 0.10: GPUI stays alive after `close()`.
   *  gpuix's event callback holds the process open and its window can't be
   *  closed from JavaScript, so the window stays on screen, undrawn, until
   *  the process ends. */
  exitOnClose?: boolean
  /** A close handler (`onClose(handler)` adds more). It runs for `close()`
   *  and when GPUI's loop ends. Not when a person closes the window on
   *  macOS: there GPUI ends the process inside its frame, with no
   *  JavaScript running, so nothing may count on saving at close. */
  onClose?: CloseHandler
  /** Makes the renderer, given gpuix's event callback (tests: a fake). */
  createRenderer?: (callback: (error: Error | null, event: EventPayload) => void) => WindowRenderer
  /** After each frame: how long the adapter and GPUI took on it, in ms. */
  onFrame?: (ms: number) => void
  /** Serve gpuix's automation over stdin and stdout: whoever writes to the
   *  process's stdin can then click, type, read the tree and the painted
   *  text, and take screenshots. Off unless asked: `true` here, or
   *  `FOLDKIT_NATIVE_AUTOMATION=1` in the environment (the test drivers and
   *  scripts set it). gpuix's own default serves it whenever stdin isn't a
   *  terminal, so a shipped app started with a pipe would. */
  automation?: boolean
}

/** The environment variable that turns automation on (`=1`) for a process
 *  a test or script starts. */
export const AUTOMATION_ENV = 'FOLDKIT_NATIVE_AUTOMATION'

/** Whether to serve automation: asked for in the options, or else in the
 *  environment. Never by default. */
export const automationRequested = (asked: boolean | undefined, env: Readonly<Record<string, string | undefined>> = process.env) =>
  asked ?? env[AUTOMATION_ENV] === '1'

/** Opens a native window with FoldKit drawn in it. Returns the app: its
 *  container, `own()` for its runtimes, and `close()`. */
export const mountGpuix = (options: NativeOptions = {}) => {
  const { css, sheets, tokens, viewport, onSynced, onClose, onError, dataDir, exitOnClose = true, createRenderer, onFrame, now, automation, ...windowOptions } = options
  let attached: ReturnType<typeof attachGpuix> | undefined
  const report = (phase: ErrorPhase, error: unknown, context: Record<string, unknown> = {}) => {
    if (attached !== undefined) attached.window.report(phase, error, context)
    else console.error(`[foldkit-gpuix] ${phase} error`, context, error)
  }

  // OPEN: gpuix loads now, so a missing library is explained too (start.ts).
  let renderer: WindowRenderer
  let gpuix: ReturnType<typeof loadGpuix>
  try {
    gpuix = loadGpuix()
    if (createRenderer === undefined) preflightDisplay()
    const callback = (error: Error | null, event: EventPayload) => {
      if (error !== null) return report('native', error)
      try {
        createRendererState(renderer).dispatch(event)
      } catch (failed) {
        report('event', failed, { eventType: event.eventType, elementId: event.elementId })
      }
    }
    renderer = createRenderer?.(callback) ?? new gpuix.native.GpuixRenderer(callback)
    renderer.init(windowOptions)
  } catch (error) {
    const failure = explainStartError(error)
    if (!exitOnClose) throw failure
    console.error(failure.message)
    process.exit(1)
  }
  // gpuix's automation (scripts/record.ts, the window tests) talks over
  // stdin, only when asked for (see `automation`). The renderer here is
  // gpuix's own GpuixRenderer, not createNativeRenderer's, which would serve
  // it whenever stdin isn't a terminal.
  // It serves the renderer less a person's secrets (automation.ts).
  let automationListener: ((chunk: string) => void) | undefined
  if (automationRequested(automation)) {
    const fields = () => attached?.document.querySelectorAll('input, textarea') ?? []
    // Use gpuix's protocol/backend, but own the stdin callback explicitly:
    // its enableAutomation returns no disposer, and a listener snapshot
    // would also claim host registrations triggered by `newListener`.
    const backend = new InProcessBackend(liveRendererAsTest(redactingRenderer(renderer, () => secretValues(fields() as never)) as never))
    const decoder = createSseDecoder(message => {
      if (!('method' in message)) return
      void handleAutomationRequest(message, backend).then(reply => { process.stdout.write(reply) })
    })
    automationListener = chunk => decoder.feed(chunk)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', automationListener)
  }

  const { width, height } = windowOptions
  attached = attachGpuix(renderer, {
    ...(css === undefined ? {} : { css }),
    ...(sheets === undefined ? {} : { sheets }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(onSynced === undefined ? {} : { onSynced }),
    ...(onError === undefined ? {} : { onError }),
    ...(dataDir === undefined ? {} : { dataDir }),
    ...(now === undefined ? {} : { now }),
    ...(windowOptions.appId === undefined ? {} : { appId: windowOptions.appId }),
    // A size left to the compositor (0, or unset: a layer surface's length)
    // is the one GPUI's window has.
    viewport: viewport ?? (width && height ? { width, height } : renderer.getWindowSize?.() ?? { width: width || 1024, height: height || 768 }),
  })
  const app = attached
  if (app.unsupported.length > 0 && process.env['FOLDKIT_GPUIX_DEBUG'] !== undefined) {
    console.error(`[foldkit-gpuix] ${app.unsupported.length} CSS rules not supported:\n  ${app.unsupported.join('\n  ')}`)
  }

  // CLOSE: ask the handlers, then take everything down.
  const handlers = new Set<CloseHandler>(onClose === undefined ? [] : [onClose])
  let closing: Promise<boolean> | undefined
  let done = false
  const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>()
  const ask = async (request: CloseRequest) => {
    for (const handler of [...handlers]) {
      try {
        await handler(request)
      } catch (error) {
        report('close', error, { reason: request.reason })
      }
    }
  }
  let windowGone = false
  const finish = () => {
    if (done) return
    done = true
    const attempt = (release: () => void) => {
      try {
        release()
      } catch (error) {
        try {
          report('close', error, { reason: windowGone ? 'window' : 'close', stage: 'teardown' })
        } catch {
          // A host's onError and its console fallback may both throw.
          // Reporting must not abandon the remaining teardown steps.
        }
      }
    }
    try {
      attempt(() => loop.stop())
      attempt(() => app.detach({ windowGone }))
      // Release only this app's automation listener, even if detach failed.
      if (automationListener !== undefined) {
        const listener = automationListener
        attempt(() => { process.stdin.off('data', listener) })
        attempt(() => { if (process.stdin.listenerCount('data') === 0) process.stdin.pause() })
      }
    } finally {
      resolveClosed()
    }
    if (exitOnClose) process.exit(0)
  }
  const close = (options: { force?: boolean } = {}): Promise<boolean> => {
    if (done) return Promise.resolve(true)
    // A forced close after one a handler may still keep open.
    if (closing !== undefined && options.force === true) return closing.then(ok => ok || close(options))
    closing ??= (async () => {
      const request = new CloseRequest('close', options.force !== true)
      await ask(request)
      if (request.defaultPrevented) {
        closing = undefined
        return false
      }
      finish()
      return true
    })()
    return closing
  }

  // FRAMES: around each tick, animation frames before GPUI may draw, the
  // host's waiting work after.
  let frames = 0
  const ticking = {
    requiresTick: () => renderer.requiresTick(),
    tick: () => {
      frames++
      const started = performance.now()
      app.host.frame()
      const more = renderer.tick()
      // A window that's gone has drawn nothing, and gpuix on Linux then throws
      // from every query ("GPUI application is not initialized"): say it ended.
      if (more) app.host.drawn()
      onFrame?.(performance.now() - started)
      return more
    },
  }
  const loop = gpuix.runtime.startFrameLoop(ticking, {
    // The window went: nothing to keep open, but handlers may still save.
    onTerminated: () => {
      if (done) return
      windowGone = true
      closing = ask(new CloseRequest('window', false)).then(() => (finish(), true))
    },
    onError: error => report('frame', error, { frame: frames }),
  })
  return {
    ...app,
    renderer,
    /** Asks the close handlers (one may `preventDefault()`), then releases
     *  everything the app owns: its runtimes, animation frames, the native
     *  tree and handlers, the globals, the frame loop and stdin. Resolves
     *  `false` if a handler kept the window open. `force` can't be vetoed.
     *  Teardown errors are reported through `onError` (phase `close`, stage
     *  `teardown`); all steps are attempted and closing still resolves `true`. */
    close,
    /** Adds a close handler; returns a function that removes it. */
    onClose: (handler: CloseHandler) => {
      handlers.add(handler)
      return () => void handlers.delete(handler)
    },
    /** Resolves after all cleanup attempts (with `exitOnClose: false`),
     *  including when teardown errors were reported through `onError`. */
    closed,
  }
}
