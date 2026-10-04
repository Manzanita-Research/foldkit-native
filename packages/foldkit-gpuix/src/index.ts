// FOLDKIT ON GPUIX
//
// A FoldKit adapter for gpuix, a peer of @gpuix/react and @gpuix/solid:
// FoldKit's view patches gpuix's retained tree directly. No happy-dom, no
// mirror, no CSS engine.
//
//   import { mountGpuix } from 'foldkit-gpuix'
//   const native = mountGpuix({ title: 'My app', css })
//   Runtime.run(Runtime.makeElement({ Model, init, update, view, container: native.container }))
//
// FoldKit is unchanged. It renders with snabbdom, which writes to the global
// `document`; here that document's nodes are gpuix host nodes (dom.ts,
// host.ts). Styles are inline styles plus a flat sheet (sheet.ts): CSS whose
// selectors look at one element at a time. Focus, Tab order, scrolling and
// text input are GPUI's own.

import type { WindowOptions } from '@gpuix/native'
import type { NativeRenderer } from '@gpuix/native/host'
import { createNativeRenderer, startFrameLoop } from '@gpuix/native/runtime'

import {
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
  NativeNode,
  NativePointerEvent,
  NativeText,
  NativeUIEvent,
  NativeWindow,
} from './dom.ts'
import { type HostTimings, createHost } from './host.ts'
import { type Sheet, sheetFromCss, sheetFromObject } from './sheet.ts'

export { type HostTimings, type Sheet, sheetFromCss, sheetFromObject }
export { NativeDocument, NativeElement } from './dom.ts'

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
class InertObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

/** Makes `document`, `window` and the DOM classes global, as a browser has
 *  them; returns a function that puts the previous ones back. */
const installGlobals = (window: NativeWindow) => {
  const globals: Record<string, unknown> = {
    window, document: window.document, self: window,
    Node: NativeNode, Element: NativeElement, HTMLElement: NativeElement, SVGElement: NativeElement,
    Text: NativeText, Comment: NativeComment, DocumentFragment: NativeDocumentFragment, Document: NativeDocument,
    EventTarget: NativeEventTarget, Event: NativeEvent, UIEvent: NativeUIEvent, CustomEvent: NativeCustomEvent,
    MouseEvent: NativeMouseEvent, PointerEvent: NativePointerEvent, KeyboardEvent: NativeKeyboardEvent,
    FocusEvent: NativeFocusEvent, InputEvent: NativeInputEvent, DragEvent: NativeMouseEvent, WheelEvent: NativeMouseEvent,
    HTMLInputElement: tagClass('input'), HTMLTextAreaElement: tagClass('textarea'), HTMLButtonElement: tagClass('button'),
    HTMLFormElement: tagClass('form'), HTMLSelectElement: tagClass('select'), HTMLDialogElement: tagClass('dialog'),
    HTMLAnchorElement: tagClass('a'), HTMLImageElement: tagClass('img'), HTMLCanvasElement: tagClass('canvas'),
    MutationObserver: InertObserver, ResizeObserver: InertObserver, IntersectionObserver: InertObserver,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window), matchMedia: window.matchMedia.bind(window),
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
  }
  const target = globalThis as Record<string, unknown>
  const previous = new Map(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(target, name)]))
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(target, name, { value, configurable: true, writable: true, enumerable: true })
  }
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor === undefined) delete target[name]
      else Object.defineProperty(target, name, descriptor)
    }
  }
}

export type AttachOptions = {
  /** The app's CSS. Rules it can't use are listed in `unsupported`. */
  css?: string
  /** Sheets built ahead of time (a UI library's, a compiled Tailwind's). */
  sheets?: ReadonlyArray<Sheet>
  tokens?: Tokens
  /** Window size in logical pixels, for width media queries and `innerWidth`. */
  viewport?: { width: number; height: number }
  onSynced?: (timings: HostTimings) => void
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
  const restore = installGlobals(window)
  const appSheet = options.css === undefined ? undefined : sheetFromCss(options.css, { viewportWidth: viewport.width })
  const sheets = [...(options.sheets ?? []), ...(appSheet === undefined ? [] : [appSheet])]
  const host = createHost(document, { renderer, sheets, ...(options.onSynced === undefined ? {} : { onSynced: options.onSynced }) })

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

  return {
    container: container as unknown as HTMLElement,
    document,
    window,
    host,
    /** Every CSS rule the app's stylesheet had that this adapter can't use. */
    unsupported: appSheet?.unsupported ?? [],
    /** Switch theme at runtime: the tree restyles on the next sync. */
    setTokens,
    detach: () => {
      host.detach()
      restore()
    },
  }
}

export type NativeOptions = WindowOptions & AttachOptions

/** Opens a native window with FoldKit drawn in it. */
export const mountGpuix = (options: NativeOptions = {}) => {
  const { css, sheets, tokens, viewport, onSynced, ...windowOptions } = options
  const renderer = createNativeRenderer({
    onError: error => console.error('[foldkit-gpuix] native event error', error),
  })
  renderer.init(windowOptions)
  const { width, height } = windowOptions
  const attached = attachGpuix(renderer, {
    ...(css === undefined ? {} : { css }),
    ...(sheets === undefined ? {} : { sheets }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(onSynced === undefined ? {} : { onSynced }),
    viewport: viewport ?? { width: width ?? 1024, height: height ?? 768 },
  })
  if (attached.unsupported.length > 0 && process.env['FOLDKIT_GPUIX_DEBUG'] !== undefined) {
    console.error(`[foldkit-gpuix] ${attached.unsupported.length} CSS rules not supported:\n  ${attached.unsupported.join('\n  ')}`)
  }
  // After each tick GPUI may have drawn: the host's waiting work runs.
  const ticking = {
    requiresTick: () => renderer.requiresTick(),
    tick: () => {
      const more = renderer.tick()
      attached.host.drawn()
      return more
    },
  }
  const loop = startFrameLoop(ticking, {
    onTerminated: () => process.exit(0),
    onError: error => console.error('[foldkit-gpuix] frame error', error),
  })
  return {
    ...attached,
    renderer,
    stop: () => {
      loop.stop()
      attached.detach()
    },
  }
}
